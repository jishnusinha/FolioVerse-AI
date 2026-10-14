import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { StorageService } from '../../src/infra/storage.service';

export async function createApp(): Promise<INestApplication> {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  try {
    await app.get(StorageService).ensureBucket();
  } catch (err) {
    // The caller never receives the app, so its afterAll cannot close the Redis/BullMQ handles.
    await app.close();
    throw err;
  }
  return app;
}

/** Cookie-aware client that sends the CSRF header on mutations, like the web app. */
export class Client {
  cookies = new Map<string, string>();
  csrf = true;
  constructor(private readonly app: INestApplication) {}

  private store(res: request.Response) {
    const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
    for (const c of raw ?? []) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i);
      const v = pair.slice(i + 1);
      if (v && !/Expires=Thu, 01 Jan 1970/i.test(c)) this.cookies.set(k, v);
      else this.cookies.delete(k);
    }
  }

  cookieHeader(only?: string[]) {
    return [...this.cookies]
      .filter(([k]) => !only || only.includes(k))
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  async send(method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, body?: unknown, headers: Record<string, string> = {}) {
    let r = request(this.app.getHttpServer())[method](path).set('cookie', this.cookieHeader());
    if (this.csrf && this.cookies.get('fv_csrf') && method !== 'get') r = r.set('x-csrf-token', this.cookies.get('fv_csrf')!);
    for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
    const res = body instanceof Buffer ? await r.send(body) : body !== undefined ? await r.send(body as object) : await r;
    this.store(res);
    return res;
  }
  get = (p: string) => this.send('get', p);
  post = (p: string, b: unknown = {}) => this.send('post', p, b);
  patch = (p: string, b: unknown = {}) => this.send('patch', p, b);
  del = (p: string) => this.send('delete', p);
}

export async function registered(app: INestApplication, label = 'u') {
  const c = new Client(app);
  await c.get('/api/auth/csrf');
  const email = `${label}-${randomBytes(5).toString('hex')}@example.test`;
  const password = `Pw-${randomBytes(10).toString('base64url')}`;
  const res = await c.post('/api/auth/register', { email, password, displayName: label });
  if (res.status !== 201) throw new Error(`register failed ${res.status} ${JSON.stringify(res.body)}`);
  const me = await c.get('/api/auth/me');
  const workspaceId: string = me.body.workspaces[0].id;
  const projects = await c.get(`/api/workspaces/${workspaceId}/projects`);
  return { c, email, password, userId: me.body.user.id as string, workspaceId, projects: projects.body as any[] };
}
