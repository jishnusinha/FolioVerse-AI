import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resetEnvCache } from '../../src/config/env';
import type { CryptoService } from '../../src/common/crypto.service';
import { AiClientService, AiServiceError } from '../../src/modules/ai-client/ai-client.service';

/** AiClientService against a loopback NDJSON server (no external network). */
let server: Server;
let handler: (res: ServerResponse) => void = (res) => res.end();
let lastAuth: string | undefined;
const client = new AiClientService({ signInternal: async () => 'internal-token' } as unknown as CryptoService);

beforeAll(async () => {
  server = createServer((req, res) => {
    lastAuth = req.headers.authorization;
    req.resume();
    req.on('end', () => handler(res));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  process.env.FV_AI_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  resetEnvCache();
});
afterAll(() => {
  server.closeAllConnections();
  return new Promise((r) => server.close(r));
});

async function collect(opts: Parameters<AiClientService['stream']>[3] = {}) {
  const out: any[] = [];
  for await (const ev of client.stream('api', '/internal/runs/units', { runId: 'r' }, opts)) out.push(ev);
  return out;
}

async function failure(opts: Parameters<AiClientService['stream']>[3] = {}) {
  try {
    await collect(opts);
  } catch (e) {
    return e as AiServiceError;
  }
  throw new Error('expected the stream to fail');
}

describe('AiClientService.stream', () => {
  it('yields one event per NDJSON line, even when lines span chunks', async () => {
    handler = (res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.write('{"type":"node.started","data":{"node":"retrieve"}}\n{"type":"token.de');
      setTimeout(() => {
        res.write('lta","data":{"text":"Hi"}}\n\n');
        res.end('{"type":"run.finished","data":{"outcome":"ANSWERED"}}');
      }, 20);
    };
    const events = await collect();
    expect(events.map((e) => e.type)).toEqual(['node.started', 'token.delta', 'run.finished']);
    expect(events[1].data.text).toBe('Hi');
    expect(lastAuth).toBe('Bearer internal-token');
  });

  it('treats 5xx and 429 as retryable and 4xx as permanent', async () => {
    handler = (res) => res.writeHead(503).end('busy');
    expect(await failure()).toMatchObject({ status: 503, retryable: true });
    handler = (res) => res.writeHead(429).end();
    expect(await failure()).toMatchObject({ status: 429, retryable: true });
    handler = (res) => res.writeHead(422).end('bad spec');
    expect(await failure()).toMatchObject({ status: 422, retryable: false });
  });

  it('enforces the per-unit timeout as a retryable error', async () => {
    handler = (res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.write('{"type":"heartbeat","data":{}}\n');
    };
    const err = await failure({ timeoutMs: 150 });
    expect(err).toBeInstanceOf(AiServiceError);
    expect(err).toMatchObject({ retryable: true });
  });

  it('rejects malformed lines as a permanent protocol error', async () => {
    handler = (res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.end('{"type":"node.started"}\nnot json\n');
    };
    expect(await failure()).toMatchObject({ message: expect.stringMatching(/malformed/), retryable: false });
  });

  it('reports an unreachable service as retryable', async () => {
    process.env.FV_AI_API_URL = 'http://127.0.0.1:9';
    resetEnvCache();
    try {
      expect(await failure({ timeoutMs: 2000 })).toMatchObject({ status: 0, retryable: true });
    } finally {
      process.env.FV_AI_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resetEnvCache();
    }
  });

  it('propagates caller cancellation instead of converting it', async () => {
    handler = (res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.write('{"type":"heartbeat","data":{}}\n');
    };
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    const err = await failure({ signal: ac.signal, timeoutMs: 5000 });
    expect(err).not.toBeInstanceOf(AiServiceError);
  });
});
