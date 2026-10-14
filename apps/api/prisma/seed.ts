/**
 * Baseline seed: model registry, plus the synthetic DEMO discovery catalog when FV_DEMO_CATALOG=true.
 * Idempotent. Other demo content (DEMO-labelled workspace, sources, runs) is created separately by
 * `pnpm demo` so a real deployment never gets fake data by default.
 */
import { PrismaClient } from '@prisma/client';
import { catalogPath, loadCatalog, readCatalog } from '../src/modules/discovery/catalog';
import { seedModels } from '../src/modules/models/seed-models';

async function main() {
  const prisma = new PrismaClient();
  try {
    const created = await seedModels(prisma, (m) => console.log(m));
    console.log(`seed: ${created.length} model config(s) created`);
    if (process.env.FV_DEMO_CATALOG === 'true' || process.argv.includes('--catalog')) {
      const path = catalogPath();
      if (!path) throw new Error('FV_DEMO_CATALOG=true but the catalog file was not found (set FV_REC_CATALOG)');
      const dryRun = process.argv.includes('--dry-run') || process.env.FV_SEED_DRY_RUN === 'true';
      const onConflictArg = process.argv.find((a) => a.startsWith('--on-conflict='));
      const onConflict = (onConflictArg ? onConflictArg.split('=')[1] : 'replace') as 'skip' | 'replace';
      const r = await loadCatalog(prisma, readCatalog(path), { dryRun, onConflict });
      console.log(`seed: DEMO catalog ${r.total} items (${r.created} new, ${r.updated} updated, ${r.skipped} skipped${r.dryRun ? ' [DRY-RUN]' : ''})`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
