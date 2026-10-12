import { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client.js';
import { useSources } from '@/features/knowledge/queries.js';
import { Icon } from '@/shared/icons.jsx';
import { StatusBadge } from '@/shared/StatusBadge.jsx';
import { Button, Callout, Dialog, DropdownMenu, Skeleton } from '@/shared/ui/index.js';
import { CitedText } from '../runs/CitedText.jsx';
import { runKeys } from '../runs/queries.js';
import { messageOutcome, pathTo } from './conversation.js';

const READY = new Set(['READY', 'PARTIAL']);

/**
 * Documents a conversation searches. Before the first question the scope is local; afterwards
 * changes create a new context scope on the thread (earlier answers keep theirs).
 * @param {{ wid: string, projectId: string, source: any, version: any, thread: any | null, extra: any[], setExtra: (x: any[]) => void, canEdit: boolean }} props
 */
export function ScopeBar({ wid, projectId, source, version, thread, extra, setExtra, canEdit }) {
  const qc = useQueryClient();
  const siblings = useSources(wid, projectId);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const pickId = useId();
  const items = thread?.scope?.sources
    ? thread.scope.sources.map((s) => ({ sourceVersionId: s.sourceVersionId, title: s.title, versionNo: s.versionNo }))
    : [{ sourceVersionId: version.id, title: source.title, versionNo: version.versionNo }, ...extra];
  const inScope = new Set(items.map((i) => i.sourceVersionId));
  const candidates = (siblings.data ?? []).filter((s) => READY.has(s.ingestionState) && s.currentVersionId && !inScope.has(s.currentVersionId));

  async function update(next) {
    setError(null);
    if (!thread) {
      setExtra(next.filter((i) => i.sourceVersionId !== version.id));
      return;
    }
    try {
      await api(`/workspaces/${wid}/threads/${thread.id}/scope`, { method: 'PUT', body: { sourceVersionIds: next.map((i) => i.sourceVersionId) } });
      qc.invalidateQueries({ queryKey: runKeys.thread(wid, thread.id) });
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row wrap" aria-label="Conversation scope" role="group">
        {items.map((i) => (
          <span key={i.sourceVersionId} className="srcchip">
            {i.title.replace(/\.\w+$/, '')} {i.versionNo != null && <span className="mono">v{i.versionNo}</span>}
            {canEdit && items.length > 1 && (
              <button type="button" className="chip-x" aria-label={`Remove ${i.title} from this conversation`} onClick={() => update(items.filter((x) => x.sourceVersionId !== i.sourceVersionId))}>
                <Icon name="x" size={12} />
              </button>
            )}
          </span>
        ))}
        {canEdit && candidates.length > 0 && !adding && (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            + Add document
          </Button>
        )}
      </div>
      {adding && (
        <div className="row">
          <label className="sr" htmlFor={pickId}>
            Document to add
          </label>
          <select
            id={pickId}
            className="select"
            style={{ height: 28, fontSize: 12 }}
            defaultValue=""
            onChange={(e) => {
              const s = candidates.find((c) => c.id === e.target.value);
              setAdding(false);
              if (s) update([...items, { sourceVersionId: s.currentVersionId, title: s.title, versionNo: s.currentVersion?.versionNo }]);
            }}
          >
            <option value="" disabled>
              Choose a ready document…
            </option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </div>
      )}
      {thread && items.length > 0 && thread.scope && <span className="subtle" style={{ fontSize: 11 }}>Changes apply to new questions; earlier answers keep their sources.</span>}
      {error && <Callout tone="bad">{error}</Callout>}
    </div>
  );
}

/**
 * Rename, archive and browse conversations for this document.
 * @param {{ wid: string, sourceId: string, thread: any | null, canEdit: boolean, onSelect: (id: string) => void, onArchived: () => void }} props
 */
export function ThreadMenu({ wid, sourceId, thread, canEdit, onSelect, onArchived }) {
  const qc = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [title, setTitle] = useState('');
  const titleId = useId();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['threads', wid] });
    if (thread) qc.invalidateQueries({ queryKey: runKeys.thread(wid, thread.id) });
  };
  const items = [
    ...(thread && canEdit
      ? [
          {
            label: 'Rename conversation',
            onSelect: () => {
              setTitle(thread.title);
              setRenaming(true);
            },
          },
          {
            label: 'Archive conversation',
            onSelect: async () => {
              await api(`/workspaces/${wid}/threads/${thread.id}`, { method: 'PATCH', body: { archived: true } });
              refresh();
              onArchived();
            },
          },
          '-',
        ]
      : []),
    { label: 'All conversations…', onSelect: () => setBrowsing(true) },
  ];
  return (
    <>
      <DropdownMenu
        trigger={
          <button type="button" className="icon-btn" aria-label="Conversation options">
            <Icon name="more" size={16} />
          </button>
        }
        items={items}
      />
      <Dialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename conversation"
        footer={
          <>
            <Button onClick={() => setRenaming(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!title.trim()}
              onClick={async () => {
                await api(`/workspaces/${wid}/threads/${thread.id}`, { method: 'PATCH', body: { title: title.trim() } });
                setRenaming(false);
                refresh();
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <label htmlFor={titleId} className="sect-h">
          Title
        </label>
        <input id={titleId} className="input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      </Dialog>
      <ConversationsDialog wid={wid} sourceId={sourceId} open={browsing} onOpenChange={setBrowsing} canEdit={canEdit} onSelect={onSelect} onChanged={refresh} />
    </>
  );
}

function ConversationsDialog({ wid, sourceId, open, onOpenChange, canEdit, onSelect, onChanged }) {
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const searchId = useId();
  const list = useQuery({
    queryKey: ['threads', wid, sourceId, 'browse', q, archived],
    queryFn: () => api(`/workspaces/${wid}/threads?sourceId=${sourceId}${q ? `&q=${encodeURIComponent(q)}` : ''}${archived ? '&archived=true' : ''}`),
    enabled: open,
    placeholderData: (prev) => prev,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Conversations about this document">
      <div className="row" style={{ marginBottom: 10 }}>
        <label className="sr" htmlFor={searchId}>
          Search conversations
        </label>
        <input id={searchId} className="input grow" type="search" placeholder="Search titles and messages…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="row subtle" style={{ gap: 6, fontSize: 12 }}>
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Archived
        </label>
      </div>
      {list.isPending ? (
        <Skeleton height={40} />
      ) : !list.data?.length ? (
        <p className="empty">{archived ? 'No archived conversations.' : 'No conversations match.'}</p>
      ) : (
        <ul className="list">
          {list.data.map((t) => (
            <li key={t.id} className="li">
              <span className="grow">
                {t.title}{' '}
                <span className="subtle" style={{ fontSize: 12 }}>
                  · {t.messageCount} message{t.messageCount === 1 ? '' : 's'}
                </span>
              </span>
              {archived ? (
                canEdit && (
                  <Button
                    size="sm"
                    onClick={async () => {
                      await api(`/workspaces/${wid}/threads/${t.id}`, { method: 'PATCH', body: { archived: false } });
                      onChanged();
                      list.refetch();
                    }}
                  >
                    Restore
                  </Button>
                )
              ) : (
                <Button
                  size="sm"
                  onClick={() => {
                    onSelect(t.id);
                    onOpenChange(false);
                  }}
                >
                  Open
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

/**
 * Side-by-side view of two branches of the same conversation.
 * @param {{ open: boolean, onOpenChange: (o: boolean) => void, messages: any[], branches: { leafId: string, label: string }[] }} props
 */
export function BranchCompareDialog({ open, onOpenChange, messages, branches }) {
  const [a, setA] = useState(0);
  const [b, setB] = useState(1);
  const side = (i) => {
    const br = branches[i];
    if (!br) return null;
    const path = pathTo(messages, br.leafId);
    const answer = [...path].reverse().find((m) => m.role === 'ASSISTANT');
    const question = [...path].reverse().find((m) => m.role === 'USER');
    const citations = Object.fromEntries((answer?.citations ?? []).map((c) => [c.marker, c]));
    return { question, answer, citations };
  };
  const cols = [
    [a, setA],
    [b, setB],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Compare branches" className="wide">
      <div className="cmp-grid">
        {cols.map(([idx, set], col) => {
          const s = side(idx);
          return (
            <section key={col} aria-label={`Branch ${String.fromCharCode(65 + idx)}`}>
              <select className="select" value={idx} aria-label={`Branch for column ${col + 1}`} onChange={(e) => set(Number(e.target.value))}>
                {branches.map((br, i) => (
                  <option key={br.leafId} value={i}>
                    {String.fromCharCode(65 + i)} · {br.label}
                  </option>
                ))}
              </select>
              {s?.question && <p className="msg-user">{s.question.content}</p>}
              {s?.answer ? (
                <div className="ai-block">
                  <CitedText text={s.answer.content} citations={s.citations} />
                  <StatusBadge family="outcome" value={messageOutcome(s.answer)} />
                </div>
              ) : (
                <p className="subtle">This branch has no answer yet.</p>
              )}
            </section>
          );
        })}
      </div>
    </Dialog>
  );
}
