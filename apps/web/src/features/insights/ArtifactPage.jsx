import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client.js';
import { can, useCurrentWorkspace } from '@/features/auth/session.js';
import { budgetScopeText } from '@/features/costs/queries.js';
import { ConfirmDialog, NameDialog } from '@/features/knowledge/dialogs.jsx';
import { formatDate } from '@/shared/format.js';
import { Icon } from '@/shared/icons.jsx';
import { Badge, DemoBadge } from '@/shared/StatusBadge.jsx';
import { EvidenceDrawer } from '@/shared/overlays/EvidenceDrawer.jsx';
import { Button, Callout, DropdownMenu, Skeleton } from '@/shared/ui/index.js';
import { toast } from '@/shared/ui/toast.jsx';
import { ArtifactBody } from './ArtifactBody.jsx';
import { byMarker, evidenceFor } from './evidence.js';
import { KIND_LABEL } from './labels.js';
import { insightKeys, useArtifact, useInsightActions } from './queries.js';

/** One saved artifact: content with citations, the source versions it was built from, and lifecycle actions. */
export function ArtifactPage() {
  const { projectId, artifactId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const workspace = useCurrentWorkspace();
  const wid = workspace?.id;
  const artifact = useArtifact(wid, artifactId);
  const actions = useInsightActions();
  const [dialog, setDialog] = useState(/** @type {null | 'rename' | 'delete'} */ (null));
  const [evidence, setEvidence] = useState(/** @type {any} */ (null));
  const [regenerating, setRegenerating] = useState(false);
  const a = artifact.data;
  const citations = useMemo(() => byMarker(a?.citations), [a?.citations]);

  useEffect(() => {
    document.title = `${a?.title ?? 'Artifact'} · FolioVerse`;
  }, [a?.title]);

  if (artifact.isPending) {
    return (
      <div className="page" aria-busy="true">
        <Skeleton height={28} width="40%" />
        <Skeleton height={300} />
      </div>
    );
  }
  if (artifact.error || !a) {
    return (
      <div className="page">
        <h1>Artifact not found</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          It may have been deleted, or it belongs to a workspace you are not a member of.
        </p>
        <Link className="btn" style={{ marginTop: 14 }} to={`/app/knowledge/projects/${projectId}`}>
          Back to project
        </Link>
      </div>
    );
  }

  const editor = can(workspace, 'EDITOR');
  const pins = a.pins ?? [];
  const pinBy = new Map(pins.map((p) => [p.sourceVersionId, p]));
  const action = (actions.data ?? []).find((x) => x.id === a.action);
  const regenerable = editor && action && pins.length > 0 && pins.every((p) => p.currentVersionId);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: insightKeys.artifact(wid, a.id) });
    qc.invalidateQueries({ queryKey: ['artifacts', wid] });
  };
  const lookup = {
    titleOf: (svid) => pinBy.get(svid)?.title ?? 'Document',
    versionNoOf: (svid) => pinBy.get(svid)?.versionNo,
    currentVersionNoOf: () => undefined,
  };

  async function patch(body) {
    await api(`/workspaces/${wid}/artifacts/${a.id}`, { method: 'PATCH', body });
    refresh();
  }

  async function regenerate() {
    setRegenerating(true);
    try {
      const res = await api(`/workspaces/${wid}/runs`, {
        method: 'POST',
        body: { graph: action.graph, input: { action: action.id }, scope: { sourceVersionIds: [...new Set(pins.map((p) => p.currentVersionId))] } },
      });
      if (res.status === 'BUDGET_REJECTED') toast(`Budget limit reached: this would exceed ${budgetScopeText(res.budget)}. Nothing was sent to a model.`, 'bad');
      else {
        toast('Regenerating on the current version. The new artifact appears when the run finishes.', 'ai');
        const doc = pins.length === 1 ? pins[0] : null;
        if (doc) navigate(`/app/knowledge/projects/${doc.projectId ?? projectId}/documents/${doc.sourceId}`, { state: { tab: 'insights' } });
      }
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div className="page">
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div className="stack" style={{ gap: 6 }}>
          <Link className="subtle" to={`/app/knowledge/projects/${a.projectId ?? projectId}`} style={{ fontSize: 13 }}>
            ← Back to project
          </Link>
          <h1>{a.title}</h1>
          <div className="row">
            <Badge tone="info">{KIND_LABEL[a.kind] ?? a.kind}</Badge>
            {a.isDemo && <DemoBadge />}
            {a.fallback && <Badge tone="warn">Fallback model</Badge>}
            {a.archivedAt && <Badge tone="neutral">Archived</Badge>}
            <span className="subtle" style={{ fontSize: 12 }}>
              Created {formatDate(a.createdAt)}
            </span>
            {a.runId && (
              <Link to={`/app/studio/runs/${a.runId}`} style={{ fontSize: 12 }}>
                View run
              </Link>
            )}
          </div>
        </div>
        {editor && (
          <div className="row">
            {regenerable && (
              <Button variant="ai" size="sm" onClick={regenerate} disabled={regenerating}>
                Regenerate on current version
              </Button>
            )}
            <DropdownMenu
              trigger={
                <button type="button" className="icon-btn" aria-label="Artifact options">
                  <Icon name="more" size={16} />
                </button>
              }
              items={[
                { label: 'Rename', onSelect: () => setDialog('rename') },
                { label: a.archivedAt ? 'Restore' : 'Archive', onSelect: () => patch({ archived: !a.archivedAt }).catch((e) => toast(e.message, 'bad')) },
                '-',
                { label: 'Delete', danger: true, onSelect: () => setDialog('delete') },
              ]}
            />
          </div>
        )}
      </div>

      {a.stale && (
        <div style={{ marginTop: 14 }}>
          <Callout tone="warn">A newer version of a source document exists. This artifact still reflects the versions listed below.</Callout>
        </div>
      )}

      <section aria-labelledby="h-pins" style={{ marginTop: 18 }}>
        <h2 className="sect-h" id="h-pins">
          Built from
        </h2>
        <ul className="row" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {pins.map((p) => (
            <li key={p.sourceVersionId} className="srcchip">
              <Link to={`/app/knowledge/projects/${p.projectId ?? projectId}/documents/${p.sourceId}`}>{p.title}</Link>
              <span className="mono">v{p.versionNo}</span>
              {!p.current && <Badge tone="warn">Not current</Badge>}
            </li>
          ))}
        </ul>
      </section>

      <article className="card pad" style={{ marginTop: 18 }} aria-label={a.title}>
        <ArtifactBody artifact={a} citations={citations} onCite={(m) => setEvidence(evidenceFor(m, citations, lookup))} />
      </article>

      <EvidenceDrawer
        open={Boolean(evidence)}
        onOpenChange={(o) => !o && setEvidence(null)}
        citation={evidence}
        onOpenSource={
          evidence?.anchor && pinBy.get(evidence.anchor.sourceVersionId)
            ? () => {
                const pin = pinBy.get(evidence.anchor.sourceVersionId);
                const sel = evidence.anchor.selectors ?? {};
                navigate(`/app/knowledge/projects/${pin.projectId ?? projectId}/documents/${pin.sourceId}`, {
                  state: {
                    versionId: pin.sourceVersionId,
                    highlight: { page: sel.page, bbox: sel.bbox, start: sel.textPosition?.start, end: sel.textPosition?.end, quote: sel.textQuote?.exact ?? evidence.quote },
                  },
                });
              }
            : undefined
        }
      />
      <NameDialog
        key={`rename-${a.title}`}
        open={dialog === 'rename'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Rename artifact"
        label="Title"
        initial={a.title}
        onSubmit={(title) => patch({ title })}
      />
      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Delete artifact"
        confirmLabel="Delete"
        onConfirm={async () => {
          await api(`/workspaces/${wid}/artifacts/${a.id}`, { method: 'DELETE' });
          qc.invalidateQueries({ queryKey: ['artifacts', wid] });
          toast('Artifact deleted.', 'ok');
          navigate(`/app/knowledge/projects/${a.projectId ?? projectId}`, { replace: true });
        }}
      >
        “{a.title}” will be removed. The run and its receipt stay in the AI Developer Studio.
      </ConfirmDialog>
    </div>
  );
}
