import { useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'react-pdf/dist/Page/TextLayer.css';
import { Callout, Skeleton } from '@/shared/ui/index.js';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

const MAX_WIDTH = 760;

/**
 * PDF viewer with a selectable text layer. A citation highlight is drawn from the anchor's bbox
 * ([x0, top, x1, bottom] in PDF points, top-left origin) scaled to the rendered page width.
 * @param {{ url: string, highlight?: { page?: number, bbox?: number[] } | null, onPages?: (n: number) => void }} props
 */
export default function PdfViewer({ url, highlight, onPages }) {
  const [pages, setPages] = useState(0);
  const [sizes, setSizes] = useState(/** @type {Record<number, number>} */ ({}));
  const wrap = useRef(null);
  const [width, setWidth] = useState(MAX_WIDTH);
  const file = useMemo(() => ({ url, withCredentials: true }), [url]);

  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setWidth(Math.min(MAX_WIDTH, Math.max(320, Math.floor(e.contentRect.width) - 32))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!highlight?.page || !pages) return;
    const target = wrap.current?.querySelector(`[data-hl="true"]`) ?? wrap.current?.querySelector(`#pdf-page-${highlight.page}`);
    target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [highlight, pages, sizes]);

  return (
    <div ref={wrap} className="pdf-doc">
      <Document
        file={file}
        onLoadSuccess={(doc) => {
          setPages(doc.numPages);
          onPages?.(doc.numPages);
        }}
        loading={
          <div className="sheet" aria-busy="true">
            <Skeleton height={20} width="40%" />
            <Skeleton />
          </div>
        }
        error={<Callout tone="bad">The PDF could not be displayed. Switch to the text view or download the file.</Callout>}
      >
        {Array.from({ length: pages }, (_, i) => i + 1).map((n) => {
          const scale = sizes[n] ? width / sizes[n] : null;
          const box = highlight?.page === n && highlight.bbox?.length === 4 && scale ? highlight.bbox : null;
          return (
            <div key={n} id={`pdf-page-${n}`} className="pdf-page" aria-label={`Page ${n}`} role="region">
              <Page pageNumber={n} width={width} renderAnnotationLayer={false} onLoadSuccess={(p) => setSizes((s) => ({ ...s, [n]: p.originalWidth }))} />
              {box && (
                <div
                  className="pdf-hl"
                  data-hl="true"
                  role="img"
                  aria-label="Cited passage"
                  style={{
                    left: box[0] * scale - 3,
                    top: box[1] * scale - 3,
                    width: (box[2] - box[0]) * scale + 6,
                    height: (box[3] - box[1]) * scale + 6,
                  }}
                />
              )}
            </div>
          );
        })}
      </Document>
    </div>
  );
}
