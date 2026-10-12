import { blockDiff, wordDiff } from './wdiff.js';

/** Inline word diff: removed words struck through, added words highlighted. */
export function WordDiff({ before, after, label }) {
  return (
    <p className="diff" aria-label={label}>
      {wordDiff(before, after).map((s, i) =>
        s.op === 'del' ? (
          <del key={i}>{s.text}</del>
        ) : s.op === 'ins' ? (
          <ins key={i}>{s.text}</ins>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </p>
  );
}

/** Block-aligned comparison of two scene documents; unchanged blocks are summarised. */
export function DocDiff({ before, after, empty = 'No differences.' }) {
  const rows = blockDiff(before, after);
  const changed = rows.filter((r) => r.status !== 'same');
  if (!changed.length) return <p className="empty">{empty}</p>;
  return (
    <ol className="w-docdiff">
      {changed.map((r) => (
        <li key={`${r.status}-${r.blockId}`}>
          <span className="subtle w-docdiff-k">{r.status === 'added' ? 'Added' : r.status === 'removed' ? 'Removed' : 'Changed'}</span>
          <WordDiff before={r.before} after={r.after} />
        </li>
      ))}
      {rows.length > changed.length && (
        <li className="subtle">
          {rows.length - changed.length} unchanged paragraph{rows.length - changed.length === 1 ? '' : 's'}
        </li>
      )}
    </ol>
  );
}
