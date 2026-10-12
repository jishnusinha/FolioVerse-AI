import { BadRequestException } from '@nestjs/common';
import { newId } from '../../common/ids';

/** ProseMirror/TipTap JSON node. */
export interface PMNode {
  type: string;
  attrs?: Record<string, any>;
  content?: PMNode[];
  text?: string;
  marks?: unknown[];
}

export interface Block {
  blockId: string;
  type: string;
  text: string;
  aiAssisted: boolean;
}

export const MAX_DOC_BYTES = 2_000_000;
const MAX_DEPTH = 24;
/** Block types whose text is not prose (excluded from word counts and AI input). */
const NON_PROSE = new Set(['citation']);

export function emptyDoc(): PMNode {
  return { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: newId() } }] };
}

/** Paragraphs separated by blank lines; used by seeds and imports. */
export function docFromText(text: string): PMNode {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (!paras.length) return emptyDoc();
  return { type: 'doc', content: paras.map((p) => ({ type: 'paragraph', attrs: { blockId: newId() }, content: [{ type: 'text', text: p }] })) };
}

/** Rejects anything that is not a bounded TipTap document. Content is rendered only through the editor schema. */
export function validateDoc(content: unknown): PMNode {
  const bad = (m: string) => new BadRequestException({ message: m, code: 'INVALID_DOCUMENT' });
  if (!content || typeof content !== 'object' || (content as PMNode).type !== 'doc') throw bad('Content must be a TipTap document');
  if (JSON.stringify(content).length > MAX_DOC_BYTES) throw bad('The scene is too large to save');
  const walk = (n: PMNode, depth: number) => {
    if (depth > MAX_DEPTH) throw bad('The document is nested too deeply');
    if (!n || typeof n !== 'object' || typeof n.type !== 'string') throw bad('Malformed document node');
    if (n.text !== undefined && typeof n.text !== 'string') throw bad('Malformed text node');
    if (n.content !== undefined) {
      if (!Array.isArray(n.content)) throw bad('Malformed document node');
      for (const c of n.content) walk(c, depth + 1);
    }
  };
  walk(content as PMNode, 0);
  return content as PMNode;
}

export function inlineText(n: PMNode): string {
  if (n.type === 'text') return n.text ?? '';
  if (n.type === 'hardBreak') return '\n';
  return (n.content ?? []).map(inlineText).join('');
}

/** Text-bearing blocks in document order: every node with a `blockId` attribute (not descended into). */
export function blocksOf(doc: PMNode): Block[] {
  const out: Block[] = [];
  const walk = (n: PMNode) => {
    const id = n.attrs?.blockId;
    if (typeof id === 'string' && id) {
      out.push({ blockId: id, type: n.type, text: inlineText(n), aiAssisted: Boolean(n.attrs?.aiAssisted) });
      return;
    }
    for (const c of n.content ?? []) walk(c);
  };
  walk(doc);
  return out;
}

export const proseBlocks = (doc: PMNode) => blocksOf(doc).filter((b) => !NON_PROSE.has(b.type));

/** Plain text of the prose blocks, blank-line separated. */
export const docText = (doc: PMNode) =>
  proseBlocks(doc)
    .map((b) => b.text)
    .join('\n\n');

const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
export const countWords = (text: string) => text.match(WORD)?.length ?? 0;

/**
 * Replaces the inline content of one block with plain text (marks inside that block are dropped) and
 * merges `attrs`. Returns null when the block does not exist.
 */
export function replaceBlockText(doc: PMNode, blockId: string, text: string, attrs: Record<string, unknown> = {}): PMNode | null {
  let found = false;
  const walk = (n: PMNode): PMNode => {
    if (n.attrs?.blockId === blockId) {
      found = true;
      const parts = text.split('\n');
      const content: PMNode[] = [];
      parts.forEach((p, i) => {
        if (i > 0) content.push({ type: 'hardBreak' });
        if (p) content.push({ type: 'text', text: p });
      });
      return { ...n, attrs: { ...n.attrs, ...attrs }, ...(content.length ? { content } : { content: undefined }) };
    }
    return n.content ? { ...n, content: n.content.map(walk) } : n;
  };
  const next = walk(doc);
  return found ? JSON.parse(JSON.stringify(next)) : null;
}

/** Finds the prose block containing `quote` (exact, then whitespace-insensitive). */
export function blockContaining(doc: PMNode, quote: string): Block | null {
  const blocks = proseBlocks(doc);
  const exact = blocks.find((b) => b.text.includes(quote));
  if (exact) return exact;
  const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const q = squash(quote);
  return q ? (blocks.find((b) => squash(b.text).includes(q)) ?? null) : null;
}
