#!/usr/bin/env node
/**
 * Creates .env from .env.example when missing and fills empty secrets locally:
 * FV_JWT_SECRET and the ES256 internal key pair. Existing values are never replaced.
 * Secret values are never printed.
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENV_FILE, ROOT } from './lib.mjs';

export function ensureEnvFile() {
  const example = resolve(ROOT, '.env.example');
  let text = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : readFileSync(example, 'utf8');
  const filled = [];
  const setIfEmpty = (key, value) => {
    const re = new RegExp(`^${key}=(.*)$`, 'm');
    const m = text.match(re);
    if (m && m[1].trim() !== '') return;
    const line = `${key}=${value}`;
    text = m ? text.replace(re, () => line) : `${text.trimEnd()}\n${line}\n`;
    filled.push(key);
  };
  setIfEmpty('FV_JWT_SECRET', randomBytes(48).toString('base64url'));
  const current = text.match(/^FV_INTERNAL_JWT_PRIVATE_KEY=(.*)$/m)?.[1]?.trim();
  if (!current) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const esc = (pem) => `"${pem.trim().replace(/\n/g, '\\n')}"`;
    setIfEmpty('FV_INTERNAL_JWT_PRIVATE_KEY', esc(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()));
    text = text.replace(/^FV_INTERNAL_JWT_PUBLIC_KEY=.*$/m, () => `FV_INTERNAL_JWT_PUBLIC_KEY=${esc(publicKey.export({ type: 'spki', format: 'pem' }).toString())}`);
    filled.push('FV_INTERNAL_JWT_PUBLIC_KEY');
  }
  writeFileSync(ENV_FILE, text);
  return filled;
}

if (process.argv[1]?.endsWith('gen-keys.mjs')) {
  const filled = ensureEnvFile();
  console.log(filled.length ? `gen-keys: generated ${filled.join(', ')} in .env (values not shown)` : 'gen-keys: .env already has all secrets');
}
