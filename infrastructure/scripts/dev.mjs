#!/usr/bin/env node
/**
 * Native development: runs web (Vite :5173), API (:3000), API worker, AI api (:8000) and AI ingest (:8001)
 * against the data services from `pnpm up -- --infra`. Output lines are prefixed by service.
 */
import { spawn } from 'node:child_process';
import { ROOT, loadEnv } from './lib.mjs';

for (const [k, v] of Object.entries(loadEnv())) if (process.env[k] === undefined) process.env[k] = v;
const env = process.env;
const py = ['python', '-m', 'uv', 'run', '--directory', 'apps/ai-service', 'python', '-m', 'folioverse_ai.serve', '--host', '127.0.0.1'];
const services = [
  { name: 'web', color: 35, cmd: 'pnpm', args: ['--filter', '@folioverse/web', 'run', 'dev'] },
  { name: 'api', color: 36, cmd: 'pnpm', args: ['--filter', '@folioverse/api', 'run', 'dev'] },
  { name: 'worker', color: 34, cmd: 'pnpm', args: ['--filter', '@folioverse/api', 'run', 'dev:worker'], env: { FV_SERVICE_NAME: 'api-worker', FV_RUN_CONCURRENCY: process.env.FV_RUN_CONCURRENCY ?? '20' } },
  { name: 'ai-api', color: 33, cmd: py[0], args: [...py.slice(1), '--port', '8000', '--env-file', '../../.env'], env: { ROLE: 'api' } },
  { name: 'ai-ingest', color: 32, cmd: py[0], args: [...py.slice(1), '--port', '8001', '--env-file', '../../.env'], env: { ROLE: 'ingest' } },
];
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const children = [];
for (const s of services.filter((x) => !only.length || only.includes(x.name))) {
  const child = spawn(s.cmd, s.args, { cwd: ROOT, env: { ...env, ...(s.env ?? {}) }, shell: process.platform === 'win32' });
  const prefix = `\x1b[${s.color}m${s.name.padEnd(9)}\x1b[0m│ `;
  const pipe = (stream) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const line of lines) process.stdout.write(prefix + line + '\n');
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('exit', (code) => process.stdout.write(`${prefix}exited with ${code}\n`));
  children.push(child);
}
const stop = () => {
  for (const c of children) c.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
