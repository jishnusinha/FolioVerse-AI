import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import ePub from 'epubjs';
import { Callout } from '@/shared/ui/index.js';

const FONT = { serif: '--fv-font-serif', sans: '--fv-font-sans' };
const css = (el, name) => getComputedStyle(el).getPropertyValue(name).trim();

/** Words around a range, for the Locator `text` context. */
function context(range) {
  const block = range.startContainer.parentElement?.closest('p,li,blockquote,h1,h2,h3,h4') ?? range.startContainer.parentElement;
  const all = block?.textContent ?? '';
  const hl = range.toString();
  const i = all.indexOf(hl);
  return i < 0 ? { highlight: hl } : { before: all.slice(Math.max(0, i - 80), i), highlight: hl, after: all.slice(i + hl.length, i + hl.length + 80) };
}

/**
 * EPUB engine on epub.js: one chapter at a time, scrolled, inside a sandboxed iframe (scripts disabled).
 * Reports positions as unified Locators (href + CFI + progression).
 */
const EpubEngine = forwardRef(function EpubEngine({ data, initial, prefs, highlights, onReady, onRelocate, onSelect, onHighlightClick }, ref) {
  const host = useRef(null);
  const state = useRef({ book: null, rendition: null, toc: [], applied: new Map() });
  const cb = useRef({});
  cb.current = { onReady, onRelocate, onSelect, onHighlightClick };
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);

  /** epub.js drops its own `relocated` report when it runs before the new view is laid out; report again once shown. */
  const move = async (fn) => {
    const { rendition } = state.current;
    if (!rendition) return;
    await fn(rendition);
    rendition.reportLocation();
  };
  useImperativeHandle(ref, () => ({
    goTo: (target) => move((r) => r.display(typeof target === 'string' ? target : (target?.locations?.cfi ?? target?.href))),
    next: () => move((r) => r.next()),
    prev: () => move((r) => r.prev()),
  }));

  useEffect(() => {
    let cancelled = false;
    const book = ePub(data);
    const rendition = book.renderTo(host.current, { width: '100%', height: '100%', flow: 'scrolled-doc', allowScriptedContent: false, spread: 'none' });
    state.current = { book, rendition, toc: [], applied: new Map() };
    const titleOf = (href) => {
      const base = (href ?? '').split('#')[0];
      return state.current.toc.find((t) => t.href.split('#')[0] === base)?.label ?? '';
    };

    rendition.on('relocated', (loc) => {
      const start = loc.start;
      const spineLen = book.spine.length || 1;
      const total = book.locations.length() ? book.locations.percentageFromCfi(start.cfi) : (start.index + (start.displayed?.page ?? 1) / (start.displayed?.total || 1)) / spineLen;
      const progression = start.displayed?.total ? (start.displayed.page - 1) / start.displayed.total : 0;
      cb.current.onRelocate?.({
        href: start.href,
        type: 'application/xhtml+xml',
        title: titleOf(start.href),
        locations: { cfi: start.cfi, progression, totalProgression: Math.min(1, Math.max(0, total)) },
      });
    });
    rendition.on('selected', (cfiRange, contents) => {
      const range = rendition.getRange(cfiRange);
      const text = range?.toString().replace(/\s+/g, ' ').trim();
      if (!range || !text) return;
      const frame = contents.document.defaultView.frameElement.getBoundingClientRect();
      const r = range.getBoundingClientRect();
      const href = book.spine.get(cfiRange)?.href;
      cb.current.onSelect?.({
        text,
        rect: { left: frame.left + r.left, top: frame.top + r.top, bottom: frame.top + r.bottom, width: r.width },
        locator: { href, type: 'application/xhtml+xml', title: titleOf(href), locations: { cfi: cfiRange }, text: context(range) },
        clear: () => contents.window.getSelection()?.removeAllRanges(),
      });
    });
    rendition.on('click', () => cb.current.onSelect?.(null));
    rendition.on('keyup', (e) => {
      if (e.key === 'ArrowRight') rendition.next();
      if (e.key === 'ArrowLeft') rendition.prev();
    });

    (async () => {
      try {
        const nav = await book.loaded.navigation;
        const flat = [];
        const walk = (items, depth) => items.forEach((t) => (flat.push({ href: t.href, label: t.label.trim(), depth }), walk(t.subitems ?? [], depth + 1)));
        walk(nav.toc ?? [], 0);
        state.current.toc = flat;
        await rendition.display(initial?.locations?.cfi ?? initial?.href ?? undefined);
        if (cancelled) return;
        setReady(true);
        cb.current.onReady?.({ toc: flat });
        rendition.reportLocation();
        await book.locations.generate(1200);
        if (!cancelled && rendition.location) rendition.reportLocation();
      } catch (e) {
        if (!cancelled) setError(e);
      }
    })();
    return () => {
      cancelled = true;
      book.destroy();
    };
    // The book is opened once per file; later prop changes are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    const { rendition } = state.current;
    if (!rendition || !host.current) return;
    const root = host.current.closest('.reader') ?? document.documentElement;
    rendition.themes.default({
      body: {
        color: `${getComputedStyle(root).color} !important`,
        background: 'transparent !important',
        'font-family': `${css(document.documentElement, FONT[prefs.font] ?? FONT.serif)} !important`,
        'font-size': `${prefs.fontSize}px !important`,
        'line-height': '1.8 !important',
        'max-width': `${prefs.width} !important`,
        margin: '0 auto !important',
        padding: '8px 0 64px !important',
      },
      p: { margin: '0 0 1.1em !important' },
      '::selection': { background: css(document.documentElement, '--fv-hl-sky') },
    });
  }, [prefs, ready]);

  useEffect(() => {
    const { rendition, applied } = state.current;
    if (!rendition || !ready) return;
    const want = new Map(highlights.filter((h) => h.locator?.locations?.cfi).map((h) => [h.id, h]));
    for (const [id, h] of applied) {
      if (!want.has(id) || want.get(id).color !== h.color) {
        rendition.annotations.remove(h.locator.locations.cfi, 'highlight');
        applied.delete(id);
      }
    }
    for (const [id, h] of want) {
      if (applied.has(id)) continue;
      const fill = css(document.documentElement, `--fv-hl-${h.color}`) || css(document.documentElement, '--fv-hl-amber');
      rendition.annotations.highlight(h.locator.locations.cfi, { id }, () => cb.current.onHighlightClick?.(id), 'fv-hl', { fill, 'fill-opacity': '1', 'mix-blend-mode': 'multiply' });
      applied.set(id, h);
    }
  }, [highlights, ready]);

  if (error) return <Callout tone="bad">This EPUB could not be opened: {error.message}</Callout>;
  return <div ref={host} className="epub-host" aria-label="Book text" role="document" aria-busy={!ready} />;
});

export default EpubEngine;
