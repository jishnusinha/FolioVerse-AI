import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const ENV_FILE = resolve(ROOT, '.env');

/** Minimal dotenv parser (KEY=VALUE, # comments, optional quotes). */
export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

export function loadEnv(file = ENV_FILE) {
  return existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
}

export function run(cmd, args, opts = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', ...opts });
    child.on('exit', (code) => (code === 0 ? resolvePromise() : reject(new Error(`${cmd} ${args.join(' ')} exited with ${code}`))));
    child.on('error', reject);
  });
}

export async function waitFor(name, check, timeoutMs = 300_000, intervalMs = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await check()) {
        console.log(`  ✓ ${name}`);
        return true;
      }
    } catch {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for ${name}`);
}

export const httpOk = (url) => async () => (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok;
