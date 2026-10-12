/**
 * Re-anchoring a textQuote/textPosition selector into a changed text. Mirrors
 * apps/ai-service/folioverse_ai/anchors.py; both run packages/contracts/fixtures/anchor-cases.json.
 */

export const FUZZY_THRESHOLD = 0.8;

export type AnchorState = 'EXACT' | 'SHIFTED' | 'FUZZY' | 'ORPHANED';
export interface Reanchored {
  state: AnchorState;
  start?: number;
  end?: number;
  score?: number;
}
export interface TextAnchor {
  textQuote: { exact: string };
  textPosition?: { start: number; end: number };
}

/** Character bigram Dice coefficient in [0, 1]. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const counts = new Map<string, number>();
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  let overlap = 0;
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2);
    const c = counts.get(g) ?? 0;
    if (c > 0) {
      overlap += 1;
      counts.set(g, c - 1);
    }
  }
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

/**
 * EXACT when the quote sits at the same offsets, SHIFTED when it is found elsewhere (nearest to the
 * old start wins), FUZZY when a window of about the same length is at least 80% similar, else ORPHANED.
 */
export function reanchor(newText: string, anchor: TextAnchor): Reanchored {
  const quote = anchor.textQuote.exact;
  const start = anchor.textPosition?.start ?? 0;
  const end = anchor.textPosition?.end ?? start + quote.length;
  if (newText.slice(start, end) === quote) return { state: 'EXACT', start, end };
  const hits: number[] = [];
  for (let i = newText.indexOf(quote); i >= 0; i = newText.indexOf(quote, i + 1)) hits.push(i);
  if (hits.length) {
    const best = hits.reduce((a, h) => (Math.abs(h - start) < Math.abs(a - start) ? h : a));
    return { state: 'SHIFTED', start: best, end: best + quote.length };
  }
  const n = quote.length;
  let bestScore = 0;
  let bestAt = -1;
  let bestW = 0;
  if (n && newText.length >= Math.max(1, n - 4)) {
    for (const width of [n - 1, n, n + 1, n + 2]) {
      if (width <= 0 || width > newText.length) continue;
      for (let j = 0; j + width <= newText.length; j++) {
        const sc = similarity(quote, newText.slice(j, j + width));
        if (sc > bestScore) {
          bestScore = sc;
          bestAt = j;
          bestW = width;
        }
      }
    }
  }
  if (bestScore >= FUZZY_THRESHOLD && bestAt >= 0) {
    return { state: 'FUZZY', start: bestAt, end: bestAt + bestW, score: Math.round(bestScore * 10_000) / 10_000 };
  }
  return { state: 'ORPHANED' };
}
