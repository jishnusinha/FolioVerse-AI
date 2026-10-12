import { Suspense, lazy, useEffect, useId, useState } from 'react';
import { Link, useParams } from 'react-router';
import { can, useCurrentWorkspace } from '@/features/auth/session.js';
import { useProject, useSource } from '@/features/knowledge/queries.js';
import { fileType } from '@/features/knowledge/files.js';
import { Icon } from '@/shared/icons.jsx';
import { StageTrack, StatusBadge } from '@/shared/StatusBadge.jsx';
import { Callout, Segmented, Skeleton } from '@/shared/ui/index.js';
import { ChatPanel } from './ChatPanel.jsx';
import { TextViewer } from './TextViewer.jsx';

const PdfViewer = lazy(() => import('./PdfViewer.jsx'));
const ASKABLE = new Set(['READY', 'PARTIAL']);

/** Document workspace: viewer with citation highlights beside a grounded conversation. */
export function DocumentPage() {
  const { projectId, sourceId } = useParams();
  const workspace = useCurrentWorkspace();
  const wid = workspace?.id;
  const project = useProject(wid, projectId);
  const detail = useSource(wid, sourceId);
  const [versionId, setVersionId] = useState(/** @type {string | null} */ (null));
  const [view, setView] = useState('original');
  const [highlight, setHighlight] = useState(/** @type {any} */ (null));
  const versionSelect = useId();

  const s = detail.data;
  useEffect(() => {
    document.title = `${s?.title ?? 'Document'} · FolioVerse`;
  }, [s?.title]);

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

  const versions = s.versions ?? [];
  const current = versions.find((v) => v.id === s.currentVersionId) ?? versions[0];
  const version = versions.find((v) => v.id === versionId) ?? current;
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

  /** @param {any} citation from the evidence drawer */
  function openCitation(citation) {
    const a = citation.anchor;
    if (!a) return;
    if (a.sourceVersionId && a.sourceVersionId !== version?.id && versions.some((v) => v.id === a.sourceVersionId)) setVersionId(a.sourceVersionId);
    const sel = a.selectors ?? {};
    setHighlight({ page: sel.page, bbox: sel.bbox, start: sel.textPosition?.start, end: sel.textPosition?.end, quote: sel.textQuote?.exact ?? citation.quote, at: Date.now() });
  }

  return (
    <div className="panes d-panes">
      <section className="pane" id="docpane" aria-label="Document">
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
        <ChatPanel
          wid={wid}
          source={s}
          version={version}
          canAsk={!blockedReason}
          blockedReason={blockedReason}
          projectName={project.data?.name}
          onOpenCitation={openCitation}
        />
      )}
    </div>
  );
}
