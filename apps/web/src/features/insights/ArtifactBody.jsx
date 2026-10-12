import { Suspense, lazy, useState } from 'react';
import { CiteChip } from '../runs/CitedText.jsx';
import { splitCitations } from '../runs/runState.js';
import { Button, Skeleton } from '@/shared/ui/index.js';

const KnowledgeMap = lazy(() => import('./KnowledgeMap.jsx'));

/** Inline text with **bold** spans and [S#] citation chips. */
function Inline({ text, citations, onCite }) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <b key={i}>{part.slice(2, -2)}</b>
    ) : (
      splitCitations(part).map((seg, j) =>
        seg.type === 'text' ? (
          <span key={`${i}-${j}`}>{seg.text}</span>
        ) : (
          <CiteChip key={`${i}-${j}`} marker={seg.marker} citation={citations[seg.marker]} onClick={onCite ? () => onCite(seg.marker) : undefined} />
        ),
      )
    ),
  );
}

/**
 * Minimal markdown for generated artifacts: `##` headings, `- ` bullets, `- [ ]` checklists, `**bold**`
 * and paragraphs. Anything else renders as plain text, never as HTML.
 */
export function ArtifactMarkdown({ text, citations = {}, onCite }) {
  const blocks = [];
  let list = null;
  const flush = () => {
    if (list) blocks.push(list);
    list = null;
  };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const task = /^\s*- \[( |x)\] (.*)$/.exec(line);
    const bullet = /^\s*[-*] (.*)$/.exec(line);
    if (task || bullet) {
      const kind = task ? 'tasks' : 'bullets';
      if (!list || list.kind !== kind) {
        flush();
        list = { kind, items: [] };
      }
      list.items.push(task ? { text: task[2], done: task[1] === 'x' } : { text: bullet[1] });
      continue;
    }
    flush();
    if (/^#{1,6} /.test(line)) blocks.push({ kind: 'h', text: line.replace(/^#+ /, '') });
    else if (line.trim()) {
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'p' && !last.closed) last.text += ` ${line.trim()}`;
      else blocks.push({ kind: 'p', text: line.trim() });
    } else if (blocks.length && blocks[blocks.length - 1].kind === 'p') blocks[blocks.length - 1].closed = true;
  }
  flush();
  return (
    <div className="art-md">
      {blocks.map((b, i) => {
        if (b.kind === 'h') return <h3 key={i}>{b.text}</h3>;
        if (b.kind === 'p')
          return (
            <p key={i}>
              <Inline text={b.text} citations={citations} onCite={onCite} />
            </p>
          );
        if (b.kind === 'tasks')
          return (
            <ul key={i} className="art-tasks">
              {b.items.map((it, j) => (
                <li key={j}>
                  <span aria-hidden="true">{it.done ? '☑' : '☐'}</span> <Inline text={it.text} citations={citations} onCite={onCite} />
                </li>
              ))}
            </ul>
          );
        return (
          <ul key={i}>
            {b.items.map((it, j) => (
              <li key={j}>
                <Inline text={it.text} citations={citations} onCite={onCite} />
              </li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}

function Flashcards({ items, citations, onCite }) {
  const [flipped, setFlipped] = useState(() => new Set());
  if (!items.length) return <p className="empty">No cards were generated.</p>;
  return (
    <ol className="cards" aria-label="Flashcards">
      {items.map((c, i) => {
        const open = flipped.has(i);
        return (
          <li key={i} className="fcard" data-open={open}>
            <p className="fcard-front">{c.front}</p>
            {open && (
              <p className="fcard-back">
                <Inline text={c.back} citations={citations} onCite={onCite} />
              </p>
            )}
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={open}
              onClick={() =>
                setFlipped((s) => {
                  const n = new Set(s);
                  if (n.has(i)) n.delete(i);
                  else n.add(i);
                  return n;
                })
              }
            >
              {open ? 'Hide answer' : 'Show answer'}
            </Button>
          </li>
        );
      })}
    </ol>
  );
}

function Quiz({ items, citations, onCite }) {
  const [picked, setPicked] = useState(/** @type {Record<number, number>} */ ({}));
  if (!items.length) return <p className="empty">No questions were generated.</p>;
  return (
    <ol className="quiz" aria-label="Questions">
      {items.map((q, i) => {
        const choice = picked[i];
        const answered = choice !== undefined;
        return (
          <li key={i}>
            <fieldset>
              <legend>{q.question}</legend>
              {q.options.map((opt, j) => (
                <label key={j} className="quiz-opt" data-state={answered ? (j === q.answer ? 'right' : j === choice ? 'wrong' : undefined) : undefined}>
                  <input type="radio" name={`q-${i}`} checked={choice === j} disabled={answered} onChange={() => setPicked((p) => ({ ...p, [i]: j }))} />
                  {opt}
                </label>
              ))}
            </fieldset>
            {answered && (
              <p className="subtle" role="status">
                {choice === q.answer ? 'Correct. ' : 'Not quite. '}
                <Inline text={q.explanation ?? ''} citations={citations} onCite={onCite} />
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Renders a saved or freshly generated artifact.
 * @param {{ artifact: { kind?: string, action?: string, format: string, content: any }, citations?: Record<string, any>, onCite?: (marker: string) => void }} props
 */
export function ArtifactBody({ artifact, citations = {}, onCite }) {
  const action = artifact.action ?? artifact.kind;
  const content = artifact.content ?? {};
  if (artifact.format !== 'json') return <ArtifactMarkdown text={content.markdown ?? ''} citations={citations} onCite={onCite} />;
  if (action === 'flashcards') return <Flashcards items={content.items ?? []} citations={citations} onCite={onCite} />;
  if (action === 'quiz') return <Quiz items={content.items ?? []} citations={citations} onCite={onCite} />;
  if (action === 'knowledge_map')
    return (
      <Suspense fallback={<Skeleton height={320} />}>
        <KnowledgeMap nodes={content.nodes ?? []} edges={content.edges ?? []} citations={citations} onCite={onCite} />
      </Suspense>
    );
  return <pre className="mono">{JSON.stringify(content, null, 2)}</pre>;
}
