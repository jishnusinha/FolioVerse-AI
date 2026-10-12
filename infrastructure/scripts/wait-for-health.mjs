#!/usr/bin/env node
/** Waits for the local stack to become healthy. Used by `pnpm up` and CI. */
import { connect } from 'node:net';
import { httpOk, waitFor } from './lib.mjs';

const tcp = (port) => () =>
  new Promise((resolve) => {
    const s = connect(port, '127.0.0.1');
    s.on('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.on('error', () => resolve(false));
  });

export async function waitForStack({ apps = true, timeoutMs = 300_000 } = {}) {
  console.log('waiting for services:');
  await waitFor('postgres :5432', tcp(5432), timeoutMs);
  await waitFor('redis :6379', tcp(6379), timeoutMs);
  await waitFor('qdrant :6333', httpOk('http://127.0.0.1:6333/readyz'), timeoutMs);
  await waitFor('s3 storage :9000', tcp(9000), timeoutMs);
  await waitFor('mailpit :8025', httpOk('http://127.0.0.1:8025/livez'), timeoutMs);
  if (apps) {
    await waitFor('web + api via caddy :8080', httpOk('http://127.0.0.1:8080/api/ready'), timeoutMs);
  }
}

if (process.argv[1]?.endsWith('wait-for-health.mjs')) {
  await waitForStack({ apps: !process.argv.includes('--infra') });
}
