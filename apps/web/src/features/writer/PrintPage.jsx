import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { useCurrentWorkspace } from '@/features/auth/session.js';
import { Button, Callout, Skeleton } from '@/shared/ui/index.js';
import { useCompiled } from './queries.js';

/** Citation blocks become footnote references on the paragraph before them. */
function withRefs(blocks) {
  const out = [];
  for (const b of blocks) {
    const last = out.at(-1);
    if (b.type === 'citation' && last && last.type === 'paragraph') last.refs.push(b.footnote);
    else out.push(b.type === 'citation' ? { type: 'paragraph', text: '', refs: [b.footnote] } : { ...b, refs: [] });
  }
  return out;
}

/** Compiled manuscript for printing; the browser's “Save as PDF” produces the PDF export. */
export function PrintPage() {
  const { manuscriptId: mid } = useParams();
  const ws = useCurrentWorkspace();
  const c = useCompiled(ws?.id, mid);

  useEffect(() => {
    if (c.data) document.title = `${c.data.title} · FolioVerse`;
  }, [c.data]);

  if (c.isPending) {
    return (
      <div className="page" aria-busy="true">
        <Skeleton height={300} />
      </div>
    );
  }
  if (c.error) {
    return (
      <div className="page">
        <h1>Manuscript not found</h1>
        <Callout tone="bad" role="alert">
          The manuscript could not be compiled: {c.error.message}
        </Callout>
        <Link className="btn" style={{ marginTop: 14 }} to="/app/writer">
          Back to Folio Writer
        </Link>
      </div>
    );
  }

  const { title, sections, footnotes } = c.data;
  return (
    <div className="page w-print-page">
      <div className="row no-print" style={{ marginBottom: 18 }}>
        <Link className="btn" to={`/app/writer/manuscripts/${mid}`}>
          Back to manuscript
        </Link>
        <span className="grow" />
        <span className="subtle" style={{ fontSize: 12 }}>
          Use your browser’s print dialog and choose “Save as PDF”.
        </span>
        <Button variant="primary" onClick={() => window.print()}>
          Print or save as PDF
        </Button>
      </div>
      <article className="w-print manuscript">
        <h1>{title}</h1>
        {sections.map((s, i) => {
          if (s.kind === 'PART') return <h2 key={i}>{s.title}</h2>;
          if (s.kind === 'CHAPTER') return <h3 key={i}>{s.title}</h3>;
          const prevScene = sections[i - 1]?.kind === 'SCENE';
          return (
            <section key={i} aria-label={s.title}>
              {prevScene && (
                <p className="scene-mark" aria-hidden="true">
                  * * *
                </p>
              )}
              {withRefs(s.blocks).map((b, j) =>
                b.type === 'heading' ? (
                  <h4 key={j}>{b.text}</h4>
                ) : (
                  <p key={j}>
                    {b.text}
                    {b.refs.map((n) => (
                      <sup key={n} className="w-fn">
                        <a href={`#fn-${n}`} id={`fnref-${n}`} aria-label={`Footnote ${n}`}>
                          {n}
                        </a>
                      </sup>
                    ))}
                  </p>
                ),
              )}
            </section>
          );
        })}
        {footnotes.length > 0 && (
          <section className="w-footnotes" aria-label="Footnotes">
            <hr />
            <ol>
              {footnotes.map((f, i) => (
                <li key={i} id={`fn-${i + 1}`}>
                  {f}{' '}
                  <a href={`#fnref-${i + 1}`} aria-label={`Back to reference ${i + 1}`}>
                    ↩
                  </a>
                </li>
              ))}
            </ol>
          </section>
        )}
      </article>
    </div>
  );
}
