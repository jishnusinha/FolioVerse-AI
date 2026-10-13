#!/usr/bin/env node
/**
 * Read-only smoke test for any deployed FolioVerse (Cloud Run, a load balancer, or `pnpm up` at
 * http://localhost:8080). It never creates accounts or data, so it is safe against production:
 *   - web: /healthz, the SPA shell, security headers (CSP, frame, nosniff)
 *   - api: /api/live, /api/ready (database, redis, storage, AI service)
 *   - auth boundary: protected JSON and SSE routes answer 401, never 5xx
 * For the full write-path vertical slice against a disposable environment use smoke.mjs.
 *
 *   node infrastructure/scripts/smoke-deployed.mjs --base https://folioverse.example.com [--api https://api...]
 *   FV_SMOKE_BASE=https://... node infrastructure/scripts/smoke-deployed.mjs
 */

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);

export async function smokeDeployed({ base, api = base, fetchImpl = fetch, log = console.log, timeoutMs = 15_000 }) {
  const failures = [];
  const get = (url, init = {}) => fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), ...init });
  const check = async (label, fn) => {
    try {
      const detail = await fn();
      log(`ok   ${label}${detail ? ` — ${detail}` : ''}`);
    } catch (e) {
      failures.push(label);
      log(`FAIL ${label} — ${e.message}`);
    }
  };
  const expect = (cond, msg) => {
    if (!cond) throw new Error(msg);
  };

  await check('web /healthz', async () => {
    const r = await get(`${base}/healthz`);
    expect(r.status === 200, `status ${r.status}`);
  });
  await check('web shell and security headers', async () => {
    const r = await get(`${base}/`);
    const html = await r.text();
    expect(r.status === 200 && /<div id="root">/.test(html), `status ${r.status}, no SPA root`);
    const csp = r.headers.get('content-security-policy') ?? '';
    expect(/default-src 'self'/.test(csp) && /frame-ancestors 'none'/.test(csp), 'CSP missing or weak');
    expect(r.headers.get('x-content-type-options') === 'nosniff', 'nosniff missing');
    expect(r.headers.get('x-frame-options') === 'DENY', 'X-Frame-Options missing');
    return 'CSP, nosniff, DENY';
  });
  await check('api /api/live', async () => {
    const r = await get(`${api}/api/live`);
    expect(r.status === 200, `status ${r.status}`);
  });
  await check('api /api/ready', async () => {
    const r = await get(`${api}/api/ready`);
    const body = await r.json().catch(() => ({}));
    const checks = body.checks ?? {};
    const summary = Object.entries(checks)
      .map(([k, v]) => `${k}=${v ? 'up' : 'down'}`)
      .join(' ');
    expect(r.status === 200, `status ${r.status} ${summary}`);
    expect(checks.aiService === true, `AI service unreachable (${summary})`);
    return summary;
  });
  await check('auth boundary: /api/auth/me without a session', async () => {
    const r = await get(`${api}/api/auth/me`);
    expect(r.status === 401, `expected 401, got ${r.status}`);
  });
  await check('auth boundary: SSE without a session', async () => {
    const r = await get(`${api}/api/workspaces/00000000-0000-7000-8000-000000000000/events`, { headers: { accept: 'text/event-stream' } });
    expect(r.status === 401, `expected 401, got ${r.status}`);
    await r.body?.cancel();
  });

  return { ok: failures.length === 0, failures };
}

if (process.argv[1]?.endsWith('smoke-deployed.mjs')) {
  const base = (arg('--base') ?? process.env.FV_SMOKE_BASE ?? 'http://localhost:8080').replace(/\/$/, '');
  const api = (arg('--api') ?? process.env.FV_SMOKE_API ?? base).replace(/\/$/, '');
  console.log(`smoke-deployed: web ${base}, api ${api}`);
  const { ok, failures } = await smokeDeployed({ base, api });
  console.log(ok ? 'SMOKE (deployed) OK' : `SMOKE (deployed) FAILED: ${failures.join(', ')}`);
  process.exit(ok ? 0 : 1);
}
