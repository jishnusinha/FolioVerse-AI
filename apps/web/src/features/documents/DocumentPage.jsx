import { Suspense, lazy, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import * as Tabs from '@radix-ui/react-tabs';
import { api } from '@/api/client.js';
import { can, useCurrentWorkspace } from '@/features/auth/session.js';
import { useProject, useSource } from '@/features/knowledge/queries.js';
import { fileType } from '@/features/knowledge/files.js';
import { InsightsPanel } from '@/features/insights/InsightsPanel.jsx';
import { NotesPanel } from '@/features/insights/NotesPanel.jsx';
import { useVersionDiff } from '@/features/insights/queries.js';
import { Icon } from '@/shared/icons.jsx';
import { FolioLens, LENS_ACTIONS } from '@/shared/overlays/FolioLens.jsx';
import { StageTrack, StatusBadge } from '@/shared/StatusBadge.jsx';
import { Callout, Segmented, Skeleton, toast } from '@/shared/ui/index.js';
import { selectionAnchor } from './anchors.js';
import { ChatPanel } from './ChatPanel.jsx';
import { TextViewer } from './TextViewer.jsx';

const PdfViewer = lazy(() => import('./PdfViewer.jsx'));
const ASKABLE = new Set(['READY', 'PARTIAL']);
const ASK_ACTIONS = new Set(['explain', 'define', 'ask', 'facts', 'compare']);
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Document workspace: viewer with citation highlights beside Ask, Insights and Notes. */
export function DocumentPage() {
  const { sourceId } = useParams();
  return <DocumentWorkspace key={sourceId} />;
}

function DocumentWorkspace() {
  const { projectId, sourceId } = useParams();
  const navigate = useNavigate();
  const { state: navState } = useLocation();
  const workspace = useCurrentWorkspace();
  const wid = workspace?.id;
  const project = useProject(wid, projectId);
  const detail = useSource(wid, sourceId);
  const [versionId, setVersionId] = useState(/** @type {string | null} */ (navState?.versionId ?? null));
  const [view, setView] = useState(navState?.highlight && !navState.highlight.bbox ? 'text' : 'original');
  const [highlight, setHighlight] = useState(/** @type {any} */ (navState?.highlight ? { ...navState.highlight, at: Date.now() } : null));
  const [tab, setTab] = useState(navState?.tab ?? 'ask');
  const [chatRequest, setChatRequest] = useState(/** @type {any} */ (null));
  const [compareRequest, setCompareRequest] = useState(0);
  const [noteDraft, setNoteDraft] = useState(/** @type {any} */ (null));
  const [lens, setLens] = useState(/** @type {any} */ (null));
  const paneRef = useRef(/** @type {HTMLElement | null} */ (null));
  const versionSelect = useId();

  const s = detail.data;
  useEffect(() => {
    document.title = `${s?.title ?? 'Document'} · FolioVerse`;
  }, [s?.title]);

  const versions = s?.versions ?? [];
  const current = versions.find((v) => v.id === s?.currentVersionId) ?? versions[0];
  const version = versions.find((v) => v.id === versionId) ?? current;
  const diff = useVersionDiff(wid, s?.id, version?.id, (version?.versionNo ?? 1) > 1);
  const closeLens = useCallback(() => setLens(null), []);

  if (detail.isPending) {
    return (
      <div className="page" aria-busy="true">
        <Skeleton height={28} width="40%" />
        <Skeleton height={400} />
      </div>
    );
  }
  if (detail.error || !s) {
    return (
      <div className="page">
        <h1>Document not found</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          It may have been moved to trash, or it belongs to a workspace you are not a member of.
        </p>
        <Link className="btn" style={{ marginTop: 14 }} to={projectId ? `/app/knowledge/projects/${projectId}` : '/app/knowledge'}>
          Back to project
        </Link>
      </div>
    );
  }

  const isPdf = version?.mimeType === 'application/pdf';
  const fileUrl = version ? `/api/workspaces/${wid}/sources/${s.id}/versions/${version.id}/file` : null;
  const state = version?.ingestionState ?? s.ingestionState;
  const editor = can(workspace, 'EDITOR');
  const blockedReason = !editor
    ? 'Viewers can read answers but cannot ask new questions.'
    : !ASKABLE.has(state)
      ? state === 'QUARANTINED'
        ? 'This file was blocked by the safety scan.'
        : state === 'FAILED'
          ? 'Indexing failed. Retry it from the project page.'
          : 'Asking unlocks when indexing finishes.'
      : null;
  const lensActions = LENS_ACTIONS.K.filter(([id]) => (ASK_ACTIONS.has(id) ? !blockedReason : id === 'note' || id === 'excerpt' ? editor : true));

  /** @param {{ page?: number, bbox?: number[], start?: number, end?: number, quote?: string }} h */
  function showInDocument(h) {
    if (isPdf && view === 'original' && !h.bbox) setView('text');
    setHighlight({ ...h, at: Date.now() });
  }

  /** @param {any} citation from the evidence drawer */
  function openCitation(citation) {
    const a = citation.anchor;
    if (!a) return;
    if (a.sourceVersionId && a.sourceVersionId !== version?.id && versions.some((v) => v.id === a.sourceVersionId)) setVersionId(a.sourceVersionId);
    const sel = a.selectors ?? {};
    setHighlight({ page: sel.page, bbox: sel.bbox, start: sel.textPosition?.start, end: sel.textPosition?.end, quote: sel.textQuote?.exact ?? citation.quote, at: Date.now() });
  }

  function onSelectionEnd() {
    window.setTimeout(() => {
      const a = selectionAnchor(window.getSelection(), paneRef.current);
      if (!a || !version) return;
      const r = a.rect;
      setLens({ anchor: a, rect: { left: r.left, top: r.top, bottom: r.bottom, width: r.width }, result: null });
    }, 0);
  }

  function askInChat(text) {
    setTab('ask');
    setChatRequest({ kind: 'ask', text, at: Date.now() });
    setLens(null);
  }

  async function findRelated(quote) {
    setLens((l) => l && { ...l, result: { phase: 'loading' } });
    try {
      const res = await api(`/workspaces/${wid}/search?${new URLSearchParams({ q: clip(quote, 300), projectId: projectId ?? '' })}`);
      const items = (res.items ?? [])
        .filter((it) => it.type === 'passage' || it.type === 'note' || it.type === 'artifact')
        .slice(0, 6)
        .map((it) => ({
          id: `${it.type}-${it.id}`,
          title: it.title,
          page: it.page,
          snippet: it.snippet,
          onOpen: () => {
            setLens(null);
            if (it.type === 'artifact') navigate(`/app/knowledge/projects/${it.projectId}/artifacts/${it.id}`);
            else if (it.sourceId === s.id) showInDocument({ page: it.page ?? undefined, quote: it.snippet?.split('\n')[0]?.trim() });
            else if (it.sourceId) navigate(`/app/knowledge/projects/${it.projectId}/documents/${it.sourceId}`);
          },
        }));
      const message = res.semantic?.status === 'UNAVAILABLE' ? 'Semantic search is unavailable right now; only keyword matches are shown.' : undefined;
      setLens((l) => l && { ...l, result: { phase: 'done', items, message } });
    } catch (err) {
      setLens((l) => l && { ...l, result: { phase: 'error', message: err.message, onRetry: () => findRelated(quote) } });
    }
  }

  /** @param {string} id */
  function onLensAction(id) {
    const { anchor } = lens;
    const quote = anchor.quote;
    if (id === 'explain') askInChat(`Explain this passage in plain language: “${quote}”`);
    else if (id === 'define') askInChat(`Define “${clip(quote.trim(), 120)}” as it is used in this document.`);
    else if (id === 'facts') askInChat(`List the facts stated in this passage: “${quote}”`);
    else if (id === 'ask') {
      setTab('ask');
      setChatRequest({ kind: 'prefill', text: `About “${clip(quote, 160)}”: `, at: Date.now() });
      setLens(null);
    } else if (id === 'related') findRelated(quote);
    else if (id === 'note') {
      const selectors = { page: anchor.page, textQuote: { exact: quote }, ...(anchor.start != null ? { textPosition: { start: anchor.start, end: anchor.end } } : {}) };
      setNoteDraft({ quote, anchor: { sourceVersionId: version.id, selectors }, at: Date.now() });
      setTab('notes');
      setLens(null);
    } else if (id === 'excerpt') {
      const selectors = { page: anchor.page, textQuote: { exact: quote }, ...(anchor.start != null ? { textPosition: { start: anchor.start, end: anchor.end } } : {}) };
      setLens(null);
      api(`/workspaces/${wid}/excerpts`, { method: 'POST', body: { sourceId: s.id, sourceVersionId: version.id, quote: clip(quote, 4000), anchor: { sourceVersionId: version.id, selectors } } })
        .then(() => toast('Saved as an excerpt. Add it to a manuscript from Folio Writer’s Research tab.', 'ok'))
        .catch((err) => toast(err.message, 'bad'));
    } else if (id === 'compare') {
      setTab('insights');
      setCompareRequest(Date.now());
      setLens(null);
    }
  }

  return (
    <div className="panes d-panes">
      <section
        ref={paneRef}
        className="pane"
        id="docpane"
        aria-label="Document"
        onMouseUp={onSelectionEnd}
        onKeyUp={(e) => {
          if (e.shiftKey) onSelectionEnd();
        }}
      >
        <div className="bar-top">
          <Link className="icon-btn" to={`/app/knowledge/projects/${projectId}`} aria-label={`Back to ${project.data?.name ?? 'project'}`}>
            <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}>
              <Icon name="chev" size={16} />
            </span>
          </Link>
          <span className="ft" data-t={fileType(s)}>
            {fileType(s)}
          </span>
          <h1 style={{ fontSize: 14, fontWeight: 600, overflowWrap: 'anywhere' }}>{s.title}</h1>
          <label className="sr" htmlFor={versionSelect}>
            Version
          </label>
          <select
            id={versionSelect}
            className="select"
            style={{ width: 'auto', height: 28 }}
            value={version?.id ?? ''}
            onChange={(e) => {
              setVersionId(e.target.value);
              setHighlight(null);
            }}
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.versionNo}
                {v.id === s.currentVersionId ? ' · current' : ''}
              </option>
            ))}
          </select>
          <span className="grow" />
          {isPdf && (
            <Segmented
              label="View"
              value={view}
              onChange={setView}
              options={[
                { value: 'original', label: 'Original' },
                { value: 'text', label: 'Text' },
              ]}
            />
          )}
          {fileUrl && state !== 'QUARANTINED' && (
            <a className="icon-btn" href={fileUrl} download aria-label="Download this version">
              <Icon name="download" size={16} />
            </a>
          )}
          <StatusBadge family="ingest" value={state} />
        </div>
        {version && current && version.id !== current.id && (
          <p className="callout warn banner">
            Viewing version {version.versionNo}. Answers keep the version they were based on; the current version is v{current.versionNo}.
          </p>
        )}
        {diff.data?.summary && <VersionChanges diff={diff.data} onShow={(p) => showInDocument({ page: p.page, quote: p.text })} />}
        {!ASKABLE.has(state) && state !== 'QUARANTINED' && (
          <div className="pad" style={{ maxWidth: 760, margin: '12px auto 0' }}>
            <StageTrack state={state} labels />
          </div>
        )}
        {state === 'QUARANTINED' ? (
          <Callout tone="bad">This file was blocked by the safety scan and cannot be displayed.</Callout>
        ) : isPdf && view === 'original' ? (
          <Suspense fallback={<Skeleton height={400} />}>
            <PdfViewer url={fileUrl} highlight={highlight} />
          </Suspense>
        ) : (
          version && <TextViewer wid={wid} sourceId={s.id} versionId={version.id} highlight={highlight} />
        )}
      </section>
      {version && (
        <aside className="chat side" aria-label="Document assistant">
          <Tabs.Root value={tab} onValueChange={setTab} className="side-tabs">
            <Tabs.List className="tabs side-tablist" aria-label="Assistant">
              <Tabs.Trigger value="ask">Ask</Tabs.Trigger>
              <Tabs.Trigger value="insights">Insights</Tabs.Trigger>
              <Tabs.Trigger value="notes">Notes</Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="ask" forceMount hidden={tab !== 'ask'} className="side-panel">
              <ChatPanel
                wid={wid}
                source={s}
                version={version}
                projectId={projectId}
                canAsk={!blockedReason}
                canEdit={editor}
                blockedReason={blockedReason}
                projectName={project.data?.name}
                onOpenCitation={openCitation}
                request={chatRequest}
              />
            </Tabs.Content>
            <Tabs.Content value="insights" forceMount hidden={tab !== 'insights'} className="side-panel">
              <InsightsPanel
                wid={wid}
                source={s}
                version={version}
                projectId={projectId}
                canRun={!blockedReason}
                blockedReason={blockedReason}
                onOpenCitation={openCitation}
                compareRequest={compareRequest}
              />
            </Tabs.Content>
            <Tabs.Content value="notes" forceMount hidden={tab !== 'notes'} className="side-panel">
              <NotesPanel
                wid={wid}
                source={s}
                version={version}
                canEdit={editor}
                draft={noteDraft}
                onDraftDone={() => setNoteDraft(null)}
                onShowAnchor={(note) => {
                  const a = note.anchor ?? {};
                  if (a.sourceVersionId && a.sourceVersionId !== version.id && versions.some((v) => v.id === a.sourceVersionId)) setVersionId(a.sourceVersionId);
                  const sel = a.selectors ?? {};
                  showInDocument({ page: sel.page, start: sel.textPosition?.start, end: sel.textPosition?.end, quote: sel.textQuote?.exact ?? note.quote ?? undefined });
                }}
              />
            </Tabs.Content>
          </Tabs.Root>
        </aside>
      )}
      <FolioLens
        open={Boolean(lens)}
        kind="K"
        text={lens?.anchor.quote ?? ''}
        anchor={lens?.rect ?? null}
        onClose={closeLens}
        onAction={onLensAction}
        onAsk={blockedReason ? undefined : (q) => askInChat(`${q}\n\nAbout this passage: “${lens.anchor.quote}”`)}
        result={lens?.result ?? null}
        actions={lensActions}
      />
    </div>
  );
}

/** Paragraph-level summary of what changed since the previous version. */
function VersionChanges({ diff, onShow }) {
  const { summary, from, to } = diff;
  if (!summary.added && !summary.removed && !summary.changed) {
    return <p className="callout banner">No text changes since v{from.versionNo}.</p>;
  }
  const item = (p, label) => (
    <li key={`${label}-${p.page}-${p.index}`}>
      <span className="subtle">{label} · p. {p.page}</span>{' '}
      {label === 'Removed' ? (
        <span>{clip(p.text, 140)}</span>
      ) : (
        <button type="button" className="linkish" onClick={() => onShow(p)}>
          {clip(p.text, 140)}
        </button>
      )}
    </li>
  );
  return (
    <details className="callout banner vdiff">
      <summary>
        Changes since v{from.versionNo}: {summary.changed} changed · {summary.added} added · {summary.removed} removed paragraphs
      </summary>
      <ul aria-label={`Changes from v${from.versionNo} to v${to.versionNo}`}>
        {summary.samples.changed.map((c) => item(c.after, 'Changed'))}
        {summary.samples.added.map((p) => item(p, 'Added'))}
        {summary.samples.removed.map((p) => item(p, 'Removed'))}
      </ul>
    </details>
  );
}
