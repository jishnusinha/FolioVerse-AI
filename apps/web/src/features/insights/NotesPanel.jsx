import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client.js';
import { formatDate } from '@/shared/format.js';
import { Button, Callout, Skeleton } from '@/shared/ui/index.js';
import { insightKeys, useNotes } from './queries.js';

/**
 * Notes on one document. Notes added from Folio Lens keep the quoted passage and its anchor, so
 * "Show in document" returns to the exact place.
 * @param {{ wid: string, source: any, version: any, canEdit: boolean, onShowAnchor: (note: any) => void,
 *   draft?: { quote: string, anchor: any, at: number } | null, onDraftDone?: () => void }} props
 */
export function NotesPanel({ wid, source, version, canEdit, onShowAnchor, draft, onDraftDone }) {
  const qc = useQueryClient();
  const notes = useNotes(wid, source.id);
  const [body, setBody] = useState('');
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const fieldId = useId();
  const refresh = () => qc.invalidateQueries({ queryKey: insightKeys.notes(wid, source.id) });

  async function add(e) {
    e.preventDefault();
    if (!body.trim()) return;
    try {
      await api(`/workspaces/${wid}/notes`, {
        method: 'POST',
        body: {
          body: body.trim(),
          sourceId: source.id,
          sourceVersionId: draft?.anchor?.sourceVersionId ?? version.id,
          ...(draft ? { quote: draft.quote.slice(0, 2000), anchor: draft.anchor } : {}),
        },
      });
      setBody('');
      setError(null);
      onDraftDone?.();
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(id) {
    await api(`/workspaces/${wid}/notes/${id}`, { method: 'DELETE' });
    refresh();
  }

  const versionNo = (svid) => source.versions?.find((v) => v.id === svid)?.versionNo;
  return (
    <div className="side-body">
      {canEdit && (
        <form className="stack" onSubmit={add} style={{ gap: 6 }}>
          <label htmlFor={fieldId} className="sect-h">
            {draft ? 'Note on the selected passage' : 'New note'}
          </label>
          {draft && (
            <blockquote className="note-quote">
              “{draft.quote}”{' '}
              <Button size="sm" variant="ghost" onClick={onDraftDone}>
                Remove passage
              </Button>
            </blockquote>
          )}
          <textarea id={fieldId} className="input" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a note about this document…" />
          <div className="row between">
            <span className="subtle" style={{ fontSize: 12 }}>
              Select text in the document to add an anchored note with Folio Lens.
            </span>
            <Button type="submit" size="sm" variant="primary" disabled={!body.trim()}>
              Add note
            </Button>
          </div>
          {error && <Callout tone="bad">{error}</Callout>}
        </form>
      )}
      {notes.isPending ? (
        <Skeleton height={60} />
      ) : !notes.data?.length ? (
        <p className="empty">No notes yet.</p>
      ) : (
        <ul className="notes" aria-label="Notes">
          {notes.data.map((n) => (
            <li key={n.id} className="note">
              {n.quote && <blockquote>“{n.quote}”</blockquote>}
              <p>{n.body}</p>
              <div className="row" style={{ fontSize: 12 }}>
                <span className="subtle">
                  {formatDate(n.createdAt)}
                  {n.sourceVersionId && versionNo(n.sourceVersionId) ? ` · v${versionNo(n.sourceVersionId)}` : ''}
                </span>
                <span className="grow" />
                {n.anchor && (
                  <Button size="sm" variant="ghost" onClick={() => onShowAnchor(n)}>
                    Show in document
                  </Button>
                )}
                {canEdit && (
                  <Button size="sm" variant="ghost" onClick={() => remove(n.id)} aria-label={`Delete note: ${n.body.slice(0, 40)}`}>
                    Delete
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
