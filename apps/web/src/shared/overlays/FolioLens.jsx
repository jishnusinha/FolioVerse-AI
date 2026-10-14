import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../icons.jsx';
import { StatusBadge } from '../StatusBadge.jsx';
import { useRestoreFocus, useRovingTabIndex } from '../a11y/focus.js';

/** Lens action registry per context: K = Knowledge, W = Writer, R = Reader. */
export const LENS_ACTIONS = {
  K: [
    ['explain', 'Explain selection'],
    ['define', 'Define term'],
    ['ask', 'Ask about this'],
    ['related', 'Find related evidence'],
    ['note', 'Add to notes'],
    ['excerpt', 'Save as excerpt'],
    ['compare', 'Compare with another source'],
    ['facts', 'Extract facts'],
  ],
  W: [
    ['rewrite', 'Rewrite paragraph'],
    ['tighten', 'Tighten'],
    ['expand', 'Expand'],
    ['tone', 'Change tone…'],
    ['continuity', 'Look up canon'],
  ],
  R: [
    ['define', 'Define'],
    ['rexplain', 'Explain'],
    ['summ', 'Summarize passage'],
    ['hl', 'Save highlight'],
    ['rask', 'Ask about the passage'],
    ['study', 'Create study note'],
  ],
};
const CONTEXT_LABEL = { K: 'Knowledge', W: 'Writer', R: 'Reader' };
const WIDTH = 288;

const clip = (s, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Folio Lens: anchored action popover for a text selection.
 * @param {{ open: boolean, kind: 'K'|'W'|'R', text: string, anchor: { left: number, top: number, bottom: number, width: number } | null,
 *   onClose: () => void, onAction: (id: string) => void, onAsk?: (q: string) => void, autoFocus?: boolean,
 *   result?: { phase: 'loading'|'streaming'|'done'|'abstain'|'error', text?: string, message?: string, onRetry?: () => void,
 *     items?: { id: string, title: string, page?: number | null, snippet?: string, onOpen: () => void }[] } | null,
 *   actions?: [string, string][] }} props
 */
export function FolioLens({ open, kind, text, anchor, onClose, onAction, onAsk, autoFocus = false, result = null, actions }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });
  const list = actions ?? LENS_ACTIONS[kind];
  const roving = useRovingTabIndex(list.length);
  const [q, setQ] = useState('');
  useRestoreFocus(open);

  useLayoutEffect(() => {
    if (!open || !anchor || !ref.current) return;
    const h = ref.current.offsetHeight;
    const left = Math.min(Math.max(8, anchor.left + anchor.width / 2 - WIDTH / 2), window.innerWidth - WIDTH - 8);
    let top = anchor.bottom + 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, anchor.top - h - 8);
    setPos({ left, top });
  }, [open, anchor, result]);

  const { focusAt } = roving;
  useEffect(() => {
    if (open && autoFocus && !result && pos.left !== -9999) {
      focusAt(0);
    }
  }, [open, autoFocus, result, pos.left, focusAt]);

  const openedAtRef = useRef(0);
  useEffect(() => {
    if (open) {
      openedAtRef.current = Date.now();
    } else {
      setPos({ left: -9999, top: -9999 });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (ev) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        onClose();
      } else if (ev.altKey && ev.key.toLowerCase() === 'l') {
        ev.preventDefault();
        focusAt(0);
      }
    };
    const onDown = (ev) => {
      if (ref.current && !ref.current.contains(ev.target)) onClose();
    };
    const onScroll = (ev) => {
      if (Date.now() - openedAtRef.current < 200) return;
      if (ref.current && !(ev.target instanceof Node && ref.current.contains(ev.target))) onClose();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [open, onClose, focusAt]);

  if (!open) return null;
  return (
    <div ref={ref} className="lens" role="dialog" aria-label="Folio Lens" style={{ left: pos.left, top: pos.top }}>
      <div className="lens-h">
        <span className="ai-tag">
          <Icon name="lens" size={12} /> Folio Lens · {CONTEXT_LABEL[kind]}
        </span>
        <span className="lens-q">“{clip(text)}”</span>
      </div>
      {result ? (
        <LensResult result={result} />
      ) : (
        <div role="menu" aria-label="Lens actions">
          {list.map(([id, label], i) => (
            <button key={id} type="button" role="menuitem" className="lens-a" onClick={() => onAction(id)} {...roving.getItemProps(i)}>
              {label}
            </button>
          ))}
        </div>
      )}
      {onAsk && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) onAsk(q.trim());
          }}
        >
          <label className="sr" htmlFor="lens-q">
            Ask about the selection
          </label>
          <input id="lens-q" className="input" placeholder="Ask anything about this…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn sm ai" type="submit">
            Ask
          </button>
        </form>
      )}
    </div>
  );
}

function LensResult({ result }) {
  if (result.phase === 'loading') {
    return (
      <div className="lens-r" aria-busy="true">
        <StatusBadge family="run" value="RUNNING" />
        <span className="skeleton" style={{ width: '90%', height: 12 }} />
        <span className="skeleton" style={{ width: '70%', height: 12 }} />
      </div>
    );
  }
  if (result.phase === 'abstain') {
    return (
      <div className="lens-r">
        <StatusBadge family="outcome" value="ABSTAINED" />
        <p className="muted">{result.message ?? 'There is not enough evidence in the selected sources to answer.'}</p>
      </div>
    );
  }
  if (result.phase === 'error') {
    return (
      <div className="lens-r" role="alert">
        <StatusBadge family="run" value="FAILED" />
        <p className="muted">{result.message ?? 'The action failed. No charge was made.'}</p>
        {result.onRetry && (
          <button type="button" className="btn sm" onClick={result.onRetry}>
            Retry
          </button>
        )}
      </div>
    );
  }
  if (result.items) {
    return (
      <div className="lens-r" aria-live="polite">
        {result.items.length ? (
          <ul className="lens-list" aria-label="Related evidence">
            {result.items.map((it) => (
              <li key={it.id}>
                <button type="button" className="lens-a lens-item" onClick={it.onOpen}>
                  <b>
                    {it.title}
                    {it.page ? ` · p. ${it.page}` : ''}
                  </b>
                  <span className="subtle">{clip(it.snippet ?? '', 140)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{result.message ?? 'No related passages were found in this workspace.'}</p>
        )}
      </div>
    );
  }
  return (
    <div className="lens-r" aria-live="polite">
      <StatusBadge family="run" value={result.phase === 'streaming' ? 'STREAMING' : 'SUCCEEDED'} />
      <div className="ai-block">{result.text}</div>
    </div>
  );
}
