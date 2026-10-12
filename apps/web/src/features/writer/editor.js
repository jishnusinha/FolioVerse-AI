import { Extension, Node, mergeAttributes } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { newBlockId } from './doc.js';

/** Text blocks that carry a stable `blockId` (suggestions, issues and evidence anchor to it). Containers such as quotes and lists do not. */
export const BLOCK_TYPES = ['paragraph', 'heading', 'citation'];

/**
 * `blockId` and `aiAssisted` attributes on block nodes, plus a plugin that gives new or duplicated
 * blocks (paste, split) a fresh id so ids stay unique within the scene.
 */
export const BlockAttrs = Extension.create({
  name: 'blockAttrs',
  addGlobalAttributes() {
    return [
      {
        types: BLOCK_TYPES,
        attributes: {
          blockId: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el) => el.getAttribute('data-block-id'),
            renderHTML: (a) => (a.blockId ? { 'data-block-id': a.blockId } : {}),
          },
          aiAssisted: {
            default: false,
            keepOnSplit: false,
            parseHTML: (el) => el.getAttribute('data-ai') === 'true',
            renderHTML: (a) => (a.aiAssisted ? { 'data-ai': 'true', title: 'AI-assisted text you accepted' } : {}),
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    const types = new Set(BLOCK_TYPES);
    return [
      new Plugin({
        key: new PluginKey('fvBlockIds'),
        appendTransaction: (trs, _old, state) => {
          if (!trs.some((t) => t.docChanged)) return null;
          const seen = new Set();
          let tr = null;
          state.doc.descendants((node, pos) => {
            if (!types.has(node.type.name)) return true;
            const id = node.attrs.blockId;
            if (!id || seen.has(id)) {
              tr ??= state.tr;
              const fresh = newBlockId();
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: fresh, aiAssisted: id ? false : node.attrs.aiAssisted });
              seen.add(fresh);
            } else seen.add(id);
            return false;
          });
          return tr?.setMeta('addToHistory', false) ?? null;
        },
      }),
    ];
  },
});

export const marksKey = new PluginKey('fvMarks');

/**
 * Review decorations: paragraphs with a pending suggestion, paragraphs with an open continuity issue and
 * a one-shot flash after a jump. State is pushed in with `setReviewMarks`; it never changes the document.
 */
export const ReviewMarks = Extension.create({
  name: 'reviewMarks',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: marksKey,
        state: {
          init: () => ({ pending: new Set(), flagged: new Set(), flash: null }),
          apply: (tr, prev) => tr.getMeta(marksKey) ?? prev,
        },
        props: {
          decorations(state) {
            const { pending, flagged, flash } = marksKey.getState(state);
            if (!pending.size && !flagged.size && !flash) return null;
            const decos = [];
            state.doc.descendants((node, pos) => {
              const id = node.attrs?.blockId;
              if (!id) return true;
              const cls = [pending.has(id) && 'w-pending', flagged.has(id) && 'w-flagged', flash === id && 'w-flash'].filter(Boolean).join(' ');
              if (cls) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: cls }));
              return false;
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});

/** @param {import('@tiptap/react').Editor} editor */
export function setReviewMarks(editor, { pending = [], flagged = [], flash = null }) {
  if (!editor || editor.isDestroyed) return;
  editor.view.dispatch(editor.state.tr.setMeta(marksKey, { pending: new Set(pending), flagged: new Set(flagged), flash }).setMeta('addToHistory', false));
}

/** Footnote block citing a research note; exported as a numbered footnote (Markdown `[^n]`, DOCX footnote). */
export const Citation = Node.create({
  name: 'citation',
  group: 'block',
  content: 'text*',
  marks: '',
  defining: true,
  addAttributes() {
    return {
      noteId: { default: null, parseHTML: (el) => el.getAttribute('data-note-id'), renderHTML: (a) => (a.noteId ? { 'data-note-id': a.noteId } : {}) },
      sourceId: { default: null, parseHTML: (el) => el.getAttribute('data-source-id'), renderHTML: (a) => (a.sourceId ? { 'data-source-id': a.sourceId } : {}) },
      sourceVersionId: { default: null, rendered: false },
    };
  },
  parseHTML() {
    return [{ tag: 'aside[data-type="citation"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['aside', mergeAttributes({ 'data-type': 'citation', class: 'w-cite', 'aria-label': 'Footnote' }, HTMLAttributes), 0];
  },
});

/** Block (with `blockId`) that contains the selection head. */
export function blockAtSelection(editor) {
  if (!editor) return null;
  const { $head } = editor.state.selection;
  for (let d = $head.depth; d > 0; d--) {
    const node = $head.node(d);
    if (node.attrs?.blockId) return { blockId: node.attrs.blockId, text: node.textContent, pos: $head.before(d) };
  }
  return null;
}

/** Document position of a block, or -1. */
export function findBlock(editor, blockId) {
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (at >= 0) return false;
    if (node.attrs?.blockId === blockId) {
      at = pos;
      return false;
    }
    return true;
  });
  return at;
}
