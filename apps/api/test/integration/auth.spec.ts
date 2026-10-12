import type { INestApplication } from '@nestjs/common';
import { MailService } from '../../src/modules/mail/mail.service';
import { Client, createApp, registered } from './harness';

let app: INestApplication;
beforeAll(async () => {
  app = await createApp();
});
afterAll(async () => app?.close());

describe('health', () => {
  it('live and ready', async () => {
    const c = new Client(app);
    expect((await c.get('/api/live')).status).toBe(200);
    const ready = await c.get('/api/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.checks).toMatchObject({ database: true, redis: true, storage: true });
  });
});

describe('auth', () => {
  it('register creates a personal workspace with three projects and sets cookies', async () => {
    const { c, projects } = await registered(app);
    expect([...c.cookies.keys()].sort()).toEqual(['fv_at', 'fv_csrf', 'fv_rt']);
    expect(projects.map((p) => p.kind).sort()).toEqual(['KNOWLEDGE', 'LIBRARY', 'WRITER']);
  });

  it('rejects cookie-authenticated mutations without the CSRF header', async () => {
    const { c, workspaceId } = await registered(app);
    c.csrf = false;
    const res = await c.post(`/api/workspaces/${workspaceId}/projects`, { name: 'x', kind: 'KNOWLEDGE' });
    expect(res.status).toBe(403);
  });

  it('requires authentication', async () => {
    const res = await new Client(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const { c } = await registered(app);
    const first = c.cookies.get('fv_rt')!;
    const r1 = await c.post('/api/auth/refresh');
    expect(r1.status).toBe(200);
    const second = c.cookies.get('fv_rt')!;
    expect(second).not.toBe(first);

    // Replaying the old token is detected and kills the whole family.
    const attacker = new Client(app);
    attacker.cookies.set('fv_rt', first);
    expect((await attacker.post('/api/auth/refresh')).status).toBe(401);
    const victim = new Client(app);
    victim.cookies.set('fv_rt', second);
    expect((await victim.post('/api/auth/refresh')).status).toBe(401);
  });

  it('wrong password and unknown email look the same', async () => {
    const { email } = await registered(app);
    const c = new Client(app);
    const a = await c.post('/api/auth/login', { email, password: 'definitely-wrong-1' });
    const b = await c.post('/api/auth/login', { email: `nobody-${Date.now()}@example.test`, password: 'definitely-wrong-1' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.detail).toBe(b.body.detail);
  });

  it('password reset uses a single-use emailed token', async () => {
    const { email } = await registered(app);
    const mail = app.get(MailService);
    const c = new Client(app);
    await c.get('/api/auth/csrf');
    expect((await c.post('/api/auth/forgot-password', { email })).status).toBeLessThan(300);
    const msg = [...mail.outbox].reverse().find((m: any) => m.to === email && /reset/i.test(m.subject));
    expect(msg).toBeTruthy();
    const token = /token=([\w-]+)/.exec((msg as any).text)![1];
    const pw = 'New-password-123456';
    expect((await c.post('/api/auth/reset-password', { token, password: pw })).status).toBeLessThan(300);
    expect((await c.post('/api/auth/reset-password', { token, password: pw })).status).toBe(400);
    expect((await c.post('/api/auth/login', { email, password: pw })).status).toBe(200);
  });
});
