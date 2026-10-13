#!/usr/bin/env node
/**
 * Restores a backup made by backup.mjs (digests checked against manifest.json) or a directory
 * holding one *.dump and optionally one *.snapshot downloaded from the backup bucket. Restores into the named database/collection; an existing database is only
 * replaced with --replace, so the default is a side-by-side restore that cannot clobber live data.
 *
 *   node infrastructure/scripts/restore.mjs --from backups/<stamp> --database folioverse_restored \
 *     [--collection fv_chunks_restored] [--replace]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { collectionPoints, databaseExists, pgExec, PG_USER, psql, qdrant, readJson, sha256 } from './backup-lib.mjs';
import { ROOT } from './lib.mjs';

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

/** manifest.json from backup.mjs, or one inferred from files downloaded from the backup bucket. */
export function loadManifest(from) {
  if (existsSync(join(from, 'manifest.json'))) return readJson(join(from, 'manifest.json'));
  const files = readdirSync(from);
  const dump = files.find((f) => f.endsWith('.dump'));
  if (!dump) throw new Error(`no manifest.json or *.dump in ${from}`);
  const snap = files.find((f) => f.endsWith('.snapshot'));
  return { postgres: { file: dump }, qdrant: snap ? { file: snap } : null };
}

export async function restore({ from, database, collection, replace = false }) {
  if (!IDENT.test(database)) throw new Error('database must be a lowercase identifier');
  if (collection && !IDENT.test(collection)) throw new Error('collection must be a lowercase identifier');
  const manifest = loadManifest(from);
  for (const part of [manifest.postgres, manifest.qdrant].filter((p) => p?.sha256)) {
    if ((await sha256(join(from, part.file))) !== part.sha256) throw new Error(`${part.file} does not match its manifest digest`);
  }

  if (await databaseExists(database)) {
    if (!replace) throw new Error(`database ${database} exists; pass --replace to overwrite it`);
    await psql('postgres', `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${database}' AND pid <> pg_backend_pid()`);
    await psql('postgres', `DROP DATABASE "${database}"`);
  }
  await psql('postgres', `CREATE DATABASE "${database}" OWNER ${PG_USER}`);
  await pgExec(['pg_restore', '-U', PG_USER, '-d', database, '--no-owner', '--exit-on-error'], { input: join(from, manifest.postgres.file) });

  let points = null;
  if (manifest.qdrant && collection) {
    if ((await collectionPoints(collection)) !== null) {
      if (!replace) throw new Error(`collection ${collection} exists; pass --replace to overwrite it`);
      await qdrant('DELETE', `/collections/${collection}`);
    }
    const form = new FormData();
    form.append('snapshot', new Blob([readFileSync(join(from, manifest.qdrant.file))]), 'qdrant.snapshot');
    await qdrant('POST', `/collections/${collection}/snapshots/upload?wait=true&priority=snapshot`, form);
    points = await collectionPoints(collection);
  }
  return { manifest, points };
}

if (process.argv[1]?.endsWith('restore.mjs')) {
  const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined);
  const from = arg('--from');
  const database = arg('--database');
  if (!from || !database) {
    console.error('usage: restore.mjs --from <backup dir> --database <name> [--collection <name>] [--replace]');
    process.exit(2);
  }
  const r = await restore({ from: resolve(ROOT, from), database, collection: arg('--collection'), replace: process.argv.includes('--replace') }).catch((e) => {
    console.error(`restore: ${e.message}`);
    process.exit(1);
  });
  console.log(`restore: database ${database} restored${r.points !== null ? `; collection ${arg('--collection')} has ${r.points} points` : ''}`);
}
