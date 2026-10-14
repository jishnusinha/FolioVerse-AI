import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router';
import { can, useCurrentWorkspace } from '@/features/auth/session.js';
import { formatMs } from '@/shared/format.js';
import { Badge, DemoBadge, StatusBadge } from '@/shared/StatusBadge.jsx';
import { RunReceipt } from '@/shared/overlays/RunReceipt.jsx';
import { Button, Callout, Empty, Skeleton, Tabs } from '@/shared/ui/index.js';
import { useGraphSpec, useReceipt, useRuns, useTrace } from '../runs/queries.js';
import { TERMINAL_RUN } from '../runs/runState.js';
import { useRunEvents } from '../runs/useRunEvents.js';
import { layoutGraph, nodeState } from './graphLayout.js';
import { ForkDialog, StudioNav, TimeMachine, TutorPanel, XRay } from './parts.jsx';
import { nodeEventCount, replayFrame } from './queries.js';

const STATE_TEXT = { idle: '○ idle', running: '◐ running', streaming: '◆ streaming', succeeded: '✓ done', skipped: '– skipped', failed: '✕ failed' };
const REPLAY_STEP_MS = 450;

/** AI Developer Studio run explorer: workflow graph, time machine, RAG X-Ray, tutor, node inspector and recorded event timeline. */
export function StudioPage() {
  const [params] = useSearchParams();
  const { runId } = useParams();
  if (!runId && params.get('view') === 'evaluations') return <Navigate to="/app/studio/evaluations" replace />;
  return <RunsView runId={runId} />;
}

/** Steps through recorded node events on a timer. Nothing is re-executed. */
function useReplay(events) {
  const total = nodeEventCount(events);
  const [count, setCount] = useState(/** @type {number | null} */ (null));
  useEffect(() => {
    if (count == null) return undefined;
    if (count >= total) {
      const done = setTimeout(() => setCount(null), REPLAY_STEP_MS * 2);
      return () => clearTimeout(done);
    }
    const t = setTimeout(() => setCount((c) => (c == null ? null : c + 1)), REPLAY_STEP_MS);
    return () => clearTimeout(t);
  }, [count, total]);
  return {
    playing: count != null,
    count,
    total,
    start: () => setCount(0),
    stop: () => setCount(null),
  };
}

function RunsView({ runId }) {
  const workspace = useCurrentWorkspace();
  const wid = workspace?.id;
  const runs = useRuns(wid, { limit: 50 });
  const selected = runId ?? runs.data?.[0]?.id;
  const trace = useTrace(wid, selected);
  const run = trace.data?.run;
  const active = Boolean(run && !TERMINAL_RUN.has(run.status));
  const live = useRunEvents(wid, selected, { enabled: active, onFinished: () => trace.refetch() });
  const receipt = useReceipt(wid, run?.id, Boolean(run) && !active);
  const [node, setNode] = useState(/** @type {string | null} */ (null));
  const [fork, setFork] = useState(/** @type {{ checkpoint: any } | null} */ (null));
  const recorded = useMemo(() => trace.data?.events ?? [], [trace.data]);
  const replay = useReplay(recorded);

  const executions = useMemo(() => {
    if (replay.playing) return replayFrame(recorded, replay.count ?? 0);
    const out = {};
    for (const n of trace.data?.nodes ?? []) out[n.node] = n;
    for (const [k, v] of Object.entries(live.nodes)) out[k] = { ...out[k], ...v };
    return out;
  }, [trace.data, live.nodes, replay.playing, replay.count, recorded]);
  const status = replay.playing ? 'RUNNING' : active && live.status !== 'QUEUED' ? live.status : run?.status;
  const retrieval = trace.data?.retrieval?.[0] ?? null;

  return (
    <div className="panes s-panes studio">
      <aside className="s-runs" aria-label="Run explorer">
        <div className="pad" style={{ paddingBottom: 8 }}>
          <p className="eyebrow">Runs · {workspace?.name}</p>
          <h1 style={{ fontSize: 16, marginTop: 4 }}>AI Developer Studio</h1>
        </div>
        <StudioNav view="runs" compact />
        {runs.isPending ? (
          <div className="pad">
            <Skeleton height={48} />
          </div>
        ) : !runs.data?.length ? (
          <div className="pad">
            <Empty>No runs yet. Ask a question about a document and its trace appears here.</Empty>
          </div>
        ) : (
          runs.data.map((r) => (
            <Link key={r.id} className="runrow" to={`/app/studio/runs/${r.id}`} aria-current={r.id === selected ? 'true' : undefined} onClick={() => setNode(null)}>
              <span className="row between" style={{ width: '100%' }}>
                <span className="mono">{r.graph}</span>
                <StatusBadge family="run" value={r.status} />
              </span>
              <span style={{ fontSize: 12.5 }}>{r.input?.question ?? r.input?.action ?? r.input?.text ?? 'Run'}</span>
              <span className="mono subtle" style={{ fontSize: 11 }}>
                {r.id.slice(0, 8)} · {new Date(r.createdAt).toLocaleString()}
                {r.lab ? ' · LAB' : ''}
                {r.parentRunId ? ' · fork' : ''}
                {r.isDemo ? ' · DEMO' : ''}
              </span>
            </Link>
          ))
        )}
      </aside>

      <section className="s-canvas" aria-label="Workflow graph">
        <div className="bar-top" style={{ background: 'transparent' }}>
          <b>{run?.graph ?? 'No run selected'}</b>
          {status && <StatusBadge family="run" value={status} />}
          {run?.outcome && <StatusBadge family="outcome" value={run.outcome} />}
          {run?.isDemo && <DemoBadge />}
          {run?.lab && <Badge tone="ai">LAB</Badge>}
          <span className="grow" />
          {run?.parentRunId && (
            <Link className="btn sm ghost" to={`/app/studio/compare?runs=${run.parentRunId},${run.id}`}>
              Compare with parent
            </Link>
          )}
          {run && (
            <Button size="sm" onClick={replay.playing ? replay.stop : replay.start} disabled={active || !replay.total} aria-pressed={replay.playing}>
              {replay.playing ? `Replaying ${replay.count}/${replay.total}` : 'Replay (free)'}
            </Button>
          )}
          {run && (
            <Button size="sm" variant="primary" onClick={() => setFork({ checkpoint: null })} disabled={active || !can(workspace, 'EDITOR')}>
              Fork…
            </Button>
          )}
        </div>
        <p className="callout" style={{ margin: '8px 14px 0' }}>
          Replay steps through recorded events only. It makes no model calls and adds no cost. Forking re-executes the run as a new lab run that is billed separately.
        </p>
        <div style={{ padding: '10px 14px 18px', overflow: 'auto' }}>
          {selected && trace.error ? (
            <Callout tone="bad">This run could not be loaded.</Callout>
          ) : run ? (
            <Tabs
              key={run.id}
              label="Run views"
              tabs={[
                { value: 'graph', label: 'Graph', content: <GraphView wid={wid} run={run} status={status} executions={executions} selected={node} onSelect={setNode} /> },
                { value: 'time', label: 'Time machine', content: <TimeMachine wid={wid} run={run} onFork={(checkpoint) => setFork({ checkpoint })} /> },
                { value: 'xray', label: 'RAG X-Ray', content: <XRay retrieval={retrieval} /> },
                { value: 'tutor', label: 'Tutor', content: <TutorPanel run={run} receipt={receipt.data} /> },
              ]}
            />
          ) : null}
        </div>
        {run && fork && <ForkDialog wid={wid} run={run} checkpoint={fork.checkpoint} open onOpenChange={(o) => !o && setFork(null)} />}
      </section>

      <aside className="s-insp" aria-label="Node inspector">
        {run ? <Inspector wid={wid} run={run} node={node} execution={node ? executions[node] : null} status={status} /> : <div className="pad subtle">Select a run.</div>}
      </aside>

      <section className="s-tl" aria-label="Execution events" tabIndex={0}>
        <div className="row between" style={{ padding: '8px 14px 0' }}>
          <b style={{ fontSize: 13 }}>Event timeline</b>
          <span className="subtle mono" style={{ fontSize: 11 }}>
            recorded milestones · token deltas are not stored
          </span>
        </div>
        <Timeline events={active ? [...(trace.data?.events ?? []), ...live.events] : trace.data?.events ?? []} />
      </section>
    </div>
  );
}

function GraphView({ wid, run, status, executions, selected, onSelect }) {
  const spec = useGraphSpec(wid, run.graph);
  const layout = useMemo(() => (spec.data ? layoutGraph(spec.data) : null), [spec.data]);
  if (spec.isPending) return <Skeleton height={160} />;
  if (spec.error || !layout) return <Callout>The workflow structure is unavailable because the AI service is not reachable. Recorded events are still shown below.</Callout>;
  return (
    <svg viewBox={`0 0 ${layout.width} ${layout.height}`} style={{ width: '100%', minWidth: 640, height: 'auto' }} role="group" aria-label={`LangGraph workflow ${run.graph}`}>
      {layout.edges.map((e) => {
        const done = nodeState(e.source, executions, status) === 'succeeded' && nodeState(e.target, executions, status) === 'succeeded';
        return <path key={`${e.source}-${e.target}`} className={`gedge${done ? ' done' : ''}${e.conditional ? ' cond' : ''}`} d={e.d} />;
      })}
      {layout.nodes.map((n) => {
        const s = nodeState(n.id, executions, status);
        const label = n.kind === 'terminal' ? n.id.replace(/_/g, '') : n.label;
        const ex = executions[n.id];
        return (
          <g
            key={n.id}
            className="gnode"
            data-s={s}
            role="button"
            tabIndex={0}
            aria-pressed={selected === n.id}
            aria-label={`${label}: ${s}`}
            onClick={() => onSelect(n.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(n.id);
              }
            }}
          >
            <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={9} />
            <text x={n.x + 10} y={n.y + 20}>
              {label}
            </text>
            <text className="gs" x={n.x + 10} y={n.y + 36}>
              {STATE_TEXT[s]}
              {ex?.durationMs != null ? ` · ${formatMs(ex.durationMs)}` : ''}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Inspector({ wid, run, node, execution, status }) {
  const receipt = useReceipt(wid, run.id, TERMINAL_RUN.has(status ?? ''));
  if (!node) {
    return (
      <div className="pad stack" style={{ gap: 12 }}>
        <p className="eyebrow">Run</p>
        <h2 className="mono" style={{ fontSize: 13, overflowWrap: 'anywhere' }}>
          {run.id}
        </h2>
        <div className="row">
          <StatusBadge family="run" value={status} />
          <span className="mono subtle">
            {run.graph} · {run.tier}
          </span>
        </div>
        {run.input?.question && (
          <section>
            <p className="eyebrow">Question</p>
            <p>{run.input.question}</p>
          </section>
        )}
        {run.error && <Callout tone="bad">{run.error.message ?? 'The run failed.'}</Callout>}
        {receipt.data && <RunReceipt receipt={receipt.data} defaultOpen />}
        <p className="subtle" style={{ fontSize: 12 }}>
          Select a node in the graph to inspect it.
        </p>
      </div>
    );
  }
  return (
    <div className="pad stack" style={{ gap: 12 }}>
      <p className="eyebrow">Node inspector</p>
      <h2 style={{ fontSize: 16 }}>{node}</h2>
      {execution ? (
        <>
          <div className="row">
            <StatusBadge family="run" value={execution.status === 'RUNNING' ? 'RUNNING' : execution.status === 'FAILED' ? 'FAILED' : 'SUCCEEDED'} />
            <span className="mono subtle">step {execution.step}</span>
          </div>
          <dl className="kv">
            <dt>Duration</dt>
            <dd className="mono">{formatMs(execution.durationMs)}</dd>
            <dt>Started</dt>
            <dd className="mono">{execution.startedAt ? new Date(execution.startedAt).toLocaleTimeString() : '—'}</dd>
          </dl>
          <div>
            <p className="eyebrow">Output (redacted summary)</p>
            <pre className="code">{execution.summary ? JSON.stringify(execution.summary, null, 2) : 'No summary recorded.'}</pre>
          </div>
        </>
      ) : (
        <p className="subtle">This node did not run in this execution.</p>
      )}
      <p className="subtle" style={{ fontSize: 11.5 }}>
        Summaries are redacted by design. Model reasoning is not captured or shown.
      </p>
    </div>
  );
}

function describe(e) {
  const d = e.data ?? {};
  if (e.type === 'run.state') return d.status;
  if (e.type.startsWith('node.')) return `${d.node}${d.status ? ` · ${d.status}` : ''}${d.durationMs != null ? ` · ${formatMs(d.durationMs)}` : ''}`;
  if (e.type === 'retrieval.completed') return `${d.candidates ?? d.candidateCount ?? '?'} candidates · ${d.packed ?? d.packedCount ?? '?'} packed`;
  if (e.type === 'citation.validated') return `${d.marker} · ${d.state}`;
  if (e.type === 'usage.recorded') return `${d.provider ?? ''} ${d.model ?? ''}`.trim();
  if (e.type === 'run.finished') return `outcome=${d.outcome ?? '—'}`;
  if (e.type === 'run.failed') return d.message ?? d.errorClass;
  return '';
}

function Timeline({ events }) {
  if (!events.length) {
    return (
      <ol className="events">
        <li>
          <span />
          <span className="subtle">No recorded events.</span>
          <span />
        </li>
      </ol>
    );
  }
  const t0 = new Date(events[0].ts).getTime();
  return (
    <ol className="events">
      {events.map((e, i) => (
        <li key={`${e.seq ?? i}-${e.type}`}>
          <span className="subtle">+{((new Date(e.ts).getTime() - t0) / 1000).toFixed(2)}s</span>
          <span>{e.type}</span>
          <span className="subtle">{describe(e)}</span>
        </li>
      ))}
    </ol>
  );
}
