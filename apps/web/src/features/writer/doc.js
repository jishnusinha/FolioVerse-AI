/**
 * TipTap JSON helpers. Mirrors `apps/api/src/modules/writer/doc.ts` so the client builds exactly the
 * document the API checks when a suggestion is accepted or undone.
 */

/** Block types whose text is not prose (excluded from word counts and AI input). */
const NON_PROSE = new Set(['citation']);
const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

export const newBlockId = () => crypto.randomUUID();
export const countWords = (text) => text.match(WORD)?.length ?? 0;
export const squash = (s) => (s ?? '').replace(/\s+/g, ' ').trim();

export function inlineText(n) {
  if (n.type === 'text') return n.text ?? '';
  if (n.type === 'hardBreak') return '\n';
  return (n.content ?? []).map(inlineText).join('');
}

/** @returns {{ blockId: string, type: string, text: string, aiAssisted: boolean }[]} */
export function blocksOf(doc) {
  const out = [];
  const walk = (n) => {
    const id = n.attrs?.blockId;
    if (typeof id === 'string' && id) {
      out.push({ blockId: id, type: n.type, text: inlineText(n), aiAssisted: Boolean(n.attrs?.aiAssisted) });
      return;
    }
    for (const c of n.content ?? []) walk(c);
  };
  if (doc) walk(doc);
  return out;
}

export const proseBlocks = (doc) => blocksOf(doc).filter((b) => !NON_PROSE.has(b.type));
export const docText = (doc) =>
  proseBlocks(doc)
    .map((b) => b.text)
    .join('\n\n');

/** Replaces one block's inline content with plain text and merges `attrs`; null when the block is missing. */
export function replaceBlockText(doc, blockId, text, attrs = {}) {
  let found = false;
  const walk = (n) => {
    if (n.attrs?.blockId === blockId) {
      found = true;
      const content = [];
      text.split('\n').forEach((p, i) => {
        if (i > 0) content.push({ type: 'hardBreak' });
        if (p) content.push({ type: 'text', text: p });
      });
      const next = { ...n, attrs: { ...n.attrs, ...attrs } };
      if (content.length) next.content = content;
      else delete next.content;
      return next;
    }
    return n.content ? { ...n, content: n.content.map(walk) } : n;
  };
  const next = walk(doc);
  return found ? structuredClone(next) : null;
}

/** Footnote text for a research note: “quote” — Source, p. N (or the chapter title for a library book excerpt). */
export function citationText(note) {
  const anchor = note.source?.anchor;
  const page = anchor?.selectors?.page ?? (anchor?.locator?.type === 'application/pdf' ? anchor.page : null);
  const where = [note.source?.title ?? note.title, page ? `p. ${page}` : (anchor?.chapterTitle ?? null)].filter(Boolean).join(', ');
  return note.quote ? `“${note.quote}” — ${where}` : where || note.title;
}

/** A citation (footnote) block for the editor, carrying the note's source anchor. */
export function citationNode(note) {
  return {
    type: 'citation',
    attrs: {
      blockId: newBlockId(),
      noteId: note.id,
      sourceId: note.source?.sourceId ?? null,
      sourceVersionId: note.source?.sourceVersionId ?? null,
    },
    content: [{ type: 'text', text: citationText(note) }],
  };
}
