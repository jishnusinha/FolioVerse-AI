#!/usr/bin/env node
/** Runs a command with the monorepo root .env loaded (existing environment variables win). */
import { spawn } from 'node:child_process';
import { loadEnv } from './lib.mjs';

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error('usage: with-env.mjs <command> [...args]');
  process.exit(2);
}
// Mutate process.env (case-insensitive on Windows) instead of copying it, so PATH is preserved.
for (const [k, v] of Object.entries(loadEnv())) if (process.env[k] === undefined) process.env[k] = v.replace(/\\n/g, '\n');
const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
child.on('exit', (code) => process.exit(code ?? 1));
