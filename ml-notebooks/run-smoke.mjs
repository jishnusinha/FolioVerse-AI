#!/usr/bin/env node
/**
 * Executes the ml-notebooks with jupytext + nbclient.
 *
 *   node ml-notebooks/run-smoke.mjs            smoke mode (KAGGLE_SMOKE=1, tiny samples, 120 s per notebook);
 *                                              executed copies go to a temp dir, metrics to results/smoke/
 *   node ml-notebooks/run-smoke.mjs --full     full mode; rewrites the paired .ipynb files with outputs and
 *                                              datasets/evaluation/results/nb-*.json (the committed references)
 *   node ml-notebooks/run-smoke.mjs --only 03  run notebooks whose name starts with 03
 *   node ml-notebooks/run-smoke.mjs --out dir  keep the executed smoke notebooks in dir
 *
 * Needs the notebooks extra: python -m uv sync --all-packages --extra dev --extra notebooks
 * FV_UV selects the uv command (default "python -m uv"; CI sets "uv").
 * Nothing here calls a paid provider: notebooks use the mock model and the hash embedder (smoke mode).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const full = args.includes('--full');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const keep = args.includes('--out') ? resolve(args[args.indexOf('--out') + 1]) : null;
const LIMIT_S = full ? 1800 : 120;
const [uvCmd, ...uvArgs] = (process.env.FV_UV || 'python -m uv').split(' ');

const notebooks = readdirSync(DIR)
  .filter((f) => /^\d\d_.+\.py$/.test(f))
  .filter((f) => !only || f.startsWith(only))
  .sort();
if (!notebooks.length) {
  console.error('no notebooks matched');
  process.exit(1);
}

if (keep) mkdirSync(keep, { recursive: true });
const out = full ? null : keep || mkdtempSync(join(tmpdir(), 'fv-notebooks-'));
const env = {
  ...process.env,
  FV_NOTEBOOK_DIR: DIR,
  PYTHONIOENCODING: 'utf-8',
  MPLBACKEND: 'Agg',
  ...(full ? {} : { KAGGLE_SMOKE: '1' }),
};
if (full) delete env.KAGGLE_SMOKE;
for (const v of ['OPENAI_API_KEY', 'FV_OLLAMA_URL', 'FV_LIVE_PROVIDER_TESTS']) delete env[v];

function execute(nb) {
  const target = full ? join(DIR, nb.replace(/\.py$/, '.ipynb')) : join(out, nb.replace(/\.py$/, '.ipynb'));
  const cmd = [...uvArgs, 'run', 'jupytext', '--to', 'ipynb', '--execute', '--output', target, join(DIR, nb)];
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn(uvCmd, cmd, { cwd: DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    child.stderr.on('data', (d) => (log += d));
    const timer = setTimeout(() => {
      log += `\nTIMEOUT after ${LIMIT_S}s`;
      child.kill('SIGKILL');
    }, LIMIT_S * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ nb, ok: code === 0, seconds: (Date.now() - started) / 1000, log });
    });
  });
}

const results = [];
for (const nb of notebooks) {
  const r = await execute(nb);
  results.push(r);
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${nb.padEnd(40)} ${r.seconds.toFixed(1).padStart(6)} s`);
  if (!r.ok) console.log(r.log.split('\n').slice(-25).join('\n'));
}
if (out && !keep) rmSync(out, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
const total = results.reduce((s, r) => s + r.seconds, 0);
console.log(`\n${results.length - failed.length}/${results.length} notebooks passed in ${total.toFixed(0)} s (${full ? 'full' : 'smoke'} mode)`);
process.exit(failed.length ? 1 : 0);
