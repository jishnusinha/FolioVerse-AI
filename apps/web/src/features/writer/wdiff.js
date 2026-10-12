import { blocksOf } from './doc.js';

/** Above this many token pairs the LCS table is skipped and the change is shown as a replacement. */
const MAX_CELLS = 400_000;

/**
 * Word-level diff (LCS over words and whitespace runs), ported from the design prototype's `wdiff`.
 * Returns segments instead of HTML so callers render text safely.
 * @param {string} a @param {string} b
 * @returns {{ op: 'eq'|'del'|'ins', text: string }[]}
 */
export function wordDiff(a, b) {
  const A = a.split(/(\s+)/).filter(Boolean);
  const B = b.split(/(\s+)/).filter(Boolean);
  const n = A.length;
  const m = B.length;
  const out = [];
  const push = (op, text) => {
    const last = out.at(-1);
    if (last?.op === op) last.text += text;
    else out.push({ op, text });
  };
  if (n * m > MAX_CELLS) {
    if (a) push('del', a);
    if (b) push('ins', b);
    return out;
  }
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      push('eq', A[i]);
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) push('del', A[i++]);
    else push('ins', B[j++]);
  }
  while (i < n) push('del', A[i++]);
  while (j < m) push('ins', B[j++]);
  return out;
}

/**
 * Aligns two scene documents by `blockId` and diffs changed blocks word by word.
 * @returns {{ blockId: string, status: 'same'|'changed'|'added'|'removed', before: string, after: string }[]}
 */
export function blockDiff(oldDoc, newDoc) {
  const before = blocksOf(oldDoc);
  const after = blocksOf(newDoc);
  const old = new Map(before.map((b) => [b.blockId, b]));
  const seen = new Set(after.map((b) => b.blockId));
  const rows = [];
  let k = 0;
  const flushRemoved = (uptoIndex) => {
    for (; k < uptoIndex; k++) {
      const b = before[k];
      if (!seen.has(b.blockId)) rows.push({ blockId: b.blockId, status: 'removed', before: b.text, after: '' });
    }
  };
  for (const b of after) {
    const o = old.get(b.blockId);
    if (o) flushRemoved(before.indexOf(o) + 1);
    rows.push({ blockId: b.blockId, status: !o ? 'added' : o.text === b.text ? 'same' : 'changed', before: o?.text ?? '', after: b.text });
  }
  flushRemoved(before.length);
  return rows;
}
