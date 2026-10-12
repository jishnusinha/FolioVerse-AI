import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client.js';
import { Callout, Skeleton } from '@/shared/ui/index.js';
import { pageParagraphs, paragraphId } from './anchors.js';

/**
 * Canonical reading view built from the stored page text of one version (PDF text, DOCX, Markdown,
 * plain text). Every paragraph has a stable anchor (`#p-<page>-<n>`). Highlights a cited range by
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

  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (pages.data && /^p-\d+-\d+$/.test(id)) document.getElementById(id)?.scrollIntoView?.({ block: 'start' });
  }, [pages.data]);

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
  let marked = false;
  return pages.data.map((p) => {
    const range = highlight?.page === p.pageNo ? rangeOf(p.text, highlight) : null;
    return (
      <article key={p.pageNo} className="sheet reading" id={`page-${p.pageNo}`} aria-label={`Page ${p.pageNo}`}>
        <span className="pg mono subtle">p. {p.pageNo}</span>
        {pageParagraphs(p.text).map((para) => {
          const id = paragraphId(p.pageNo, para.index);
          const hit = range && range[0] < para.end && range[1] > para.start ? [Math.max(range[0], para.start) - para.start, Math.min(range[1], para.end) - para.start] : null;
          const first = hit && !marked;
          if (hit) marked = true;
          return (
            <p key={id} id={id} className="para" data-page={p.pageNo} data-start={para.start}>
              <span data-text="">
                {hit ? (
                  <>
                    {para.text.slice(0, hit[0])}
                    <mark ref={first ? markRef : undefined} className="psg hl" aria-label="Cited passage">
                      {para.text.slice(hit[0], hit[1])}
                    </mark>
                    {para.text.slice(hit[1])}
                  </>
                ) : (
                  para.text
                )}
              </span>
              <a className="para-link" href={`#${id}`} aria-label={`Link to paragraph ${para.index + 1} on page ${p.pageNo}`}>
                ¶
              </a>
            </p>
          );
        })}
      </article>
    );
  });
}

const squash = (s) => s.replace(/\s+/g, ' ').trim();

function rangeOf(text, h) {
  if (h.start != null && h.end != null && h.end > h.start && h.end <= text.length) {
    if (!h.quote || squash(text.slice(h.start, h.end)) === squash(h.quote)) return [h.start, h.end];
  }
  if (h.quote) {
    const at = text.indexOf(h.quote);
    if (at >= 0) return [at, at + h.quote.length];
    const words = squash(h.quote).split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const m = words[0] ? new RegExp(words.join('\\s+')).exec(text) : null;
    if (m) return [m.index, m.index + m[0].length];
  }
  return null;
}
