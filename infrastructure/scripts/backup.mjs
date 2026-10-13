#!/usr/bin/env node
/**
 * Local/self-hosted backup: Postgres custom-format dump + Qdrant collection snapshot, with a
 * manifest of sizes and SHA-256 digests. The lean GCP data VM runs the equivalent shell script
 * (infrastructure/terraform/modules/data_vm/backup.sh) nightly and uploads to the backup bucket.
 *
 *   node infrastructure/scripts/backup.mjs [--out backups/<timestamp>]
 */
import { mkdirSync, statSync, writeFileSync, createWriteStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { COLLECTION, collectionPoints, download, pgExec, PG_USER, qdrant, sha256 } from './backup-lib.mjs';
import { ROOT } from './lib.mjs';

export async function backup(outDir) {
  mkdirSync(outDir, { recursive: true });
  const pgFile = join(outDir, 'postgres.dump');
  await pgExec(['pg_dump', '-U', PG_USER, '-d', 'folioverse', '-Fc'], { output: createWriteStream(pgFile) });

  const manifest = {
    createdAt: new Date().toISOString(),
    postgres: { file: 'postgres.dump', database: 'folioverse', format: 'custom', bytes: statSync(pgFile).size, sha256: await sha256(pgFile) },
    qdrant: null,
  };

  const points = await collectionPoints(COLLECTION);
  if (points !== null) {
    const snap = await (await qdrant('POST', `/collections/${COLLECTION}/snapshots?wait=true`)).json();
    const name = snap.result.name;
    const qFile = join(outDir, 'qdrant.snapshot');
    await download(await qdrant('GET', `/collections/${COLLECTION}/snapshots/${encodeURIComponent(name)}`), qFile);
    await qdrant('DELETE', `/collections/${COLLECTION}/snapshots/${encodeURIComponent(name)}`);
    manifest.qdrant = { file: 'qdrant.snapshot', collection: COLLECTION, points, bytes: statSync(qFile).size, sha256: await sha256(qFile) };
  }

  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1]?.endsWith('backup.mjs')) {
  const i = process.argv.indexOf('--out');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = resolve(ROOT, i > 0 ? process.argv[i + 1] : join('backups', stamp));
  const m = await backup(out);
  console.log(`backup: postgres ${m.postgres.bytes} bytes${m.qdrant ? `, qdrant ${m.qdrant.collection} ${m.qdrant.points} points (${m.qdrant.bytes} bytes)` : ', no qdrant collection'} -> ${out}`);
}
