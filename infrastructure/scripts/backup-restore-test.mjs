#!/usr/bin/env node
/**
 * Restore drill against the local stack: back up, restore side by side into a scratch database
 * and collection, compare every table's row count and the vector point count, then clean up.
 * Exit code 1 on any mismatch. Run while no writes are in flight (e.g. before `pnpm dev`).
 *
 *   node infrastructure/scripts/backup-restore-test.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup } from './backup.mjs';
import { collectionPoints, psql, qdrant, tableCounts } from './backup-lib.mjs';
import { restore } from './restore.mjs';

const SCRATCH_DB = 'folioverse_restore_check';
const SCRATCH_COLLECTION = 'fv_restore_check';

const dir = mkdtempSync(join(tmpdir(), 'fv-backup-'));
let failed = false;
try {
  const started = Date.now();
  const before = await tableCounts('folioverse');
  const m = await backup(dir);
  console.log(`backup:  postgres ${(m.postgres.bytes / 1024).toFixed(0)} KiB${m.qdrant ? `, qdrant ${m.qdrant.points} points (${(m.qdrant.bytes / 1024).toFixed(0)} KiB)` : ''}`);

  const r = await restore({ from: dir, database: SCRATCH_DB, collection: m.qdrant ? SCRATCH_COLLECTION : undefined, replace: true });
  const after = await tableCounts(SCRATCH_DB);

  const tables = Object.keys(before);
  const mismatched = tables.filter((t) => before[t] !== after[t]);
  const rows = tables.reduce((n, t) => n + before[t], 0);
  console.log(`restore: ${tables.length} tables, ${rows} rows; mismatched tables: ${mismatched.length ? mismatched.join(', ') : 'none'}`);
  if (mismatched.length || tables.length === 0) failed = true;

  if (m.qdrant) {
    const same = r.points === m.qdrant.points;
    console.log(`vectors: ${m.qdrant.points} -> ${r.points} points ${same ? '(match)' : '(MISMATCH)'}`);
    if (!same) failed = true;
  }
  console.log(`drill took ${((Date.now() - started) / 1000).toFixed(1)}s`);
} catch (e) {
  failed = true;
  console.error(`backup-restore-test: ${e.message}`);
} finally {
  await psql('postgres', `DROP DATABASE IF EXISTS "${SCRATCH_DB}" WITH (FORCE)`).catch(() => undefined);
  if ((await collectionPoints(SCRATCH_COLLECTION).catch(() => null)) !== null) await qdrant('DELETE', `/collections/${SCRATCH_COLLECTION}`).catch(() => undefined);
  rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? 'RESTORE DRILL FAILED' : 'RESTORE DRILL OK');
process.exit(failed ? 1 : 0);
