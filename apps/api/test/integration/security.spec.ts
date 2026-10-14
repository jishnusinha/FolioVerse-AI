import { RequestMethod, type INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/infra/prisma.service';
import { EPUB_MIMETYPE, makeZip } from '../zip';
import { Client, createApp, registered } from './harness';

/** Security checks from plan Section M that the authorization matrix and feature suites do not cover. */

type User = Awaited<ReturnType<typeof registered>>;
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

let app: INestApplication;
beforeAll(async () => {
  app = await createApp();
});
afterAll(async () => app?.close());

async function upload(u: User, projectId: string, filename: string, bytes: Buffer) {
  const up = await u.c.post(`/api/workspaces/${u.workspaceId}/uploads`, { projectId, filename, sizeBytes: bytes.length });
  expect(up.status).toBe(201);
  await u.c.send('put', up.body.url, bytes, { 'content-type': up.body.headers['Content-Type'] });
  const done = await u.c.post(`/api/workspaces/${u.workspaceId}/uploads/${up.body.uploadId}/complete`, {});
  return { uploadId: up.body.uploadId as string, ...done.body };
}

function workspaceRoutes(): string[] {
  const controllers: any[] = Reflect.getMetadata('controllers', AppModule) ?? [];
  const out: string[] = [];
  for (const ctrl of controllers) {
    const base = String([Reflect.getMetadata(PATH_METADATA, ctrl) ?? ''].flat()[0]);
    for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
      const fn = ctrl.prototype[name];
      if (name === 'constructor' || typeof fn !== 'function') continue;
      const path = Reflect.getMetadata(PATH_METADATA, fn);
      const method = Reflect.getMetadata(METHOD_METADATA, fn);
      if (path === undefined || method === undefined) continue;
      const full = '/' + [base, ...[path].flat()].map((s) => String(s).replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');
      if (full.includes(':workspaceId')) out.push(`${RequestMethod[method]} ${full}`);
    }
  }
  return out.sort();
}

/** UUIDv7 ids adjacent to a real one: same millisecond, low random bits ±1 and ±2. */
function neighbours(id: string): string[] {
  const n = BigInt(`0x${id.replace(/-/g, '')}`);
  return [-2n, -1n, 1n, 2n].map((d) => {
    const hex = (n + d).toString(16).padStart(32, '0');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  });
}

const SECRET = 'Tenant A private passage about Project Kestrel';

describe('cross-tenant ids (IDOR)', () => {
  let a: User;
  let b: User;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    a = await registered(app, 'idor-a');
    b = await registered(app, 'idor-b');
    const w = `/api/workspaces/${a.workspaceId}`;
    const knowledge = a.projects.find((p) => p.kind === 'KNOWLEDGE');
    ids.projectId = knowledge.id;
    ids.userId = a.userId;
    const folder = await a.c.post(`${w}/projects/${knowledge.id}/folders`, { name: 'Private' });
    ids.folderId = folder.body.id;
    const doc = await upload(a, knowledge.id, 'kestrel.md', Buffer.from(`# Kestrel\n\n${SECRET}.`));
    Object.assign(ids, { uploadId: doc.uploadId, sourceId: doc.sourceId, versionId: doc.versionId });
    ids.manuscriptId = (await a.c.post(`${w}/manuscripts`, { title: 'Kestrel draft' })).body.id;
    ids.noteId = (await a.c.post(`${w}/notes`, { body: SECRET, sourceId: doc.sourceId })).body.id;
    ids.itemId = (await a.c.post(`${w}/library/items`, { book: { title: 'Kestrel shelf' } })).body.id;
    ids.collectionId = (await a.c.post(`${w}/library/collections`, { name: 'Kestrel' })).body.id;
    for (const [k, v] of Object.entries(ids)) expect({ [k]: typeof v }).toEqual({ [k]: 'string' });
  });

  function targets() {
    return workspaceRoutes().flatMap((route) => {
      const [method, path] = route.split(' ');
      const params = [...path.matchAll(/:(\w+)/g)].map((m) => m[1]).filter((p) => p !== 'workspaceId');
      if (!params.length || !params.every((p) => p in ids)) return [];
      return [{ route, method: method.toLowerCase() as Method, path }];
    });
  }

  it('covers most id-bearing routes', () => {
    expect(targets().length).toBeGreaterThan(50);
  });

  it("never serves or changes another tenant's resources through my workspace", async () => {
    const leaks: string[] = [];
    for (const { route, method, path } of targets()) {
      const url = '/api' + path.replace(':workspaceId', b.workspaceId).replace(/:(\w+)/g, (_, p) => ids[p]);
      const res = await b.c.send(method, url, method === 'get' ? undefined : {});
      const body = JSON.stringify(res.body ?? '') + (res.text ?? '');
      const ok = [400, 404, 409, 422].includes(res.status) && (method !== 'get' || res.status !== 409);
      if (!ok || body.includes(SECRET)) leaks.push(`${route} -> ${res.status}`);
    }
    expect(leaks).toEqual([]);
    const still = await a.c.get(`/api/workspaces/${a.workspaceId}/sources/${ids.sourceId}`);
    expect(still.status).toBe(200);
  });

  it('adjacent UUIDv7 ids find nothing, for the owner or an outsider', async () => {
    const misses: string[] = [];
    for (const { route, method, path } of targets().filter((t) => t.method === 'get')) {
      for (const [who, user, wid] of [
        ['owner', a, a.workspaceId],
        ['outsider', b, a.workspaceId],
      ] as const) {
        const near = Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, neighbours(v)[(route.length + who.length) % 4]]));
        const url = '/api' + path.replace(':workspaceId', wid).replace(/:(\w+)/g, (_, p) => near[p]);
        const res = await user.c.send(method, url);
        if (![400, 404].includes(res.status)) misses.push(`${who} ${route} -> ${res.status}`);
      }
    }
    expect(misses).toEqual([]);
  });
});

describe('session security', () => {
  it('rejects a mutation whose CSRF header does not match the cookie', async () => {
    const u = await registered(app, 'csrf');
    const res = await u.c.send('post', '/api/workspaces', { name: 'Forged' }, { 'x-csrf-token': 'not-the-cookie-value' });
    expect(res.status).toBe(403);
    expect((await u.c.post('/api/workspaces', { name: 'Real' })).status).toBe(201);
  });

  it('sets HttpOnly, SameSite=Lax session cookies and a narrow refresh path', async () => {
    const c = new Client(app);
    await c.get('/api/auth/csrf');
    const res = await c.post('/api/auth/register', { email: `cookie-${Date.now()}@example.test`, password: 'Pw-cookie-flags-1', displayName: 'c' });
    expect(res.status).toBe(201);
    const set = (res.headers['set-cookie'] as unknown as string[]).map((s) => s.toLowerCase());
    const cookie = (name: string) => set.find((s) => s.startsWith(`${name}=`))!;
    expect(cookie('fv_at')).toMatch(/httponly/);
    expect(cookie('fv_at')).toMatch(/samesite=lax/);
    expect(cookie('fv_rt')).toMatch(/httponly/);
    expect(cookie('fv_rt')).toMatch(/path=\/api\/auth/);
    expect(cookie('fv_csrf')).not.toMatch(/httponly/);
  });

  it('stores passwords as argon2id with the pinned parameters', async () => {
    const u = await registered(app, 'argon');
    const user = await app.get(PrismaService).user.findUniqueOrThrow({ where: { id: u.userId } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(user.passwordHash).not.toContain(u.password);
  });
});

describe('auth rate limits', () => {
  let limited: INestApplication;
  beforeAll(async () => {
    limited = await createApp();
  });
  afterAll(async () => limited?.close());

  it('throttles repeated login attempts', async () => {
    const c = new Client(limited);
    await c.get('/api/auth/csrf');
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await c.post('/api/auth/login', { email: 'nobody@example.test', password: 'wrong-password-1' })).status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('throttles registration bursts', async () => {
    const c = new Client(limited);
    await c.get('/api/auth/csrf');
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await c.post('/api/auth/register', { email: `burst-${Date.now()}-${i}@example.test`, password: 'Pw-burst-account-1', displayName: 'b' })).status);
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });
});

describe('upload guards', () => {
  it('refuses files above the size limit before any bytes are sent', async () => {
    const u = await registered(app, 'big');
    const k = u.projects.find((p) => p.kind === 'KNOWLEDGE');
    const res = await u.c.post(`/api/workspaces/${u.workspaceId}/uploads`, { projectId: k.id, filename: 'huge.pdf', sizeBytes: 65 * 1024 * 1024 });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('TOO_LARGE');
  });

  it('quarantines a zip-bomb EPUB and never queues it for ingestion', async () => {
    const u = await registered(app, 'bomb');
    const lib = u.projects.find((p) => p.kind === 'LIBRARY') ?? u.projects[0];
    const bomb = makeZip([EPUB_MIMETYPE, { name: 'OEBPS/ch1.xhtml', data: Buffer.alloc(12 * 1024 * 1024) }]);
    const done = await upload(u, lib.id, 'bomb.epub', bomb);
    expect(done).toMatchObject({ state: 'QUARANTINED', reason: 'ZIP_RATIO' });
    const jobs = await app.get(PrismaService).ingestionJob.count({ where: { sourceVersionId: done.versionId } });
    expect(jobs).toBe(0);
  });

  it('strips path traversal from uploaded filenames', async () => {
    const u = await registered(app, 'path');
    const k = u.projects.find((p) => p.kind === 'KNOWLEDGE');
    const done = await upload(u, k.id, '../../etc/passwd.md', Buffer.from('# Notes\n\nplain text'));
    const src = await u.c.get(`/api/workspaces/${u.workspaceId}/sources/${done.sourceId}`);
    expect(src.body.title).toBe('passwd.md');
  });
});
