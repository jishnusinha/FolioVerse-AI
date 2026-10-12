import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client.js';
import { useSources } from '@/features/knowledge/queries.js';
import { formatUsd } from '@/shared/format.js';
import { Badge, StatusBadge } from '@/shared/StatusBadge.jsx';
import { EvidenceDrawer } from '@/shared/overlays/EvidenceDrawer.jsx';
import { RunReceipt } from '@/shared/overlays/RunReceipt.jsx';
import { Button, Callout, Skeleton } from '@/shared/ui/index.js';
import { useReceipt } from '../runs/queries.js';
import { useRunEvents } from '../runs/useRunEvents.js';
import { visibleText } from '../runs/runState.js';
import { ArtifactBody, ArtifactMarkdown } from './ArtifactBody.jsx';
import { evidenceFor } from './evidence.js';
import { KIND_LABEL } from './labels.js';
import { insightKeys, useArtifact, useArtifacts, useInsightActions } from './queries.js';

const READY = new Set(['READY', 'PARTIAL']);

/**
 * Insight actions for one document version, the live result of the last action, and the
 * artifacts already saved for this document.
 * @param {{ wid: string, source: any, version: any, projectId: string, canRun: boolean, blockedReason?: string | null,
 *   onOpenCitation: (evidence: any) => void, compareRequest?: number }} props
 */
export function InsightsPanel({ wid, source, version, projectId, canRun, blockedReason, onOpenCitation, compareRequest }) {
  const qc = useQueryClient();
  const actions = useInsightActions();
  const saved = useArtifacts(wid, { sourceId: source.id });
  const siblings = useSources(wid, projectId);
  const [active, setActive] = useState(/** @type {any} */ (null));
  const [picking, setPicking] = useState(/** @type {any} */ (null));
  const [other, setOther] = useState('');
  const [evidence, setEvidence] = useState(/** @type {any} */ (null));
  const otherId = useId();

  const groups = useMemo(() => {
    const out = new Map();
    for (const a of actions.data ?? []) out.set(a.group, [...(out.get(a.group) ?? []), a]);
    return [...out];
  }, [actions.data]);
  const compareAction = (actions.data ?? []).find((a) => a.id === 'compare');
  const others = (siblings.data ?? []).filter((s) => s.id !== source.id && READY.has(s.ingestionState) && s.currentVersionId);

  const [lastCompare, setLastCompare] = useState(compareRequest);
  if (compareRequest !== lastCompare) {
    setLastCompare(compareRequest);
    if (compareRequest && compareAction) setPicking(compareAction);
  }

  async function run(action, extraVersionIds = []) {
    setPicking(null);
    setActive({ action, phase: 'starting' });
    try {
      const res = await api(`/workspaces/${wid}/runs`, {
        method: 'POST',
        body: { graph: action.graph, input: { action: action.id }, scope: { sourceVersionIds: [version.id, ...extraVersionIds] } },
      });
      if (res.status === 'BUDGET_REJECTED') setActive({ action, phase: 'budget', estimate: res.estimate, remaining: res.remaining });
      else setActive({ action, phase: 'running', runId: res.runId });
    } catch (e) {
      setActive({ action, phase: 'error', message: e.message });
    }
  }

  function choose(action) {
    if (action.minSources > 1) {
      setPicking(action);
      setOther(others[0]?.id ?? '');
    } else run(action);
  }

  const lookup = {
    titleOf: (svid) => (svid === version.id || source.versions?.some((v) => v.id === svid) ? source.title : others.find((s) => s.currentVersionId === svid)?.title ?? 'Document'),
    versionNoOf: (svid) => source.versions?.find((v) => v.id === svid)?.versionNo,
    currentVersionNoOf: (svid) => (source.versions?.some((v) => v.id === svid) ? source.versions.find((v) => v.id === source.currentVersionId)?.versionNo : undefined),
  };

  return (
    <div className="side-body">
      <section aria-labelledby="h-ins">
        <h2 className="sect-h" id="h-ins">
          Intelligent actions
        </h2>
        {!canRun && <p className="callout" style={{ marginBottom: 8 }}>{blockedReason}</p>}
        {actions.isPending ? (
          <Skeleton height={80} />
        ) : (
          groups.map(([group, list]) => (
            <div key={group} className="ins-group" role="group" aria-label={group}>
              <span className="eyebrow">{group}</span>
              <div className="actions">
                {list.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className="chipbtn"
                    aria-pressed={active?.action?.id === a.id}
                    disabled={!canRun || active?.phase === 'starting' || (a.minSources > 1 && !others.length)}
                    title={a.minSources > 1 && !others.length ? 'Needs another ready document in this project' : `${a.graph} · ${a.tier}`}
                    onClick={() => choose(a)}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
        {picking && (
          <form
            className="ins-pick"
            onSubmit={(e) => {
              e.preventDefault();
              const s = others.find((x) => x.id === other);
              if (s) run(picking, [s.currentVersionId]);
            }}
          >
            <label htmlFor={otherId}>Compare with</label>
            <select id={otherId} className="select" value={other} onChange={(e) => setOther(e.target.value)}>
              {others.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
            <Button type="submit" size="sm" variant="ai" disabled={!other}>
              Compare
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPicking(null)}>
              Cancel
            </Button>
          </form>
        )}
      </section>

      {active && (
        <ActiveInsight
          wid={wid}
          active={active}
          onRetry={() => run(active.action)}
          onFinished={() => qc.invalidateQueries({ queryKey: insightKeys.artifacts(wid, { sourceId: source.id }) })}
          onCite={(marker, citations) => setEvidence(evidenceFor(marker, citations, lookup))}
          projectId={projectId}
        />
      )}

      <section aria-labelledby="h-arts">
        <h2 className="sect-h" id="h-arts">
          Saved artifacts
        </h2>
        {saved.isPending ? (
          <Skeleton height={40} />
        ) : !saved.data?.length ? (
          <p className="subtle">Artifacts from insight actions on this document are saved here automatically.</p>
        ) : (
          <ul className="list">
            {saved.data.map((a) => (
              <li key={a.id} className="li">
                <Link to={`/app/knowledge/projects/${a.projectId ?? projectId}/artifacts/${a.id}`} className="grow">
                  {a.title}
                </Link>
                <Badge tone="info">{KIND_LABEL[a.kind] ?? a.kind}</Badge>
                {a.stale && <Badge tone="warn">Newer version available</Badge>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <EvidenceDrawer
        open={Boolean(evidence)}
        onOpenChange={(o) => !o && setEvidence(null)}
        citation={evidence}
        onOpenSource={
          evidence?.anchor
            ? () => {
                onOpenCitation(evidence);
                setEvidence(null);
              }
            : undefined
        }
      />
    </div>
  );
}

function ActiveInsight({ wid, active, onRetry, onFinished, onCite, projectId }) {
  const running = active.phase === 'running';
  const live = useRunEvents(wid, active.runId, { enabled: running, onFinished });
  const artifact = useArtifact(wid, live.artifactId);
  const label = active.action.label;
  if (active.phase === 'starting') {
    return (
      <div className="ai-block" aria-busy="true">
        <span className="ai-tag">◆ {label}</span>
        <Skeleton width="80%" />
      </div>
    );
  }
  if (active.phase === 'budget') {
    return (
      <Callout tone="bad" role="alert">
        <b>Budget limit reached.</b> {label} was not sent to a model, so nothing was charged. Estimated cost {formatUsd(active.estimate)}, remaining{' '}
        {formatUsd(active.remaining)}.
      </Callout>
    );
  }
  if (active.phase === 'error') {
    return (
      <Callout tone="bad" role="alert">
        {active.message}{' '}
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
      </Callout>
    );
  }
  const failed = live.done && ['FAILED', 'CANCELLED', 'INTERRUPTED', 'BUDGET_REJECTED'].includes(live.status);
  const text = visibleText(live);
  return (
    <section className="ai-block" aria-live="polite" aria-busy={!live.done} aria-label={`${label} result`}>
      <span className="ai-tag">◆ {label}</span>
      <div className="row">
        <StatusBadge family="run" value={live.status} />
        {live.outcome && <StatusBadge family="outcome" value={live.outcome} />}
      </div>
      {failed ? (
        <Callout tone="bad">
          The action did not finish. Any reserved budget was released.{' '}
          <Button size="sm" onClick={onRetry}>
            Retry
          </Button>
        </Callout>
      ) : live.done && live.artifact ? (
        <ArtifactBody artifact={artifact.data ?? live.artifact} citations={live.citations} onCite={(m) => onCite(m, live.citations)} />
      ) : text ? (
        <ArtifactMarkdown text={text} citations={live.citations} onCite={(m) => onCite(m, live.citations)} />
      ) : (
        <Skeleton width="70%" />
      )}
      {live.done && live.outcome === 'ABSTAINED' && <p className="subtle">There was no indexed content to work from, so no model was called.</p>}
      {live.artifactId && (
        <p className="row" style={{ fontSize: 12 }}>
          <span className="subtle">Saved as an artifact.</span>
          <Link to={`/app/knowledge/projects/${artifact.data?.projectId ?? projectId}/artifacts/${live.artifactId}`}>Open artifact</Link>
        </p>
      )}
      {live.done && <InsightReceipt wid={wid} runId={active.runId} />}
    </section>
  );
}

function InsightReceipt({ wid, runId }) {
  const receipt = useReceipt(wid, runId);
  return receipt.data ? <RunReceipt receipt={receipt.data} /> : null;
}
