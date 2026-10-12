import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useCurrentWorkspace } from '@/features/auth/session.js';
import { formatMs } from '@/shared/format.js';
import { DemoBadge, StatusBadge } from '@/shared/StatusBadge.jsx';
import { RunReceipt } from '@/shared/overlays/RunReceipt.jsx';
import { Callout, Empty, Skeleton } from '@/shared/ui/index.js';
import { useGraphSpec, useReceipt, useRuns, useTrace } from '../runs/queries.js';
import { TERMINAL_RUN } from '../runs/runState.js';
import { useRunEvents } from '../runs/useRunEvents.js';
import { layoutGraph, nodeState } from './graphLayout.js';

const STATE_TEXT = { idle: '○ idle', running: '◐ running', streaming: '◆ streaming', succeeded: '✓ done', skipped: '– skipped', failed: '✕ failed' };

/** AI Developer Studio (read-only): run explorer, workflow graph, node inspector and recorded event timeline. */
export function StudioPage() {
  const { runId } = useParams();
  const workspace = useCurrentWorkspace();
  const wid = workspace?.id;
  const runs = useRuns(wid, { limit: 50 });
  const selected = runId ?? runs.data?.[0]?.id;
  const trace = useTrace(wid, selected);
  const run = trace.data?.run;
  const active = Boolean(run && !TERMINAL_RUN.has(run.status));
  const live = useRunEvents(wid, selected, { enabled: active, onFinished: () => trace.refetch() });
  const [node, setNode] = useState(/** @type {string | null} */ (null));

  const executions = useMemo(() => {
    const out = {};
    for (const n of trace.data?.nodes ?? []) out[n.node] = n;
    for (const [k, v] of Object.entries(live.nodes)) out[k] = { ...out[k], ...v };
    return out;
  }, [trace.data, live.nodes]);
  const status = active && live.status !== 'QUEUED' ? live.status : run?.status;

  return (
    <div className="panes s-panes studio">
      <aside className="s-runs" aria-label="Run explorer">
        <div className="pad" style={{ paddingBottom: 8 }}>
          <p className="eyebrow">Runs · {workspace?.name}</p>
          <h1 style={{ fontSize: 16, marginTop: 4 }}>AI Developer Studio</h1>
        </div>
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
              <span style={{ fontSize: 12.5 }}>{r.input?.question ?? r.input?.action ?? 'Run'}</span>
              <span className="mono subtle" style={{ fontSize: 11 }}>
                {r.id.slice(0, 8)} · {new Date(r.createdAt).toLocaleString()}
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
          <span className="grow" />
          <span className="subtle" style={{ fontSize: 12 }}>
            Trace replay
          </span>
        </div>
        <p className="callout" style={{ margin: '8px 14px 0' }}>
          This view shows recorded events only. It makes no model calls and adds no cost. Re-executing a run creates a new, separately billed run.
        </p>
        <div style={{ padding: '18px 14px', overflow: 'auto' }}>
          {selected && trace.error ? <Callout tone="bad">This run could not be loaded.</Callout> : run ? <GraphView wid={wid} run={run} status={status} executions={executions} selected={node} onSelect={setNode} /> : null}
        </div>
      </section>

      <aside className="s-insp" aria-label="Node inspector">
        {run ? <Inspector wid={wid} run={run} node={node} execution={node ? executions[node] : null} status={status} /> : <div className="pad subtle">Select a run.</div>}
      </aside>

      <section className="s-tl" aria-label="Execution events">
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
