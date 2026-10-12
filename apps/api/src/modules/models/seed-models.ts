import type { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import YAML from 'yaml';
import { newId } from '../../common/ids';

export function findSeedFile(): string | null {
  const candidates = [
    process.env.FV_MODEL_REGISTRY_SEED,
    resolve(process.cwd(), 'config/models/registry.seed.yaml'),
    resolve(process.cwd(), '../../config/models/registry.seed.yaml'),
    join(__dirname, '../../../../../config/models/registry.seed.yaml'),
    join(__dirname, '../../../../config/models/registry.seed.yaml'),
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/**
 * Creates registry entries that do not exist yet (status UNVERIFIED). Never overwrites admin edits.
 * Entries whose model comes from an unset `env:` variable are skipped.
 */
export async function seedModels(prisma: PrismaClient, log: (msg: string) => void = () => undefined): Promise<string[]> {
  const file = findSeedFile();
  if (!file) {
    log('Model registry seed file not found');
    return [];
  }
  const doc = YAML.parse(readFileSync(file, 'utf8')) as { models: any[] };
  const created: string[] = [];
  for (const m of doc.models) {
    let model: string = m.model;
    if (model.startsWith('env:')) {
      const v = process.env[model.slice(4)];
      if (!v) continue;
      model = v;
    }
    const exists = await prisma.modelConfig.findUnique({ where: { id: m.id } });
    if (exists) continue;
    await prisma.modelConfig.create({
      data: {
        id: m.id,
        provider: m.provider,
        model,
        displayName: m.displayName,
        status: 'UNVERIFIED',
        contextWindow: m.contextWindow ?? 0,
        maxOutputTokens: m.maxOutputTokens ?? 0,
        capabilities: m.capabilities ?? [],
        isDemo: !!m.isDemo,
        isDefault: !!m.defaultWhen,
        fallbackIds: m.fallbacks ?? [],
      },
    });
    if (m.demoPrice) {
      await prisma.modelPrice.create({
        data: {
          id: newId(),
          modelConfigId: m.id,
          inputPerMTok: m.demoPrice.inputPerMTok,
          outputPerMTok: m.demoPrice.outputPerMTok,
          cachedInputPerMTok: m.demoPrice.cachedInputPerMTok ?? null,
          effectiveFrom: new Date('2020-01-01T00:00:00Z'),
          sourceUrl: m.demoPrice.sourceUrl,
          isDemo: true,
        },
      });
    }
    created.push(m.id);
    log(`Seeded model ${m.id} (${m.provider})`);
  }
  return created;
}
