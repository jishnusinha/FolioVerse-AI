/**
 * Baseline seed: model registry only. Idempotent. Demo content (DEMO-labelled workspace, sources,
 * runs) is created separately by `pnpm demo` so a real deployment never gets fake data by default.
 */
import { PrismaClient } from '@prisma/client';
import { seedModels } from '../src/modules/models/seed-models';

async function main() {
  const prisma = new PrismaClient();
  try {
    const created = await seedModels(prisma, (m) => console.log(m));
    console.log(`seed: ${created.length} model config(s) created`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
