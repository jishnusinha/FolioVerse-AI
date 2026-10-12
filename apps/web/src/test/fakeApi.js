/**
 * In-memory stand-in for the FolioVerse API used by Vitest and Playwright (no network, no backend).
 * All data is DEMO data. Behaviour mirrors the real endpoints closely enough for UI tests:
 * 401 without a session, 404 outside the workspace, 403 below the required role, problem+json errors.
 */
import { createFakeAi } from './fakeAi.js';
import { FAKE_INSIGHT_ACTIONS } from './fakeKnowledge.js';
import { createFakeWriter } from './fakeWriter.js';

const PROBLEM = { 'content-type': 'application/problem+json' };
const JSON_H = { 'content-type': 'application/json' };
const RANK = { VIEWER: 1, EDITOR: 2, ADMIN: 3, OWNER: 4 };
const MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  md: 'text/markdown',
  txt: 'text/plain',
  epub: 'application/epub+zip',
};
const NEXT_STATE = { UPLOADED: 'SCANNING', SCANNING: 'PREVIEW_READY', PREVIEW_READY: 'PARSING', PARSING: 'INDEXING', INDEXING: 'READY' };

export const FAKE_CSRF = 'test-csrf-token';
export const DEMO_USER = { email: 'mira@aster.example', password: 'demo-password-123', displayName: 'Mira Okafor' };

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const iso = (minutesAgo = 0) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

function problem(status, detail, code) {
  return { status, headers: PROBLEM, body: { type: 'about:blank', title: detail, status, detail, code } };
}
const ok = (body, status = 200) => ({ status, headers: JSON_H, body });
const noContent = () => ({ status: 204, headers: {}, body: null });

/**
 * @param {{ signedIn?: boolean, role?: 'OWNER'|'ADMIN'|'EDITOR'|'VIEWER', advance?: boolean, empty?: boolean, emailVerified?: boolean,
 *   budgetLimit?: string, budgetHard?: boolean, streamCut?: number, pdfBytes?: Uint8Array, artifacts?: string[] }} [opts]
 *   `role` applies to an extra TEAM workspace; `advance` moves busy sources one ingestion step per list request.
 *   `budgetLimit`/`budgetHard` set the monthly budget; `streamCut` ends a run's first event stream early;
 *   `pdfBytes` is served as the file of every PDF version; `artifacts` lists insight actions to run on the
 *   Market Outlook PDF up front, each leaving a saved artifact.
 */
export function createFakeApi(opts = {}) {
  const userId = uuid();
  const personal = uuid();
  const db = {
    session: opts.signedIn ?? true,
    /** When true, the next authenticated request gets 401 TOKEN_EXPIRED until the client refreshes. */
    accessExpired: false,
    refreshes: 0,
    user: { id: userId, ...DEMO_USER, platformRole: 'USER', emailVerified: opts.emailVerified ?? true, preferences: {} },
    memberships: [{ workspaceId: personal, role: 'OWNER' }],
    workspaces: [{ id: personal, name: 'Aster Research', kind: 'PERSONAL' }],
    projects: [],
    folders: [],
    sources: [],
    versions: [],
    uploads: new Map(),
    log: [],
  };

  const addProject = (workspaceId, name, kind, description = '') => {
    const p = { id: uuid(), workspaceId, name, kind, description, archivedAt: null, deletedAt: null, createdAt: iso(600), updatedAt: iso(30) };
    db.projects.push(p);
    return p;
  };
  const addFolder = (p, name, parent) => {
    const id = uuid();
    const f = { id, workspaceId: p.workspaceId, projectId: p.id, parentId: parent?.id ?? null, name, path: `${parent?.path ?? ''}/${id}`, deletedAt: null };
    db.folders.push(f);
    return f;
  };
  const addSource = (p, title, state, folder, minutesAgo = 60, extra = {}) => {
    const id = uuid();
    const vid = uuid();
    const ext = /\.(\w+)$/.exec(title)?.[1]?.toLowerCase() ?? 'txt';
    const v = {
      id: vid,
      sourceId: id,
      workspaceId: p.workspaceId,
      versionNo: 1,
      mimeType: MIME[ext],
      sha256: '9f2c4e41aa7b0c3d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5',
      sizeBytes: 2_400_000,
      pageCount: ext === 'pdf' ? 18 : null,
      ingestionState: state,
      ingestionError: extra.error ?? null,
      createdAt: iso(minutesAgo),
    };
    const s = {
      id,
      workspaceId: p.workspaceId,
      projectId: p.id,
      folderId: folder?.id ?? null,
      title,
      mimeType: MIME[ext],
      currentVersionId: vid,
      ingestionState: state,
      tags: [],
      deletedAt: null,
      createdAt: iso(minutesAgo),
      updatedAt: iso(minutesAgo),
    };
    db.versions.push(v);
    db.sources.push(s);
    return s;
  };

  const knowledge = addProject(personal, 'Project Atlas', 'KNOWLEDGE', 'Market research on assisted-research tools (DEMO)');
  let outlook = null;
  const writing = addProject(personal, 'My Writing', 'WRITER');
  addProject(personal, 'My Library', 'LIBRARY');
  if (!opts.empty) {
    const research = addFolder(knowledge, 'Market research');
    const y26 = addFolder(knowledge, '2026', research);
    addFolder(knowledge, 'Interviews');
    outlook = addSource(knowledge, 'Market Outlook 2026.pdf', 'READY', y26, 300);
    addSource(knowledge, 'Competitor Notes.md', 'READY', research, 200);
    addSource(knowledge, 'Analyst Briefing.docx', 'INDEXING', y26, 5);
    addSource(knowledge, 'Survey Export.pdf', 'FAILED', null, 50, { error: 'Parser timed out on page 31 (DEMO).' });
  }
  if (opts.role) {
    const team = uuid();
    db.workspaces.push({ id: team, name: 'Aster Team', kind: 'TEAM' });
    db.memberships.push({ workspaceId: team, role: opts.role });
    addProject(team, 'Shared Knowledge', 'KNOWLEDGE');
  }

  const fakeAi = createFakeAi({ db, uuid, iso, ok, problem, noContent, opts });
  fakeAi.seed(personal, outlook);
  if (opts.artifacts && outlook) for (const id of opts.artifacts) fakeAi.seedInsight(personal, outlook, id);
  const fakeWriter = createFakeWriter({ db, uuid, iso, ok, problem, noContent });
  if (opts.writer !== false) fakeWriter.seed(personal, writing.id);

  const member = (wid) => db.memberships.find((m) => m.workspaceId === wid);
  const live = (rows, wid) => rows.filter((r) => r.workspaceId === wid && !r.deletedAt);
  const withVersion = (s) => ({ ...s, currentVersion: db.versions.find((v) => v.id === s.currentVersionId) ?? null });
  const setState = (s, state) => {
    s.ingestionState = state;
    const v = db.versions.find((x) => x.id === s.currentVersionId);
    if (v) v.ingestionState = state;
  };

  /** @returns {{ status: number, headers: Record<string,string>, body: any }} */
  function handle(method, url, body, headers = {}) {
    const u = new URL(url, 'http://fake.local');
    const path = u.pathname.replace(/^\/api/, '');
    method = method.toUpperCase();
    db.log.push(`${method} ${path}`);
    const seg = path.split('/').filter(Boolean);

    // ── auth ──
    if (seg[0] === 'auth') {
      const action = seg[1];
      if (action === 'csrf') return { status: 200, headers: { ...JSON_H, 'set-cookie': `fv_csrf=${FAKE_CSRF}; Path=/` }, body: { csrfToken: FAKE_CSRF } };
      if (action === 'login' && method === 'POST') {
        if (body?.email?.toLowerCase() === db.user.email && body?.password === db.user.password) {
          db.session = true;
          return ok({ user: publicUser() });
        }
        return problem(401, 'Invalid email or password', 'INVALID_CREDENTIALS');
      }
      if (action === 'register' && method === 'POST') {
        if (body?.email?.toLowerCase() === db.user.email) return problem(409, 'An account with this email already exists', 'EMAIL_TAKEN');
        if (!body?.password || body.password.length < 10) return problem(400, 'password must be longer than or equal to 10 characters', 'VALIDATION');
        Object.assign(db.user, { email: body.email.toLowerCase(), password: body.password, displayName: body.displayName, emailVerified: false });
        db.workspaces[0].name = `${body.displayName}'s workspace`;
        db.session = true;
        return ok({ user: publicUser() }, 201);
      }
      if (action === 'refresh') {
        if (!db.session) return problem(401, 'No refresh token', 'NO_REFRESH');
        db.accessExpired = false;
        db.refreshes += 1;
        return ok({ user: publicUser() });
      }
      if (action === 'logout') {
        db.session = false;
        return noContent();
      }
      if (action === 'forgot-password') return noContent();
      if (action === 'reset-password' || action === 'verify-email') {
        if (body?.token !== 'good-token') return problem(400, 'Token is invalid or expired', 'BAD_TOKEN');
        if (action === 'verify-email') db.user.emailVerified = true;
        return noContent();
      }
      if (!db.session) return problem(401, 'Authentication required', 'NO_SESSION');
      if (db.accessExpired) return problem(401, 'Session expired', 'TOKEN_EXPIRED');
      if (action === 'me' && method === 'GET') {
        return ok({
          user: publicUser(),
          workspaces: db.memberships.map((m) => ({ ...db.workspaces.find((w) => w.id === m.workspaceId), role: m.role })),
        });
      }
      if (action === 'resend-verification') return noContent();
      return problem(404, 'Not found');
    }

    if (!db.session) return problem(401, 'Authentication required', 'NO_SESSION');
    if (db.accessExpired) return problem(401, 'Session expired', 'TOKEN_EXPIRED');
    if (method !== 'GET' && headers['x-csrf-token'] !== FAKE_CSRF) return problem(403, 'CSRF token missing or invalid', 'CSRF');

    if (path === '/models' && method === 'GET') return ok([fakeAi.model]);
    if (path === '/insight-actions' && method === 'GET') return ok(FAKE_INSIGHT_ACTIONS);
    if (path === '/workspaces' && method === 'POST') {
      const id = uuid();
      db.workspaces.push({ id, name: body.name, kind: 'TEAM' });
      db.memberships.push({ workspaceId: id, role: 'OWNER' });
      addProject(id, 'Shared Knowledge', 'KNOWLEDGE');
      return ok({ id, name: body.name, kind: 'TEAM', role: 'OWNER' }, 201);
    }
    if (path === '/invitations/accept' && method === 'POST') {
      if (body?.token !== 'good-token') return problem(404, 'Not found');
      const id = uuid();
      db.workspaces.push({ id, name: 'Invited Team', kind: 'TEAM' });
      db.memberships.push({ workspaceId: id, role: 'EDITOR' });
      return ok({ workspaceId: id }, 201);
    }

    if (seg[0] !== 'workspaces' || !seg[1]) return problem(404, 'Not found');
    const wid = seg[1];
    const m = member(wid);
    if (!m) return problem(404, 'Not found');
    const need = (role) => (RANK[m.role] < RANK[role] ? problem(403, `Requires ${role} role`, 'ROLE') : null);
    const rest = seg.slice(2);
    const r = rest.join('/');

    if (r === '' && method === 'PATCH') return need('ADMIN') ?? (Object.assign(db.workspaces.find((w) => w.id === wid), { name: body.name }), ok({ id: wid, name: body.name }));
    if (r === 'projects' && method === 'GET') {
      return ok(live(db.projects, wid).map((p) => ({ ...p, sourceCount: live(db.sources, wid).filter((s) => s.projectId === p.id).length })));
    }
    if (r === 'projects' && method === 'POST') return need('EDITOR') ?? ok(addProject(wid, body.name, body.kind, body.description ?? ''), 201);
    if (r === 'trash' && method === 'GET') {
      const purgeAt = (d) => new Date(new Date(d).getTime() + 30 * 86400_000).toISOString();
      return ok({
        purgeAfterDays: 30,
        projects: db.projects.filter((p) => p.workspaceId === wid && p.deletedAt).map((p) => ({ ...p, purgeAt: purgeAt(p.deletedAt) })),
        sources: db.sources.filter((s) => s.workspaceId === wid && s.deletedAt).map((s) => ({ ...s, purgeAt: purgeAt(s.deletedAt) })),
      });
    }

    if (rest[0] === 'projects' && rest[1]) {
      const p = db.projects.find((x) => x.id === rest[1] && x.workspaceId === wid);
      if (!p) return problem(404, 'Not found');
      if (rest.length === 2 && method === 'GET') return p.deletedAt ? problem(404, 'Not found') : ok(p);
      if (rest[2] === 'restore' && method === 'POST') return need('ADMIN') ?? ((p.deletedAt = null), ok(p));
      if (rest[2] === 'folders' && method === 'GET') return ok(live(db.folders, wid).filter((f) => f.projectId === p.id));
      if (rest[2] === 'folders' && method === 'POST') {
        const parent = body.parentId ? db.folders.find((f) => f.id === body.parentId) : null;
        return need('EDITOR') ?? ok(addFolder(p, body.name, parent), 201);
      }
      if (rest[2] === 'sources' && method === 'GET') {
        const rows = live(db.sources, wid).filter((s) => s.projectId === p.id);
        if (opts.advance) for (const s of rows) if (NEXT_STATE[s.ingestionState]) setState(s, NEXT_STATE[s.ingestionState]);
        return ok(rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(withVersion));
      }
    }

    if (rest[0] === 'folders' && rest[1]) {
      const f = live(db.folders, wid).find((x) => x.id === rest[1]);
      if (!f) return problem(404, 'Not found');
      const denied = need('EDITOR');
      if (denied) return denied;
      if (method === 'PATCH') return (f.name = body.name ?? f.name), ok(f);
      if (method === 'DELETE') {
        const now = iso();
        const ids = new Set(db.folders.filter((x) => x.id === f.id || x.path.startsWith(`${f.path}/`)).map((x) => x.id));
        for (const x of db.folders) if (ids.has(x.id)) x.deletedAt = now;
        for (const s of db.sources) if (s.folderId && ids.has(s.folderId) && !s.deletedAt) s.deletedAt = now;
        return noContent();
      }
    }

    if (r === 'sources/batch' && method === 'POST') {
      const denied = need('EDITOR');
      if (denied) return denied;
      const rows = db.sources.filter((s) => s.workspaceId === wid && body.ids.includes(s.id));
      for (const s of rows) {
        if (body.action === 'delete') s.deletedAt = iso();
        if (body.action === 'restore') s.deletedAt = null;
        if (body.action === 'move') s.folderId = body.folderId ?? null;
        if (body.action === 'reingest') setState(s, 'PARSING');
      }
      return ok({ affected: rows.length }, 201);
    }
    if (rest[0] === 'sources' && rest[1]) {
      const s = db.sources.find((x) => x.id === rest[1] && x.workspaceId === wid);
      if (!s) return problem(404, 'Not found');
      if (rest.length === 2 && method === 'GET') {
        if (s.deletedAt) return problem(404, 'Not found');
        const versions = db.versions.filter((v) => v.sourceId === s.id).sort((a, b) => b.versionNo - a.versionNo);
        return ok({ ...s, versions, manifests: [], jobs: [] });
      }
      if (rest[2] === 'restore' && method === 'POST') return need('EDITOR') ?? ((s.deletedAt = null), ok(s));
      if (rest[2] === 'versions' && rest[4] === 'ingest' && method === 'POST') return need('EDITOR') ?? (setState(s, 'PARSING'), ok({ jobId: uuid() }, 201));
      if (rest[2] === 'versions' && rest[4] === 'file') {
        const bytes = s.mimeType === MIME.pdf && opts.pdfBytes ? opts.pdfBytes : 'DEMO file content';
        return { status: 200, headers: { 'content-type': s.mimeType }, body: bytes };
      }
    }

    if (r === 'uploads' && method === 'POST') {
      const denied = need('EDITOR');
      if (denied) return denied;
      const ext = /\.(\w+)$/.exec(body.filename)?.[1]?.toLowerCase();
      if (!MIME[ext]) return problem(400, 'Unsupported file type. Allowed: PDF, DOCX, EPUB, TXT, MD', 'UNSUPPORTED_TYPE');
      const id = uuid();
      db.uploads.set(id, { ...body, workspaceId: wid });
      return ok({ uploadId: id, method: 'PUT', url: `/api/workspaces/${wid}/uploads/${id}/content`, headers: { 'Content-Type': MIME[ext] }, mode: 'proxy' }, 201);
    }
    if (rest[0] === 'uploads' && rest[1]) {
      const up = db.uploads.get(rest[1]);
      if (!up || up.workspaceId !== wid) return problem(404, 'Not found');
      if (rest[2] === 'content' && method === 'PUT') return (up.received = true), ok({ received: up.sizeBytes });
      if (rest[2] === 'complete' && method === 'POST') {
        if (!up.received) return problem(400, 'No content was uploaded', 'NO_CONTENT');
        const p = db.projects.find((x) => x.id === up.projectId);
        const quarantined = /quarantine|\.exe\./i.test(up.filename);
        const state = quarantined ? 'QUARANTINED' : 'PREVIEW_READY';
        let s;
        if (up.sourceId) {
          s = db.sources.find((x) => x.id === up.sourceId);
          const prev = db.versions.filter((v) => v.sourceId === s.id);
          const vid = uuid();
          db.versions.push({ ...prev[0], id: vid, versionNo: prev.length + 1, sizeBytes: up.sizeBytes, ingestionState: state, ingestionError: null, createdAt: iso() });
          s.currentVersionId = vid;
          s.ingestionState = state;
          s.updatedAt = iso();
          fakeAi.knowledge.markStale(s.id, vid);
        } else {
          s = addSource(p, up.filename, state, up.folderId ? { id: up.folderId } : null, 0);
          db.versions.find((v) => v.id === s.currentVersionId).sizeBytes = up.sizeBytes;
        }
        db.uploads.delete(rest[1]);
        return ok({ sourceId: s.id, versionId: s.currentVersionId, state, ...(quarantined ? { reason: 'executable content' } : {}) }, 201);
      }
    }

    const written = fakeWriter.handle(method, wid, rest, body, need, u.searchParams);
    if (written) return written;
    return fakeAi.handle(method, wid, rest, body, headers, need, u.searchParams) ?? problem(404, 'Not found');
  }

  function publicUser() {
    const { password: _password, ...u } = db.user;
    return u;
  }

  return { db, handle, ai: fakeAi, writer: fakeWriter };
}

/** Routes `fetch` to a fake API inside jsdom tests. Returns the fake for assertions. */
export function installFakeFetch(fake = createFakeApi()) {
  document.cookie = `fv_csrf=${FAKE_CSRF}; path=/`;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    const res = fake.handle(init.method ?? 'GET', url, body, headers);
    const payload = res.body == null ? null : typeof res.body === 'string' || res.body instanceof Uint8Array ? res.body : JSON.stringify(res.body);
    return new Response(payload, { status: res.status, headers: res.headers });
  };
  return fake;
}
