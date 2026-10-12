import type { INestApplication } from '@nestjs/common';
import { SignJWT } from 'jose';
import { env } from '../../src/config/env';
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

  it('an expired access token is rejected with 401 and refresh restores the session', async () => {
    const { c, userId, email } = await registered(app);
    const expired = await new SignJWT({ email, role: 'USER' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer('folioverse-api')
      .setAudience('folioverse-web')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 1200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 600)
      .sign(new TextEncoder().encode(env().FV_JWT_SECRET));
    c.cookies.set('fv_at', expired);
    const denied = await c.get('/api/auth/me');
    expect(denied.status).toBe(401);
    expect(denied.body.code).toBe('TOKEN_EXPIRED');
    expect((await c.post('/api/auth/refresh')).status).toBe(200);
    expect((await c.get('/api/auth/me')).status).toBe(200);
  });

  it('logout revokes the refresh token', async () => {
    const { c } = await registered(app);
    const rt = c.cookies.get('fv_rt')!;
    expect((await c.post('/api/auth/logout')).status).toBe(204);
    expect(c.cookies.has('fv_at')).toBe(false);
    const replay = new Client(app);
    replay.cookies.set('fv_rt', rt);
    expect((await replay.post('/api/auth/refresh')).status).toBe(401);
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

  // Runs last: it exhausts the forgot-password quota for this app instance.
  it('rate-limits password reset requests', async () => {
    const c = new Client(app);
    await c.get('/api/auth/csrf');
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await c.post('/api/auth/forgot-password', { email: `nobody-${i}@example.test` })).status);
    expect(statuses.at(-1)).toBe(429);
  });
});
