/**
 * Paragraphs of one page with their character range in the page text. Numbering matches the API's
 * version diff (`paragraphs()` in sources/diff.ts): blank-line separated, empty parts skipped.
 * @param {string} text
 * @returns {{ index: number, start: number, end: number, text: string }[]}
 */
export function pageParagraphs(text) {
  const out = [];
  const re = /\n\s*\n/g;
  let last = 0;
  const push = (s, e) => {
    const raw = text.slice(s, e);
    const lead = raw.length - raw.trimStart().length;
    const t = raw.trim();
    if (t) out.push({ index: out.length, start: s + lead, end: s + lead + t.length, text: t });
  };
  for (let m = re.exec(text); m; m = re.exec(text)) {
    push(last, m.index);
    last = m.index + m[0].length;
  }
  push(last, text.length);
  return out;
}

export const paragraphId = (page, index) => `p-${page}-${index}`;

/**
 * Anchor for the current selection inside the document pane: page, quoted text and, in the text
 * view, the character range in that page's text. Returns null for empty or foreign selections.
 * @param {Selection | null} sel
 * @param {HTMLElement | null} root
 */
export function selectionAnchor(sel, root) {
  if (!sel || sel.isCollapsed || !sel.rangeCount || !root) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const quote = sel.toString().replace(/\s+/g, ' ').trim();
  if (quote.length < 2) return null;
  const startEl = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  const para = startEl?.closest('[data-start]');
  const text = para?.querySelector('[data-text]');
  if (para && text?.contains(range.startContainer)) {
    // Offsets come from DOM ranges (raw page text); Selection.toString() reflects rendered whitespace.
    const offset = (node, at) => {
      const pre = document.createRange();
      pre.selectNodeContents(text);
      pre.setEnd(node, at);
      return pre.toString().length;
    };
    const from = offset(range.startContainer, range.startOffset);
    const to = text.contains(range.endContainer) ? offset(range.endContainer, range.endOffset) : (text.textContent ?? '').length;
    const base = Number(para.getAttribute('data-start'));
    const exact = (text.textContent ?? '').slice(from, to);
    return { page: Number(para.getAttribute('data-page')), start: base + from, end: base + to, quote: exact.trim() ? exact : quote, rect: range.getBoundingClientRect() };
  }
  if (para) return { page: Number(para.getAttribute('data-page')), quote, rect: range.getBoundingClientRect() };
  const page = startEl?.closest('[data-page-number]');
  return { page: page ? Number(page.getAttribute('data-page-number')) : undefined, quote, rect: range.getBoundingClientRect() };
}
