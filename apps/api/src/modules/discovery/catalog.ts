import type { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** One line of `datasets/synthetic/catalog/catalog.jsonl` (written by `datasets/synthetic/make_catalog.py`). */
export interface CatalogRecord {
  id: string;
  slug: string;
  kind: 'BOOK' | 'FILM';
  title: string;
  creators: string[];
  year?: number | null;
  genres: string[];
  moods: string[];
  themes: { name: string; weight: number }[];
  description: string;
  franchise?: string | null;
  length?: number | null;
  quality: number;
  popularity: number;
  coverTone: number;
  isDemo: boolean;
}

const RELATIVE = 'datasets/synthetic/catalog/catalog.jsonl';

/** `FV_REC_CATALOG`, else the repo copy found from the working directory (repo root or apps/api). */
export function catalogPath(): string | null {
  const candidates = [process.env.FV_REC_CATALOG, resolve(process.cwd(), RELATIVE), resolve(process.cwd(), '../..', RELATIVE)];
  return candidates.find((p): p is string => !!p && existsSync(p)) ?? null;
}

export function readCatalog(path: string): CatalogRecord[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as CatalogRecord);
}

const fields = (r: CatalogRecord) => ({
  slug: r.slug,
  kind: r.kind,
  title: r.title,
  creators: r.creators ?? [],
  year: r.year ?? null,
  genres: r.genres ?? [],
  moods: r.moods ?? [],
  description: r.description ?? '',
  franchise: r.franchise ?? null,
  length: r.length ?? null,
  quality: r.quality ?? 0,
  popularity: r.popularity ?? 0,
  coverTone: r.coverTone ?? 1,
  isDemo: r.isDemo !== false,
});

export interface LoadCatalogOptions {
  dryRun?: boolean;
  onConflict?: 'skip' | 'replace';
}

export interface LoadCatalogResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  dryRun: boolean;
}

/**
 * Idempotent load: inserts new items, updates changed ones and replaces their themes. Ids are stable
 * (UUIDv5 of the slug) so the AI service's model artifact and the database agree on identity.
 * Respects options.dryRun and options.onConflict ('skip' | 'replace').
 */
export async function loadCatalog(prisma: PrismaClient, records: CatalogRecord[], options: LoadCatalogOptions = {}): Promise<LoadCatalogResult> {
  const existing = new Map((await prisma.catalogItem.findMany({ include: { themes: true } })).map((i) => [i.id, i]));
  const fresh = records.filter((r) => !existing.has(r.id));
  const changed = records.filter((r) => {
    const e = existing.get(r.id);
    if (!e) return false;
    const now = fields(r);
    const themes = (r.themes ?? []).map((t) => `${t.name}:${t.weight}`).sort().join('|');
    const had = e.themes.map((t) => `${t.theme}:${t.weight}`).sort().join('|');
    return themes !== had || Object.entries(now).some(([k, v]) => JSON.stringify((e as any)[k]) !== JSON.stringify(v));
  });
  const onConflict = options.onConflict ?? 'replace';
  const toUpdate = onConflict === 'skip' ? [] : changed;

  if (options.dryRun) {
    return {
      total: records.length,
      created: fresh.length,
      updated: toUpdate.length,
      skipped: records.length - fresh.length - toUpdate.length,
      dryRun: true,
    };
  }

  if (fresh.length) {
    await prisma.catalogItem.createMany({ data: fresh.map((r) => ({ id: r.id, ...fields(r) })), skipDuplicates: true });
  }
  for (const r of toUpdate) {
    await prisma.$transaction([
      prisma.catalogItem.update({ where: { id: r.id }, data: fields(r) }),
      prisma.itemTheme.deleteMany({ where: { itemId: r.id } }),
    ]);
  }
  const themed = [...fresh, ...toUpdate];
  if (themed.length) {
    await prisma.itemTheme.createMany({
      data: themed.flatMap((r) => (r.themes ?? []).map((t) => ({ itemId: r.id, theme: t.name, weight: t.weight }))),
      skipDuplicates: true,
    });
  }
  return {
    total: records.length,
    created: fresh.length,
    updated: toUpdate.length,
    skipped: records.length - fresh.length - toUpdate.length,
    dryRun: false,
  };
}
