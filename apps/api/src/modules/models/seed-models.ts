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

export interface SeedEntry {
  id: string;
  provider: string;
  /** Resolved model id, or null when it comes from an unset `env:` variable. */
  model: string | null;
  envVar: string | null;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: string[];
  fallbacks: string[];
  isDemo: boolean;
}

export function readSeed(): SeedEntry[] {
  const file = findSeedFile();
  if (!file) return [];
  const doc = YAML.parse(readFileSync(file, 'utf8')) as { models: any[] };
  return doc.models.map((m) => {
    const envVar = typeof m.model === 'string' && m.model.startsWith('env:') ? m.model.slice(4) : null;
    return {
      id: m.id,
      provider: m.provider,
      model: envVar ? (process.env[envVar] ?? null) : m.model,
      envVar,
      displayName: m.displayName,
      contextWindow: m.contextWindow ?? 0,
      maxOutputTokens: m.maxOutputTokens ?? 0,
      capabilities: m.capabilities ?? [],
      fallbacks: m.fallbacks ?? [],
      isDemo: !!m.isDemo,
    };
  });
}

type DbConfig = { id: string; provider: string; model: string; displayName: string; contextWindow: number; maxOutputTokens: number; capabilities: string[]; fallbackIds: string[]; isDemo: boolean };

/** Seed file vs database registry: entries only in the seed, only in the database, and fields that differ. */
export function registryDiff(seed: SeedEntry[], db: DbConfig[]) {
  const byId = new Map(db.map((c) => [c.id, c]));
  const seedIds = new Set(seed.map((s) => s.id));
  const norm = (xs: string[]) => [...xs].sort().join(', ');
  const changed = seed
    .filter((s) => byId.has(s.id))
    .map((s) => {
      const c = byId.get(s.id)!;
      const pairs: [string, unknown, unknown][] = [
        ['provider', s.provider, c.provider],
        ['model', s.model, c.model],
        ['displayName', s.displayName, c.displayName],
        ['contextWindow', s.contextWindow, c.contextWindow],
        ['maxOutputTokens', s.maxOutputTokens, c.maxOutputTokens],
        ['capabilities', norm(s.capabilities), norm(c.capabilities)],
        ['fallbacks', norm(s.fallbacks), norm(c.fallbackIds)],
        ['isDemo', s.isDemo, c.isDemo],
      ];
      const fields = pairs.filter(([f, a, b]) => !(f === 'model' && a === null) && a !== b).map(([field, seedValue, dbValue]) => ({ field, seed: seedValue, db: dbValue }));
      return { id: s.id, fields };
    })
    .filter((x) => x.fields.length);
  return {
    added: seed.filter((s) => !byId.has(s.id)).map((s) => ({ id: s.id, provider: s.provider, displayName: s.displayName, blockedBy: s.model === null ? s.envVar : null })),
    removed: db.filter((c) => !seedIds.has(c.id)).map((c) => ({ id: c.id, provider: c.provider, displayName: c.displayName })),
    changed,
  };
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
