import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { smokeDeployed } from '../scripts/smoke-deployed.mjs';

const SECURE = {
  'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
};

function deployment({ aiUp = true, leaky = false, secureCookies = true }) {
  return createServer((req, res) => {
    const url = req.url ?? '/';
    if (url === '/healthz') return res.writeHead(200).end();
    if (url === '/') {
      const headers = leaky ? { 'content-type': 'text/html' } : { 'content-type': 'text/html', ...SECURE, 'strict-transport-security': 'max-age=31536000' };
      return res.writeHead(200, headers).end('<div id="root"></div>');
    }
    if (url === '/api/auth/csrf') {
      const cookie = `fv_csrf=abc; Path=/; SameSite=Lax${secureCookies ? '; Secure' : ''}`;
      return res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': cookie }).end('{"csrfToken":"abc"}');
    }
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
  await start('insecureCookies', { secureCookies: false });
});

/** Serves https://fv.test from a local HTTP server; http://fv.test answers with a redirect to HTTPS. */
const viaFakeTls = (server, redirect = true) => (url, init) => {
  const u = new URL(url);
  if (u.protocol === 'http:' && u.hostname === 'fv.test') {
    return Promise.resolve(redirect ? new Response(null, { status: 308, headers: { location: `https://fv.test${u.pathname}` } }) : new Response('plain', { status: 200 }));
  }
  return fetch(url.replace('https://fv.test', servers[server].base), init);
};
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

test('--require-https passes with HSTS, Secure cookies and an HTTP redirect', async () => {
  const lines = [];
  const r = await smokeDeployed({ base: 'https://fv.test', fetchImpl: viaFakeTls('healthy'), log: (l) => lines.push(l), requireHttps: true });
  assert.equal(r.ok, true, lines.join('\n'));
});

test('--require-https reports cookies without Secure and a missing redirect', async () => {
  const lines = [];
  const r = await smokeDeployed({ base: 'https://fv.test', fetchImpl: viaFakeTls('insecureCookies', false), log: (l) => lines.push(l), requireHttps: true });
  assert.deepEqual(r.failures, ['https: Secure cookies', 'https: HTTP redirects to HTTPS']);
  assert.match(lines.join('\n'), /COOKIE_SECURE must be true/);
});
