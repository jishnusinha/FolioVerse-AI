#!/usr/bin/env node
/**
 * Security suite (plan Section M): repo hygiene, secret scan, authz/IDOR, auth hardening, upload guards,
 * internal JWT + ScopeToken, prompt injection, redaction and failure injection. No paid provider calls.
 *
 *   pnpm test:security                      everything except dependency audits
 *   pnpm test:security -- --no-integration  skip the API integration specs (no Postgres/Redis/S3 needed)
 *   pnpm test:security -- --audit           also run pnpm audit (prod, high+) and pip-audit
 *   pnpm test:security -- --strict          a missing scanner (gitleaks) fails instead of being skipped
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, rmSync, statSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const argv = new Set(process.argv.slice(2));
const INTEGRATION = !argv.has('--no-integration');
const AUDIT = argv.has('--audit');
const STRICT = argv.has('--strict');
const GITLEAKS_IMAGE = 'zricethezav/gitleaks:v8.24.3';
const WIN = process.platform === 'win32';

const quote = (a) => (WIN && /[\s|&<>^"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);

function exec(cmd, args, opts = {}) {
  return new Promise((done) => {
    const child = spawn(cmd, args.map(quote), { cwd: ROOT, stdio: 'inherit', shell: WIN, ...opts });
    child.on('exit', (code) => done(code ?? 1));
    child.on('error', () => done(127));
  });
}

const has = (cmd, args = ['--version']) => spawnSync(cmd, args, { shell: WIN, stdio: 'ignore' }).status === 0;
const [UV, ...UV_ARGS] = has('uv') ? ['uv'] : ['python', '-m', 'uv'];
const uv = (args) => exec(UV, [...UV_ARGS, ...args]);

const reachable = (port) =>
  new Promise((done) => {
    const s = createConnection({ host: '127.0.0.1', port, timeout: 1500 });
    s.on('connect', () => (s.destroy(), done(true)));
    s.on('error', () => done(false));
    s.on('timeout', () => (s.destroy(), done(false)));
  });

class Skip extends Error {}

/** Tracked files must not include env files, key material or private keys. */
function hygiene() {
  const files = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).stdout.split('\0').filter(Boolean);
  if (!files.length) throw new Error('git ls-files returned nothing');
  const bad = [];
  for (const f of files) {
    const base = f.split('/').pop();
    if (/^\.env(\..+)?$/.test(base) && !/\.example$/.test(base)) bad.push(`${f}: env file`);
    if (/\.(pem|key|p12|pfx)$/i.test(base) || /^id_(rsa|ed25519|ecdsa)$/.test(base)) bad.push(`${f}: key file`);
    if (/(^|\/)(credentials|service-account)[^/]*\.json$/i.test(f)) bad.push(`${f}: credentials file`);
  }
  const PRIVATE_KEY = /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/;
  for (const f of files) {
    let st;
    try {
      st = statSync(join(ROOT, f));
    } catch {
      continue;
    }
    if (st.size > 2_000_000 || /\.(png|jpe?g|gif|webp|pdf|epub|docx|woff2?|ico|zip|gz|parquet|lock)$/i.test(f)) continue;
    if (PRIVATE_KEY.test(readFileSync(join(ROOT, f), 'latin1'))) bad.push(`${f}: contains a private key block`);
  }
  if (bad.length) throw new Error(`committed secrets material:\n  ${bad.join('\n  ')}`);
  console.log(`  ${files.length} tracked files, no env files or private keys`);
}

async function gitleaks() {
  const args = ['git', '--redact', '--no-banner', '--exit-code', '1'];
  if (has('gitleaks', ['version'])) return exec('gitleaks', [...args, '.']);
  if (has('docker', ['info'])) return exec('docker', ['run', '--rm', '-v', `${ROOT}:/repo`, GITLEAKS_IMAGE, ...args, '/repo']);
  throw new Skip('gitleaks is not installed and Docker is not running');
}

async function pnpmAudit() {
  return exec('pnpm', ['audit', '--prod', '--audit-level', 'high']);
}

async function pipAudit() {
  const req = join(tmpdir(), `fv-pip-audit-${process.pid}.txt`);
  try {
    const exported = await uv([
      'export', '--all-packages', '--no-dev', '--no-hashes', '--no-emit-workspace',
      '--format', 'requirements-txt', '--quiet', '-o', req,
    ]);
    if (exported !== 0) return exported;
    return await uv(['tool', 'run', 'pip-audit', '-r', req, '--no-deps', '--disable-pip', '--progress-spinner', 'off']);
  } finally {
    rmSync(req, { force: true });
  }
}

const jestUnit = (files) => () => exec('pnpm', ['--filter', '@folioverse/api', 'exec', 'jest', '--config', 'jest.config.js', ...files]);
const jestIntegration = (files, filter) => async () => {
  for (const [name, port] of [['Postgres', 5432], ['Redis', 6379]]) {
    if (!(await reachable(port))) throw new Error(`${name} is not reachable on ${port}; run \`pnpm up -- --infra\` or pass --no-integration`);
  }
  const t = filter ? ['-t', filter] : [];
  return exec('pnpm', ['--filter', '@folioverse/api', 'exec', 'jest', '--config', 'jest.integration.config.js', '--runInBand', ...t, ...files]);
};
const pytest = (files, k) => () =>
  uv(['run', '--directory', 'apps/ai-service', 'pytest', '-q', ...(k ? ['-k', k] : []), ...files]);

const steps = [
  ['Repo hygiene: no .env or key material tracked', async () => (hygiene(), 0)],
  ['Secret scan: gitleaks over git history', gitleaks],
  [
    'API: cookies, redaction, ingestion failure, zip/MIME guards, CSV escaping, internal JWT client',
    jestUnit(['test/unit/security.spec.ts', 'test/unit/file-scan.spec.ts', 'test/unit/ai-client.spec.ts']),
  ],
  [
    'AI service: forged tokens, ScopeToken, prompt injection, provider failures, zip bombs, redaction',
    pytest(['tests/test_security.py', 'tests/test_routes.py', 'tests/test_budget_guard.py']),
  ],
  [
    'AI service: scope isolation and failure injection in graphs',
    pytest(['tests/test_graphs.py', 'tests/test_insight_actions.py', 'tests/test_studio.py'], 'scope or fallback or timeout or retrieval_down or malformed'),
  ],
];
if (INTEGRATION) {
  steps.push(
    [
      'API integration: authz matrix, tenancy, IDOR fuzz, CSRF, rate limits, argon2id, upload guards',
      jestIntegration(['test/integration/auth.spec.ts', 'test/integration/authz.matrix.spec.ts', 'test/integration/tenancy.spec.ts', 'test/integration/security.spec.ts']),
    ],
    [
      'API integration: run isolation, budget rejection, reaper, SSE replay',
      jestIntegration(['test/integration/runs.spec.ts'], 'hides|hard budget|reaper|Last-Event-ID|cancels'),
    ],
  );
}
if (AUDIT) steps.push(['Dependencies: pnpm audit --prod (high+)', pnpmAudit], ['Dependencies: pip-audit (locked runtime deps)', pipAudit]);

const results = [];
for (const [name, fn] of steps) {
  console.log(`\n▶ ${name}`);
  const started = Date.now();
  let status;
  let note = '';
  try {
    status = (await fn()) === 0 ? 'PASS' : 'FAIL';
  } catch (e) {
    status = e instanceof Skip && !STRICT ? 'SKIP' : 'FAIL';
    note = e.message;
    console.log(`  ${status}: ${note}`);
  }
  results.push({ name, status, note, seconds: ((Date.now() - started) / 1000).toFixed(1) });
}
if (!INTEGRATION) results.push({ name: 'API integration specs', status: 'SKIP', note: '--no-integration', seconds: '0.0' });
if (!AUDIT) results.push({ name: 'Dependency audits', status: 'SKIP', note: 'pass --audit', seconds: '0.0' });

console.log('\nSecurity suite');
for (const r of results) console.log(`  ${r.status.padEnd(4)} ${r.seconds.padStart(6)}s  ${r.name}${r.note && r.status !== 'FAIL' ? ` (${r.note})` : ''}`);
const failed = results.filter((r) => r.status === 'FAIL').length;
console.log(failed ? `\n${failed} step(s) failed` : '\nAll executed steps passed');
process.exit(failed ? 1 : 0);
