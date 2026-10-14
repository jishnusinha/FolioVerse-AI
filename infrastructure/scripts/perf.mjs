#!/usr/bin/env node
/**
 * pnpm perf — runs the k6 load test (infrastructure/perf/load.js) against a running stack and writes the summary to
 * infrastructure/perf/results/<UTC timestamp>.json. Uses a local `k6` when installed, otherwise the grafana/k6 image
 * (which reaches a stack on this machine through host.docker.internal).
 *
 *   pnpm perf [-- --base http://localhost:3000] [--sse 50] [--ingest 20]
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib.mjs';

const K6_IMAGE = 'grafana/k6:1.3.0';
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const base = arg('--base', 'http://localhost:3000');
const sse = arg('--sse', '50');
const ingest = arg('--ingest', '20');
const WIN = process.platform === 'win32';
const has = (cmd, args) => spawnSync(cmd, args, { shell: WIN, stdio: 'ignore' }).status === 0;

const dir = join(ROOT, 'infrastructure', 'perf');
mkdirSync(join(dir, 'results'), { recursive: true });
const name = `results/${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
const env = { FV_SSE_VUS: sse, FV_INGEST_VUS: ingest, FV_SUMMARY: name };

let r;
if (has('k6', ['version'])) {
  r = spawnSync('k6', ['run', '--quiet', 'load.js'], { cwd: dir, stdio: 'inherit', shell: WIN, env: { ...process.env, ...env, FV_BASE: base } });
} else if (has('docker', ['info'])) {
  const dockerBase = base.replace(/\/\/(localhost|127\.0\.0\.1)(?=[:/]|$)/, '//host.docker.internal');
  const e = Object.entries({ ...env, FV_BASE: dockerBase }).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  r = spawnSync('docker', ['run', '--rm', '--add-host=host.docker.internal:host-gateway', '-v', `${dir}:/perf`, '-w', '/perf', ...e, K6_IMAGE, 'run', '--quiet', 'load.js'], { stdio: 'inherit' });
} else {
  console.error('perf: install k6 or start Docker');
  process.exit(1);
}

try {
  const s = JSON.parse(readFileSync(join(dir, name), 'utf8'));
  const ms = (v) => (v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);
  console.log(`\nperf summary (${sse} SSE streams, ${ingest} ingestions) → infrastructure/perf/${name}`);
  for (const m of ['run_create', 'sse_first_byte', 'sse_stream', 'ingest_ready']) {
    const v = s.metrics[m] ?? {};
    const failed = Object.entries(s.thresholds[m] ?? {}).filter(([, t]) => !t.ok).map(([k]) => k);
    console.log(`  ${m.padEnd(15)} n=${String(v.count ?? 0).padStart(3)}  p50 ${ms(v.med).padStart(9)}  p95 ${ms(v['p(95)']).padStart(9)}  max ${ms(v.max).padStart(9)}${failed.length ? `  FAILED ${failed.join(', ')}` : ''}`);
  }
} catch {
  console.error('perf: no summary was written');
}
process.exit(r.status ?? 1);
