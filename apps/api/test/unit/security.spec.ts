import { Writable } from 'node:stream';
import pino from 'pino';
import { resetEnvCache } from '../../src/config/env';
import { setAuthCookies } from '../../src/common/http';
import { loggerOptions } from '../../src/common/logger';
import { AiServiceError } from '../../src/modules/ai-client/ai-client.service';
import { IngestionExecutorService } from '../../src/modules/ingestion/ingestion-executor.service';

function cookiesFrom(secure: boolean) {
  process.env.COOKIE_SECURE = String(secure);
  resetEnvCache();
  const jar: Record<string, Record<string, unknown>> = {};
  const res = { cookie: (name: string, _value: string, opts: Record<string, unknown>) => (jar[name] = opts) };
  setAuthCookies(res as never, { access: 'a', refresh: 'r', csrf: 'c', accessMaxAgeMs: 1000, refreshMaxAgeMs: 2000 });
  return jar;
}

describe('session cookies', () => {
  afterEach(() => {
    delete process.env.COOKIE_SECURE;
    resetEnvCache();
  });

  it('keeps tokens HttpOnly and SameSite=Lax, and the refresh token on the auth path only', () => {
    const jar = cookiesFrom(false);
    expect(jar.fv_at).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', secure: false });
    expect(jar.fv_rt).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/api/auth' });
    expect(jar.fv_csrf).toMatchObject({ httpOnly: false, sameSite: 'lax' });
  });

  it('marks every cookie Secure when COOKIE_SECURE is on (required in production)', () => {
    const jar = cookiesFrom(true);
    for (const name of ['fv_at', 'fv_rt', 'fv_csrf']) expect(jar[name].secure).toBe(true);
  });
});

describe('log redaction', () => {
  it('never writes credentials, cookies or document text', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const log = pino({ ...loggerOptions, level: 'info' }, sink);
    const secrets = ['hunter2-password', 'rt-secret-token', 'Bearer abc.def', 'fv_at=xyz', 'sk-live-123', 'private passage text'];
    log.info(
      {
        password: secrets[0],
        user: { password: secrets[0], refreshToken: secrets[1] },
        req: { headers: { authorization: secrets[2], cookie: secrets[3] } },
        provider: { apiKey: secrets[4] },
        chunk: { text: secrets[5] },
        content: secrets[5],
        runId: 'r-1',
      },
      'request',
    );
    const out = lines.join('');
    for (const s of secrets) expect(out).not.toContain(s);
    expect(out).toContain('[REDACTED]');
    expect(out).toContain('r-1');
  });
});

describe('ingestion when the AI service stops mid-stream', () => {
  function executor(events: object[]) {
    const updates: Record<string, unknown>[] = [];
    const states: string[] = [];
    const version = { id: 'v1', sourceId: 's1', storedObjectId: 'o1', mimeType: 'application/pdf', sha256: 'x', ingestionState: 'UPLOADED' };
    const prisma = {
      ingestionJob: {
        findUnique: async () => ({ id: 'j1', workspaceId: 'w1', sourceVersionId: 'v1' }),
        update: async ({ data }: { data: Record<string, unknown> }) => updates.push(data),
      },
      sourceVersion: { findUnique: async () => version, update: async () => undefined },
      source: { findUnique: async () => ({ id: 's1', projectId: 'p1', title: 'Doc', deletedAt: null }) },
      storedObject: { findUniqueOrThrow: async () => ({ key: 'k' }) },
    };
    const ai = {
      async *stream() {
        for (const e of events) yield e;
      },
    };
    const sources = {
      setState: async (_w: string, _s: string, _v: string, state: string) => states.push(state),
      stage: async () => undefined,
    };
    const svc = new IngestionExecutorService(
      prisma as never,
      { signedGetUrl: async () => 'http://storage/k' } as never,
      ai as never,
      sources as never,
      {} as never,
    );
    return { svc, updates, states };
  }

  const stageOnly = [{ type: 'ingestion.stage', data: { state: 'PARSING', progress: 0.25 } }];

  it('retries when the stream ends without a result', async () => {
    const { svc, states } = executor(stageOnly);
    const err = await svc.execute('j1', 1, 3).catch((e) => e);
    expect(err).toBeInstanceOf(AiServiceError);
    expect(err.retryable).toBe(true);
    expect(states).not.toContain('FAILED');
  });

  it('marks the version FAILED after the last attempt', async () => {
    const { svc, updates, states } = executor(stageOnly);
    await svc.execute('j1', 3, 3);
    expect(states.at(-1)).toBe('FAILED');
    expect(updates.at(-1)).toMatchObject({ state: 'FAILED', error: 'AI service stream ended without a result' });
  });

  it('records a permanent parse failure without retrying', async () => {
    const { svc, states } = executor([...stageOnly, { type: 'ingestion.finished', data: { state: 'FAILED', stats: {}, error: 'Unreadable PDF' } }]);
    await svc.execute('j1', 1, 3);
    expect(states.at(-1)).toBe('FAILED');
  });
});
