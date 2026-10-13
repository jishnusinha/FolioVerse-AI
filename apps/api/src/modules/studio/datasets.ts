import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface GoldenItem {
  id: string;
  question: string;
  doc: string;
  answerable: boolean;
  page?: number;
  evidence?: string;
}

export interface GoldenDataset {
  id: string;
  label: string;
  doc: string;
  items: GoldenItem[];
}

const DATASETS: Record<string, { file: string; label: string }> = {
  'qa-small': { file: 'qa-small.jsonl', label: 'Atlas brief Q&A (12 questions, 2 unanswerable)' },
};

function evaluationDir(): string | null {
  const candidates = [
    process.env.FV_EVAL_DIR,
    resolve(process.cwd(), 'datasets/evaluation'),
    resolve(process.cwd(), '../../datasets/evaluation'),
    join(__dirname, '../../../../../datasets/evaluation'),
    join(__dirname, '../../../../datasets/evaluation'),
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(join(p, 'qa-small.jsonl'))) ?? null;
}

const cache = new Map<string, GoldenDataset>();

/** Golden question sets for RAG evaluation (synthetic documents in `datasets/synthetic/docs`). */
export function loadDataset(id: string): GoldenDataset | null {
  if (cache.has(id)) return cache.get(id)!;
  const def = DATASETS[id];
  const dir = evaluationDir();
  if (!def || !dir) return null;
  const items = readFileSync(join(dir, def.file), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as GoldenItem);
  const ds = { id, label: def.label, doc: items[0]?.doc ?? '', items };
  cache.set(id, ds);
  return ds;
}

export function listDatasets() {
  return Object.keys(DATASETS)
    .map((id) => loadDataset(id))
    .filter((d): d is GoldenDataset => !!d)
    .map((d) => ({ id: d.id, label: d.label, doc: d.doc, items: d.items.length, answerable: d.items.filter((i) => i.answerable).length }));
}
