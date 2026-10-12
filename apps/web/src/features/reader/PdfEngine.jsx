import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'react-pdf/dist/Page/TextLayer.css';
import { Callout, Skeleton } from '@/shared/ui/index.js';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

/**
 * PDF engine: pages stacked in a scroll view with a selectable text layer. Positions are page Locators.
 * Highlights are listed in the side panel; they are not painted on the page image.
 */
const PdfEngine = forwardRef(function PdfEngine({ data, initial, prefs, onReady, onRelocate, onSelect }, ref) {
  const wrap = useRef(null);
  const [pages, setPages] = useState(0);
  const file = useMemo(() => ({ data: new Uint8Array(data.slice(0)) }), [data]);
  const width = Math.round(Math.min(900, prefs.fontSize * 40));
  const current = useRef(0);
  const cb = useRef({});
  cb.current = { onReady, onRelocate, onSelect };

  const scrollTo = (page) => wrap.current?.querySelector(`[data-page="${page}"]`)?.scrollIntoView({ block: 'start' });
  useImperativeHandle(ref, () => ({
    goTo: (target) => scrollTo(typeof target === 'object' ? target?.locations?.page : Number(target)),
    next: () => scrollTo(Math.min(pages, current.current + 1)),
    prev: () => scrollTo(Math.max(1, current.current - 1)),
  }));

  useEffect(() => {
    if (!pages || !wrap.current || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        const page = Number(top?.target.getAttribute('data-page'));
        if (!page || page === current.current) return;
        current.current = page;
        cb.current.onRelocate?.({ type: 'application/pdf', title: `Page ${page}`, locations: { page, position: page, totalProgression: page / pages } });
      },
      { root: wrap.current.closest('.reader'), threshold: 0.4 },
    );
    wrap.current.querySelectorAll('[data-page]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pages]);

  function onMouseUp() {
    const sel = window.getSelection();
    const text = sel?.toString().replace(/\s+/g, ' ').trim();
    if (!sel || !text || !wrap.current?.contains(sel.anchorNode)) return;
    const page = Number(sel.anchorNode.parentElement?.closest('[data-page]')?.getAttribute('data-page')) || current.current || 1;
    const r = sel.getRangeAt(0).getBoundingClientRect();
    cb.current.onSelect?.({
      text,
      rect: { left: r.left, top: r.top, bottom: r.bottom, width: r.width },
      locator: { type: 'application/pdf', title: `Page ${page}`, locations: { page, position: page }, text: { highlight: text } },
      clear: () => sel.removeAllRanges(),
    });
  }

  return (
    <div ref={wrap} className="pdf-doc" onMouseUp={onMouseUp} role="document" aria-label="Book pages">
      <Document
        file={file}
        onLoadSuccess={(doc) => {
          setPages(doc.numPages);
          cb.current.onReady?.({ toc: Array.from({ length: doc.numPages }, (_, i) => ({ href: String(i + 1), label: `Page ${i + 1}`, depth: 0, page: i + 1 })) });
          const start = initial?.locations?.page;
          if (start > 1) setTimeout(() => scrollTo(start), 50);
        }}
        loading={<Skeleton height={400} />}
        error={<Callout tone="bad">This PDF could not be displayed.</Callout>}
      >
        {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
          <div key={n} data-page={n} className="pdf-page" role="region" aria-label={`Page ${n}`}>
            <Page pageNumber={n} width={width} renderAnnotationLayer={false} />
          </div>
        ))}
      </Document>
    </div>
  );
});

export default PdfEngine;
