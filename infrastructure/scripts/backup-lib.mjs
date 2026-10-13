/**
 * Shared helpers for backup.mjs, restore.mjs and backup-restore-test.mjs. Postgres tools run
 * inside the compose `postgres` container, or FV_PG_CONTAINER (e.g. `fv-postgres` on the lean data
 * VM), so no local pg_dump is needed; Qdrant is reached over REST at QDRANT_URL.
 * Nothing here prints connection strings or credentials.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, readFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { loadEnv, ROOT } from './lib.mjs';

const env = { ...loadEnv(), ...process.env };
export const QDRANT_URL = (env.QDRANT_URL || 'http://localhost:6333').replace(/\/$/, '');
export const COLLECTION = env.FV_QDRANT_COLLECTION || 'fv_chunks_v1';
export const PG_USER = 'folioverse';

export function postgresContainer() {
  if (env.FV_PG_CONTAINER) return env.FV_PG_CONTAINER;
  const r = spawnSync('docker', ['compose', 'ps', '-q', 'postgres'], { cwd: ROOT, encoding: 'utf8' });
  const id = r.stdout.trim().split(/\s+/)[0];
  if (!id) throw new Error('The compose postgres service is not running (pnpm up -- --infra).');
  return id;
}

/** Runs a command in the postgres container, streaming stdin from `input` and stdout to `output`. */
export function pgExec(args, { input, output } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', postgresContainer(), ...args], { cwd: ROOT, stdio: 'pipe' });
    let out = '';
    let err = '';
    const flushed = output ? new Promise((r) => output.once('finish', r)) : Promise.resolve();
    if (output) child.stdout.pipe(output);
    else child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    if (input) createReadStream(input).pipe(child.stdin);
    else child.stdin.end();
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`${args[0]} exited with ${code}: ${err.trim().slice(0, 400)}`));
      flushed.then(() => resolve(out), reject);
    });
  });
}

export const psql = (db, sql) => pgExec(['psql', '-U', PG_USER, '-d', db, '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql]);

/** Row count of every base table in the application schemas, as { "schema.table": n }. */
export async function tableCounts(db) {
  const sql = `SELECT table_schema || '.' || table_name, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text
    FROM information_schema.tables WHERE table_type = 'BASE TABLE' AND table_schema IN ('app', 'ai', 'rec', 'langgraph') ORDER BY 1`;
  const out = await psql(db, sql);
  return Object.fromEntries(
    out
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => {
        const [k, v] = l.split('|');
        return [k, Number(v)];
      }),
  );
}

export async function databaseExists(db) {
  return (await psql('postgres', `SELECT 1 FROM pg_database WHERE datname = '${db.replace(/'/g, "''")}'`)).trim() === '1';
}

export async function qdrant(method, path, body, headers = {}) {
  const res = await fetch(`${QDRANT_URL}${path}`, { method, body, headers, signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`Qdrant ${method} ${path} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res;
}

export async function collectionPoints(name) {
  const res = await fetch(`${QDRANT_URL}/collections/${name}`, { signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) return null;
  const body = await res.json();
  return body.result?.points_count ?? 0;
}

export async function sha256(file) {
  const h = createHash('sha256');
  await pipeline(createReadStream(file), h);
  return h.digest('hex');
}

export async function download(res, file) {
  await pipeline(res.body, createWriteStream(file));
}

export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
