import { RequestMethod, type INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import { MailService } from '../../src/modules/mail/mail.service';
import { Client, createApp, registered } from './harness';

type Role = 'VIEWER' | 'EDITOR' | 'ADMIN' | 'OWNER';
const RANK: Record<Role, number> = { VIEWER: 1, EDITOR: 2, ADMIN: 3, OWNER: 4 };
const ROLES: Role[] = ['VIEWER', 'EDITOR', 'ADMIN', 'OWNER'];

/** Minimum role for every workspace-scoped endpoint. A new endpoint without an entry fails this suite. */
const MATRIX: Record<string, Role> = {
  'GET /workspaces/:workspaceId': 'VIEWER',
  'PATCH /workspaces/:workspaceId': 'ADMIN',
  'GET /workspaces/:workspaceId/members': 'VIEWER',
  'PATCH /workspaces/:workspaceId/members/:userId': 'ADMIN',
  'DELETE /workspaces/:workspaceId/members/:userId': 'ADMIN',
  'POST /workspaces/:workspaceId/invitations': 'ADMIN',
  'GET /workspaces/:workspaceId/audit': 'ADMIN',

  'GET /workspaces/:workspaceId/projects': 'VIEWER',
  'POST /workspaces/:workspaceId/projects': 'EDITOR',
  'GET /workspaces/:workspaceId/projects/:projectId': 'VIEWER',
  'PATCH /workspaces/:workspaceId/projects/:projectId': 'EDITOR',
  'DELETE /workspaces/:workspaceId/projects/:projectId': 'ADMIN',
  'POST /workspaces/:workspaceId/projects/:projectId/restore': 'ADMIN',
  'GET /workspaces/:workspaceId/trash': 'VIEWER',
  'GET /workspaces/:workspaceId/projects/:projectId/folders': 'VIEWER',
  'POST /workspaces/:workspaceId/projects/:projectId/folders': 'EDITOR',
  'PATCH /workspaces/:workspaceId/folders/:folderId': 'EDITOR',
  'DELETE /workspaces/:workspaceId/folders/:folderId': 'EDITOR',

  'POST /workspaces/:workspaceId/uploads': 'EDITOR',
  'PUT /workspaces/:workspaceId/uploads/:uploadId/content': 'EDITOR',
  'POST /workspaces/:workspaceId/uploads/:uploadId/complete': 'EDITOR',
  'GET /workspaces/:workspaceId/projects/:projectId/sources': 'VIEWER',
  'GET /workspaces/:workspaceId/sources/:sourceId': 'VIEWER',
  'PATCH /workspaces/:workspaceId/sources/:sourceId': 'EDITOR',
  'DELETE /workspaces/:workspaceId/sources/:sourceId': 'EDITOR',
  'POST /workspaces/:workspaceId/sources/:sourceId/restore': 'EDITOR',
  'POST /workspaces/:workspaceId/sources/batch': 'EDITOR',
  'GET /workspaces/:workspaceId/sources/:sourceId/versions/:versionId/file': 'VIEWER',
  'GET /workspaces/:workspaceId/sources/:sourceId/versions/:versionId/pages': 'VIEWER',
  'GET /workspaces/:workspaceId/sources/:sourceId/versions/:versionId/chunks': 'VIEWER',
  'GET /workspaces/:workspaceId/sources/:sourceId/versions/:versionId/diff': 'VIEWER',
  'POST /workspaces/:workspaceId/sources/:sourceId/versions/:versionId/ingest': 'EDITOR',

  'POST /workspaces/:workspaceId/runs': 'EDITOR',
  'GET /workspaces/:workspaceId/runs': 'VIEWER',
  'GET /workspaces/:workspaceId/runs/:runId': 'VIEWER',
  'POST /workspaces/:workspaceId/runs/:runId/cancel': 'EDITOR',
  'GET /workspaces/:workspaceId/runs/:runId/receipt': 'VIEWER',
  'GET /workspaces/:workspaceId/runs/:runId/trace': 'VIEWER',
  'GET /workspaces/:workspaceId/runs/:runId/checkpoints': 'VIEWER',
  'POST /workspaces/:workspaceId/runs/:runId/fork': 'EDITOR',
  'GET /workspaces/:workspaceId/budget': 'VIEWER',
  'GET /workspaces/:workspaceId/graphs/:name': 'VIEWER',
  'GET /workspaces/:workspaceId/runs/:runId/events': 'VIEWER',
  'GET /workspaces/:workspaceId/events': 'VIEWER',

  'GET /workspaces/:workspaceId/threads': 'VIEWER',
  'GET /workspaces/:workspaceId/threads/:threadId': 'VIEWER',
  'PATCH /workspaces/:workspaceId/threads/:threadId': 'EDITOR',
  'DELETE /workspaces/:workspaceId/threads/:threadId': 'EDITOR',
  'PUT /workspaces/:workspaceId/threads/:threadId/scope': 'EDITOR',

  'GET /workspaces/:workspaceId/artifacts': 'VIEWER',
  'GET /workspaces/:workspaceId/artifacts/:artifactId': 'VIEWER',
  'PATCH /workspaces/:workspaceId/artifacts/:artifactId': 'EDITOR',
  'DELETE /workspaces/:workspaceId/artifacts/:artifactId': 'EDITOR',
  'GET /workspaces/:workspaceId/notes': 'VIEWER',
  'POST /workspaces/:workspaceId/notes': 'EDITOR',
  'PATCH /workspaces/:workspaceId/notes/:noteId': 'EDITOR',
  'DELETE /workspaces/:workspaceId/notes/:noteId': 'EDITOR',
  'GET /workspaces/:workspaceId/search': 'VIEWER',

  'GET /workspaces/:workspaceId/manuscripts': 'VIEWER',
  'POST /workspaces/:workspaceId/manuscripts': 'EDITOR',
  'GET /workspaces/:workspaceId/manuscripts/:manuscriptId': 'VIEWER',
  'PATCH /workspaces/:workspaceId/manuscripts/:manuscriptId': 'EDITOR',
  'DELETE /workspaces/:workspaceId/manuscripts/:manuscriptId': 'EDITOR',
  'POST /workspaces/:workspaceId/manuscripts/:manuscriptId/nodes': 'EDITOR',
  'PATCH /workspaces/:workspaceId/manuscripts/:manuscriptId/nodes/:nodeId': 'EDITOR',
  'DELETE /workspaces/:workspaceId/manuscripts/:manuscriptId/nodes/:nodeId': 'EDITOR',
  'GET /workspaces/:workspaceId/manuscripts/:manuscriptId/nodes/:nodeId/doc': 'VIEWER',
  'PATCH /workspaces/:workspaceId/manuscripts/:manuscriptId/nodes/:nodeId/doc': 'EDITOR',
  'GET /workspaces/:workspaceId/manuscripts/:manuscriptId/nodes/:nodeId/doc/revisions': 'VIEWER',
  'GET /workspaces/:workspaceId/manuscripts/:manuscriptId/nodes/:nodeId/doc/revisions/:revision': 'VIEWER',
  'POST /workspaces/:workspaceId/manuscripts/:manuscriptId/nodes/:nodeId/doc/revisions/:revision/restore': 'EDITOR',
  'GET /workspaces/:workspaceId/manuscripts/:manuscriptId/compiled': 'VIEWER',
  'GET /workspaces/:workspaceId/manuscripts/:manuscriptId/export': 'VIEWER',
  'GET /workspaces/:workspaceId/manuscripts/:manuscriptId/suggestions': 'VIEWER',
  'POST /workspaces/:workspaceId/manuscripts/:manuscriptId/nodes/:nodeId/suggestions': 'EDITOR',
  'PATCH /workspaces/:workspaceId/suggestions/:suggestionId': 'EDITOR',
  'GET /workspaces/:workspaceId/manuscripts/:manuscriptId/dna': 'VIEWER',
  'POST /workspaces/:workspaceId/manuscripts/:manuscriptId/dna/facts': 'EDITOR',
  'PATCH /workspaces/:workspaceId/manuscripts/:manuscriptId/dna/facts/:factId': 'EDITOR',
  'POST /workspaces/:workspaceId/manuscripts/:manuscriptId/dna/links': 'EDITOR',
  'PATCH /workspaces/:workspaceId/manuscripts/:manuscriptId/dna/links/:linkId': 'EDITOR',
  'POST /workspaces/:workspaceId/manuscripts/:manuscriptId/dna/extract': 'EDITOR',
  'GET /workspaces/:workspaceId/manuscripts/:manuscriptId/continuity': 'VIEWER',
  'POST /workspaces/:workspaceId/manuscripts/:manuscriptId/continuity/check': 'EDITOR',
  'PATCH /workspaces/:workspaceId/manuscripts/:manuscriptId/continuity/:issueId': 'EDITOR',
  'GET /workspaces/:workspaceId/excerpts': 'VIEWER',
  'POST /workspaces/:workspaceId/excerpts': 'EDITOR',
  'DELETE /workspaces/:workspaceId/excerpts/:excerptId': 'EDITOR',
  'GET /workspaces/:workspaceId/manuscripts/:manuscriptId/research-notes': 'VIEWER',
  'POST /workspaces/:workspaceId/manuscripts/:manuscriptId/research-notes': 'EDITOR',
  'PATCH /workspaces/:workspaceId/manuscripts/:manuscriptId/research-notes/:noteId': 'EDITOR',
  'DELETE /workspaces/:workspaceId/manuscripts/:manuscriptId/research-notes/:noteId': 'EDITOR',

  // Library shelves, progress and annotations are private per member; any member may keep one.
  'GET /workspaces/:workspaceId/library/items': 'VIEWER',
  'POST /workspaces/:workspaceId/library/items': 'VIEWER',
  'GET /workspaces/:workspaceId/library/items/:itemId': 'VIEWER',
  'PATCH /workspaces/:workspaceId/library/items/:itemId': 'VIEWER',
  'DELETE /workspaces/:workspaceId/library/items/:itemId': 'VIEWER',
  'PUT /workspaces/:workspaceId/library/items/:itemId/progress': 'VIEWER',
  'GET /workspaces/:workspaceId/library/items/:itemId/annotations': 'VIEWER',
  'POST /workspaces/:workspaceId/library/items/:itemId/annotations': 'VIEWER',
  'PATCH /workspaces/:workspaceId/library/items/:itemId/annotations/:annotationId': 'VIEWER',
  'DELETE /workspaces/:workspaceId/library/items/:itemId/annotations/:annotationId': 'VIEWER',
  'GET /workspaces/:workspaceId/library/items/:itemId/bookmarks': 'VIEWER',
  'POST /workspaces/:workspaceId/library/items/:itemId/bookmarks': 'VIEWER',
  'DELETE /workspaces/:workspaceId/library/items/:itemId/bookmarks/:bookmarkId': 'VIEWER',
  'POST /workspaces/:workspaceId/library/items/:itemId/explain': 'EDITOR',
  'POST /workspaces/:workspaceId/library/items/:itemId/excerpts': 'EDITOR',
  'GET /workspaces/:workspaceId/library/collections': 'VIEWER',
  'POST /workspaces/:workspaceId/library/collections': 'VIEWER',
  'PATCH /workspaces/:workspaceId/library/collections/:collectionId': 'VIEWER',
  'DELETE /workspaces/:workspaceId/library/collections/:collectionId': 'VIEWER',
  'POST /workspaces/:workspaceId/library/collections/:collectionId/items': 'VIEWER',
  'DELETE /workspaces/:workspaceId/library/collections/:collectionId/items/:itemId': 'VIEWER',
  'GET /workspaces/:workspaceId/library/stats': 'VIEWER',

  'GET /workspaces/:workspaceId/discover/taste': 'VIEWER',
  'PUT /workspaces/:workspaceId/discover/taste': 'VIEWER',
  'GET /workspaces/:workspaceId/discover/catalog': 'VIEWER',
  'GET /workspaces/:workspaceId/discover/catalog/:itemId': 'VIEWER',
  'GET /workspaces/:workspaceId/discover/catalog/:itemId/similar': 'VIEWER',
  'POST /workspaces/:workspaceId/discover/recommendations': 'VIEWER',
  'GET /workspaces/:workspaceId/discover/recommendations/latest': 'VIEWER',
  'GET /workspaces/:workspaceId/discover/recommendations/:setId': 'VIEWER',
  'POST /workspaces/:workspaceId/discover/recommendations/:setId/items/:itemId/explain': 'EDITOR',
  'POST /workspaces/:workspaceId/discover/feedback': 'VIEWER',
  'GET /workspaces/:workspaceId/discover/saved': 'VIEWER',
  'GET /workspaces/:workspaceId/discover/model': 'VIEWER',
  'POST /workspaces/:workspaceId/discover/evaluations': 'EDITOR',
  'GET /workspaces/:workspaceId/discover/evaluations': 'VIEWER',
  'GET /workspaces/:workspaceId/discover/evaluations/:id': 'VIEWER',
  'GET /workspaces/:workspaceId/library/metadata/search': 'VIEWER',

  'GET /workspaces/:workspaceId/costs/summary': 'VIEWER',
  'GET /workspaces/:workspaceId/costs/entries': 'VIEWER',
  'GET /workspaces/:workspaceId/costs/export.csv': 'VIEWER',

  'GET /workspaces/:workspaceId/notifications': 'VIEWER',
  'POST /workspaces/:workspaceId/notifications/read-all': 'VIEWER',
};

/** Server-sent event streams stay open for permitted callers, so only denials are asserted. */
const STREAMS = new Set(['GET /workspaces/:workspaceId/events', 'GET /workspaces/:workspaceId/runs/:runId/events']);
/** A permitted call that reached a synchronous AI-service dependency which is not running in this suite. */
const UPSTREAM_CODES = new Set(['RECOMMENDER_UNAVAILABLE']);

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

function concrete(route: string, workspaceId: string) {
  const [method, path] = route.split(' ');
  const url = '/api' + path.replace(':workspaceId', workspaceId).replace(/:(\w+)/g, () => randomUUID());
  return { method: method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete', url };
}

let app: INestApplication;
let teamId: string;
const members = {} as Record<Role, Client>;
let outsider: Client;

beforeAll(async () => {
  app = await createApp();
  const mail = app.get(MailService);
  const owner = await registered(app, 'owner');
  members.OWNER = owner.c;
  const team = await owner.c.post('/api/workspaces', { name: 'Matrix team' });
  expect(team.status).toBe(201);
  teamId = team.body.id;

  for (const role of ['ADMIN', 'EDITOR', 'VIEWER'] as const) {
    const u = await registered(app, role.toLowerCase());
    const inv = await owner.c.post(`/api/workspaces/${teamId}/invitations`, { email: u.email, role });
    expect(inv.status).toBe(201);
    const msg = [...mail.outbox].reverse().find((m: any) => m.to === u.email && /invited/i.test(m.subject)) as any;
    const token = /token=([\w-]+)/.exec(msg.text)![1];
    expect((await u.c.post('/api/invitations/accept', { token })).status).toBe(201);
    members[role] = u.c;
  }
  outsider = (await registered(app, 'outsider')).c;
});
afterAll(async () => app?.close());

describe('authorization matrix', () => {
  it('classifies every workspace-scoped endpoint', () => {
    const routes = workspaceRoutes();
    expect(routes.filter((r) => !(r in MATRIX))).toEqual([]);
    expect(Object.keys(MATRIX).filter((r) => !routes.includes(r))).toEqual([]);
  });

  it('team members see their own roles', async () => {
    const res = await members.VIEWER.get(`/api/workspaces/${teamId}/members`);
    expect(res.body.map((m: any) => m.role).sort()).toEqual(['ADMIN', 'EDITOR', 'OWNER', 'VIEWER']);
  });

  for (const [route, min] of Object.entries(MATRIX)) {
    it(`${route} requires ${min}`, async () => {
      const { method, url } = concrete(route, teamId);
      const out = await outsider.send(method, url, method === 'get' ? undefined : {});
      expect({ who: 'outsider', status: out.status }).toEqual({ who: 'outsider', status: 404 });

      for (const role of ROLES) {
        const allowed = RANK[role] >= RANK[min];
        if (allowed && STREAMS.has(route)) continue;
        const res = await members[role].send(method, url, method === 'get' ? undefined : {});
        if (allowed) {
          const upstreamDown = res.status === 503 && UPSTREAM_CODES.has(res.body?.code);
          const denied = [401, 403].includes(res.status) || (res.status >= 500 && !upstreamDown);
          expect({ role, status: res.status, denied }).toMatchObject({ role, denied: false });
        } else {
          expect({ role, status: res.status }).toEqual({ role, status: 403 });
        }
      }
    });
  }
});
