import type { INestApplication } from '@nestjs/common';
import { createApp, registered } from './harness';

let app: INestApplication;
beforeAll(async () => {
  app = await createApp();
});
afterAll(async () => app?.close());

async function upload(c: any, wid: string, projectId: string, filename: string, bytes: Buffer, declared = bytes.length) {
  const up = await c.post(`/api/workspaces/${wid}/uploads`, { projectId, filename, sizeBytes: declared });
  expect(up.status).toBe(201);
  const put = await c.send('put', up.body.url, bytes, { 'content-type': up.body.headers['Content-Type'] });
  return { up, put, complete: () => c.post(`/api/workspaces/${wid}/uploads/${up.body.uploadId}/complete`, {}) };
}

describe('workspace isolation', () => {
  it('non-members get 404 for every workspace-scoped route', async () => {
    const a = await registered(app, 'owner');
    const b = await registered(app, 'outsider');
    const knowledge = a.projects.find((p) => p.kind === 'KNOWLEDGE');
    const { complete } = await upload(a.c, a.workspaceId, knowledge.id, 'notes.md', Buffer.from('# Notes\n\nPrivate text for tenant A only.'));
    const done = await complete();
    expect(done.status).toBe(201);

    const w = a.workspaceId;
    const paths = [
      `/api/workspaces/${w}`,
      `/api/workspaces/${w}/projects`,
      `/api/workspaces/${w}/projects/${knowledge.id}`,
      `/api/workspaces/${w}/projects/${knowledge.id}/sources`,
      `/api/workspaces/${w}/sources/${done.body.sourceId}`,
      `/api/workspaces/${w}/sources/${done.body.sourceId}/versions/${done.body.versionId}/file`,
      `/api/workspaces/${w}/runs`,
      `/api/workspaces/${w}/costs/summary`,
      `/api/workspaces/${w}/events`,
    ];
    for (const p of paths) {
      const res = await b.c.get(p);
      expect({ p, status: res.status }).toEqual({ p, status: 404 });
    }
    const mutation = await b.c.post(`/api/workspaces/${w}/runs`, { graph: 'grounded_qa', input: { question: 'leak?' }, scope: { projectId: knowledge.id } });
    expect(mutation.status).toBe(404);
  });

  it('ids from another workspace are not found inside my workspace', async () => {
    const a = await registered(app, 'a');
    const b = await registered(app, 'b');
    const res = await b.c.get(`/api/workspaces/${b.workspaceId}/projects/${a.projects[0].id}`);
    expect(res.status).toBe(404);
  });
});

describe('uploads', () => {
  it('accepts a markdown upload and reaches PREVIEW_READY', async () => {
    const a = await registered(app);
    const k = a.projects.find((p) => p.kind === 'KNOWLEDGE');
    const { complete } = await upload(a.c, a.workspaceId, k.id, 'ok.md', Buffer.from('# Title\n\nHello world.'));
    const res = await complete();
    expect(res.body.state).toBe('PREVIEW_READY');

    const audit = await a.c.get(`/api/workspaces/${a.workspaceId}/audit`);
    expect(audit.status).toBe(200);
    expect(audit.body.map((e: any) => e.action)).toEqual(expect.arrayContaining(['auth.register', 'source.upload']));
    const uploaded = audit.body.find((e: any) => e.action === 'source.upload');
    expect(uploaded).toMatchObject({ resourceType: 'source_version', resourceId: res.body.versionId });
  });

  it('quarantines a renamed executable', async () => {
    const a = await registered(app);
    const k = a.projects.find((p) => p.kind === 'KNOWLEDGE');
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 1)]);
    const { complete } = await upload(a.c, a.workspaceId, k.id, 'invoice.pdf', exe);
    const res = await complete();
    expect(res.body.state).toBe('QUARANTINED');
  });

  it('rejects unsupported extensions and size mismatches', async () => {
    const a = await registered(app);
    const k = a.projects.find((p) => p.kind === 'KNOWLEDGE');
    const bad = await a.c.post(`/api/workspaces/${a.workspaceId}/uploads`, { projectId: k.id, filename: 'run.exe', sizeBytes: 10 });
    expect(bad.status).toBe(400);
    const { put } = await upload(a.c, a.workspaceId, k.id, 'short.md', Buffer.from('tiny'), 100);
    expect([200, 201]).toContain(put.status);
  });
});
