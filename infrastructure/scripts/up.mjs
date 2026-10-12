#!/usr/bin/env node
/**
 * pnpm up            -> full Docker stack (build images, migrate, seed, wait for health).
 * pnpm up -- --infra -> data services only (Postgres, Redis, Qdrant, S3 storage, Mailpit), then migrate + seed
 *                       natively; start the apps with `pnpm dev`.
 */
import { ensureEnvFile } from './gen-keys.mjs';
import { loadEnv, run } from './lib.mjs';
import { waitForStack } from './wait-for-health.mjs';

const infraOnly = process.argv.includes('--infra');
const observability = process.argv.includes('--observability');

const filled = ensureEnvFile();
if (filled.length) console.log(`up: generated ${filled.join(', ')} in .env (values not shown)`);
await run('node', ['infrastructure/scripts/check-env.mjs']);

const profiles = [...(infraOnly ? [] : ['--profile', 'app']), ...(observability ? ['--profile', 'observability'] : [])];
const infra = ['postgres', 'redis', 'qdrant', 'storage', 'mailpit'];
console.log(infraOnly ? 'up: starting data services…' : 'up: building and starting the full stack…');
await run('docker', ['compose', ...profiles, 'up', '-d', ...(infraOnly ? infra : ['--build'])]);

await waitForStack({ apps: !infraOnly });

if (infraOnly) {
  console.log('up: applying migrations and seed…');
  await run('pnpm', ['--filter', '@folioverse/api', 'run', 'db:migrate']);
  // The local stack loads the synthetic DEMO discovery catalog unless .env sets FV_DEMO_CATALOG=false.
  const demoCatalog = process.env.FV_DEMO_CATALOG ?? loadEnv().FV_DEMO_CATALOG ?? 'true';
  await run('pnpm', ['--filter', '@folioverse/api', 'run', 'db:seed'], { env: { ...process.env, FV_DEMO_CATALOG: demoCatalog } });
}

console.log(`
FolioVerse is up${infraOnly ? ' (data services only — run `pnpm dev` for the apps)' : ''}:
  Web            http://localhost:${infraOnly ? '5173' : '8080'}
  API docs       http://localhost:${infraOnly ? '3000' : '8080'}/api/docs
  Mailpit        http://localhost:8025
  S3 storage     http://localhost:9000 (SeaweedFS)
  Qdrant         http://localhost:6333/dashboard${observability ? '\n  Grafana        http://localhost:3001' : ''}
`);
