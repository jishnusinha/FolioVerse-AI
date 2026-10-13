import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { smokeDeployed } from '../scripts/smoke-deployed.mjs';

const SECURE = {
  'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
};

function deployment({ aiUp = true, leaky = false }) {
  return createServer((req, res) => {
    const url = req.url ?? '/';
    if (url === '/healthz') return res.writeHead(200).end();
    if (url === '/') return res.writeHead(200, leaky ? { 'content-type': 'text/html' } : { 'content-type': 'text/html', ...SECURE }).end('<div id="root"></div>');
    if (url === '/api/live') return res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}');
    if (url === '/api/ready') {
      const checks = { database: true, redis: true, storage: true, aiService: aiUp };
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'ready', checks }));
    }
    if (url.startsWith('/api/')) return res.writeHead(401, { 'content-type': 'application/json' }).end('{"title":"Unauthorized"}');
    res.writeHead(404).end();
  });
}

const servers = {};
async function start(name, opts) {
  const s = deployment(opts);
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  servers[name] = { server: s, base: `http://127.0.0.1:${s.address().port}` };
}

before(async () => {
  await start('healthy', {});
  await start('degraded', { aiUp: false, leaky: true });
});
after(() => Promise.all(Object.values(servers).map(({ server }) => new Promise((r) => server.close(r)))));

test('passes against a healthy deployment without writing anything', async () => {
  const lines = [];
  const methods = new Set();
  const fetchImpl = (url, init) => {
    methods.add(init?.method ?? 'GET');
    return fetch(url, init);
  };
  const r = await smokeDeployed({ base: servers.healthy.base, fetchImpl, log: (l) => lines.push(l) });
  assert.equal(r.ok, true, lines.join('\n'));
  assert.deepEqual([...methods], ['GET']);
});

test('reports missing security headers and an unreachable AI service', async () => {
  const lines = [];
  const r = await smokeDeployed({ base: servers.degraded.base, log: (l) => lines.push(l) });
  assert.equal(r.ok, false);
  assert.deepEqual(r.failures, ['web shell and security headers', 'api /api/ready']);
  assert.match(lines.join('\n'), /AI service unreachable/);
});
