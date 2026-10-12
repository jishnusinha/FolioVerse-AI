#!/usr/bin/env node
/** Validates .env without printing any value. Exit code 1 when something required is missing. */
import { loadEnv } from './lib.mjs';

const env = { ...loadEnv(), ...process.env };
const required = ['DATABASE_URL', 'REDIS_URL', 'FV_JWT_SECRET', 'FV_INTERNAL_JWT_PRIVATE_KEY', 'FV_INTERNAL_JWT_PUBLIC_KEY'];
const problems = [];
for (const k of required) if (!env[k]) problems.push(`${k} is missing`);
if (env.FV_JWT_SECRET && env.FV_JWT_SECRET.length < 32) problems.push('FV_JWT_SECRET must be at least 32 characters');
if (env.FV_INTERNAL_JWT_PRIVATE_KEY && !env.FV_INTERNAL_JWT_PRIVATE_KEY.includes('BEGIN PRIVATE KEY')) problems.push('FV_INTERNAL_JWT_PRIVATE_KEY is not a PKCS8 PEM');
if (env.FV_INTERNAL_JWT_PUBLIC_KEY && !env.FV_INTERNAL_JWT_PUBLIC_KEY.includes('BEGIN PUBLIC KEY')) problems.push('FV_INTERNAL_JWT_PUBLIC_KEY is not an SPKI PEM');
if (env.NODE_ENV === 'production') {
  if (env.COOKIE_SECURE !== 'true') problems.push('COOKIE_SECURE must be true in production');
  if (env.FV_LAB_FAULTS === 'true') problems.push('FV_LAB_FAULTS must be false in production');
  if (env.STORAGE_SECRET_KEY === 'folioverse-secret') problems.push('STORAGE_SECRET_KEY uses the development default');
}
if (env.OPENAI_API_KEY && !env.FV_OPENAI_MODEL) problems.push('OPENAI_API_KEY is set but FV_OPENAI_MODEL is empty (no model id is assumed)');

const providers = ['mock (DEMO)'];
if (env.OPENAI_API_KEY && env.FV_OPENAI_MODEL) providers.push('openai');
if (env.FV_OLLAMA_URL && env.FV_OLLAMA_MODEL) providers.push('ollama');

if (problems.length) {
  console.error(`check-env: ${problems.length} problem(s):\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
console.log(`check-env: OK. Providers: ${providers.join(', ')}`);
