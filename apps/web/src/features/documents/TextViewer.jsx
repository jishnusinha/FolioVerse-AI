import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client.js';
import { Callout, Skeleton } from '@/shared/ui/index.js';

/**
 * Canonical text view built from the stored page text of one version. Highlights a cited range by
 * `textPosition`, falling back to the first occurrence of the quote on that page.
 * @param {{ wid: string, sourceId: string, versionId: string, highlight?: { page?: number, start?: number, end?: number, quote?: string } | null }} props
 */
export function TextViewer({ wid, sourceId, versionId, highlight }) {
  const pages = useQuery({
    queryKey: ['pages', wid, versionId],
    queryFn: () => api(`/workspaces/${wid}/sources/${sourceId}/versions/${versionId}/pages`),
    enabled: Boolean(wid && sourceId && versionId),
  });
  const markRef = useRef(null);

  useEffect(() => {
    markRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [highlight, pages.data]);

  if (pages.isPending) {
    return (
      <div className="sheet" aria-busy="true">
        <Skeleton height={20} width="40%" />
        <Skeleton />
        <Skeleton width="85%" />
      </div>
    );
  }
  if (pages.error) return <Callout tone="bad">The text of this version could not be loaded.</Callout>;
  if (!pages.data.length) {
    return <Callout>Text appears here once parsing finishes. The original file is available from the download button.</Callout>;
  }
  return pages.data.map((p) => {
    const range = highlight?.page === p.pageNo ? rangeOf(p.text, highlight) : null;
    return (
      <article key={p.pageNo} className="sheet" id={`page-${p.pageNo}`} aria-label={`Page ${p.pageNo}`}>
        <span className="pg mono subtle">p. {p.pageNo}</span>
        <p style={{ whiteSpace: 'pre-wrap' }}>
          {range ? (
            <>
              {p.text.slice(0, range[0])}
              <mark ref={markRef} className="psg hl" aria-label="Cited passage">
                {p.text.slice(range[0], range[1])}
              </mark>
              {p.text.slice(range[1])}
            </>
          ) : (
            p.text
          )}
        </p>
      </article>
    );
  });
}

function rangeOf(text, h) {
  if (h.start != null && h.end != null && h.end > h.start && h.end <= text.length) {
    if (!h.quote || text.slice(h.start, h.end) === h.quote) return [h.start, h.end];
  }
  if (h.quote) {
    const at = text.indexOf(h.quote);
    if (at >= 0) return [at, at + h.quote.length];
  }
  return null;
}
