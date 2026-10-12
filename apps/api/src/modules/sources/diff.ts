export interface Paragraph {
  page: number;
  index: number;
  text: string;
}

export interface DiffSummary {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  samples: {
    added: Paragraph[];
    removed: Paragraph[];
    changed: { before: Paragraph; after: Paragraph; similarity: number }[];
  };
}

const SAMPLE = 5;
const CHANGED_AT = 0.5;

/** Splits page text into paragraphs on blank lines; the same split the reading view uses for anchors. */
export function paragraphs(pages: { pageNo: number; text: string }[]): Paragraph[] {
  const out: Paragraph[] = [];
  for (const p of pages) {
    p.text
      .split(/\n\s*\n/)
      .map((t) => t.trim())
      .filter(Boolean)
      .forEach((text, index) => out.push({ page: p.pageNo, index, text }));
  }
  return out;
}

const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();
const words = (t: string) => new Set(norm(t).match(/[\p{L}\p{N}%.]+/gu) ?? []);

function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/**
 * Paragraph-level summary of what changed between two versions. Identical paragraphs (after
 * whitespace normalisation) are unchanged; remaining pairs with enough word overlap count as
 * changed; the rest are added or removed.
 */
export function diffParagraphs(before: Paragraph[], after: Paragraph[]): DiffSummary {
  const remaining = new Map<string, number>();
  for (const p of before) remaining.set(norm(p.text), (remaining.get(norm(p.text)) ?? 0) + 1);
  const afterOnly: Paragraph[] = [];
  let unchanged = 0;
  for (const p of after) {
    const k = norm(p.text);
    const n = remaining.get(k) ?? 0;
    if (n > 0) {
      remaining.set(k, n - 1);
      unchanged += 1;
    } else afterOnly.push(p);
  }
  const beforeOnly = before.filter((p) => {
    const k = norm(p.text);
    const n = remaining.get(k) ?? 0;
    if (n > 0) {
      remaining.set(k, n - 1);
      return true;
    }
    return false;
  });

  const changed: DiffSummary['samples']['changed'] = [];
  const used = new Set<number>();
  const afterWords = afterOnly.map((p) => words(p.text));
  const removed: Paragraph[] = [];
  for (const b of beforeOnly) {
    const bw = words(b.text);
    let best = -1;
    let bestScore = 0;
    afterWords.forEach((aw, i) => {
      if (used.has(i)) return;
      const s = jaccard(bw, aw);
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    });
    if (best >= 0 && bestScore >= CHANGED_AT) {
      used.add(best);
      changed.push({ before: b, after: afterOnly[best], similarity: Math.round(bestScore * 100) / 100 });
    } else removed.push(b);
  }
  const added = afterOnly.filter((_, i) => !used.has(i));
  return {
    added: added.length,
    removed: removed.length,
    changed: changed.length,
    unchanged,
    samples: { added: added.slice(0, SAMPLE), removed: removed.slice(0, SAMPLE), changed: changed.slice(0, SAMPLE) },
  };
}
