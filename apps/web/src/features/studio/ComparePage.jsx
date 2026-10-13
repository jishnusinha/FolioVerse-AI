import { Link, useSearchParams } from 'react-router';
import { useCurrentWorkspace } from '@/features/auth/session.js';
import { formatInt, formatMs, formatUsd } from '@/shared/format.js';
import { Badge, Callout, DemoBadge, Empty, Skeleton, StatusBadge } from '@/shared/ui/index.js';
import { CitedText } from '../runs/CitedText.jsx';
import { useRuns } from '../runs/queries.js';
import { StudioFrame } from './parts.jsx';
import { useCompare } from './queries.js';

const MAX = 4;

/** Side-by-side comparison of two to four recorded runs (no re-execution). */
export function ComparePage() {
  const ws = useCurrentWorkspace();
  const wid = ws?.id;
  const [params, setParams] = useSearchParams();
  const ids = (params.get('runs') ?? '').split(',').filter(Boolean).slice(0, MAX);
  const runs = useRuns(wid, { limit: 50 });
  const cmp = useCompare(wid, ids);
  const toggle = (id) => {
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id].slice(-MAX);
    setParams(next.length ? { runs: next.join(',') } : {}, { replace: true });
  };
  return (
    <StudioFrame
      view="compare"
      eyebrow={`Compare · ${ws?.name ?? ''}`}
      title="Compare runs"
      intro="Pick two to four runs to see their answers, models, citations, retrieved passages and costs side by side. Comparing reads recorded runs only and costs nothing."
    >
      <div className="dash">
        <section className="card pad c-4" aria-labelledby="cmp-pick">
          <h2 className="sect-h" id="cmp-pick">
            Runs ({ids.length}/{MAX})
          </h2>
          {runs.isPending ? (
            <Skeleton height={80} />
          ) : !runs.data?.length ? (
            <Empty>No runs yet.</Empty>
          ) : (
            <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0, gap: 6 }}>
              {runs.data.map((r) => (
                <li key={r.id}>
                  <label className="row" style={{ gap: 8, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                    <input type="checkbox" checked={ids.includes(r.id)} onChange={() => toggle(r.id)} aria-label={`Compare run ${r.id.slice(0, 8)}`} />
                    <span className="stack" style={{ gap: 2 }}>
                      <span style={{ fontSize: 13 }}>{r.input?.question ?? r.input?.action ?? r.graph}</span>
                      <span className="mono subtle" style={{ fontSize: 11 }}>
                        {r.graph} · {r.id.slice(0, 8)}
                        {r.lab ? ' · LAB' : ''}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="c-8" aria-label="Comparison">
          {ids.length < 2 ? (
            <Empty>Select at least two runs.</Empty>
          ) : cmp.isPending ? (
            <Skeleton height={240} />
          ) : cmp.error ? (
            <Callout tone="bad">{cmp.error.message}</Callout>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cmp.data.runs.length}, minmax(0, 1fr))`, gap: 12 }}>
              {cmp.data.runs.map((s) => (
                <RunColumn key={s.run.id} s={s} />
              ))}
            </div>
          )}
        </section>
      </div>
    </StudioFrame>
  );
}

function RunColumn({ s }) {
  const used = s.model.used ?? s.model.planned;
  return (
    <article className="card pad stack" style={{ gap: 10 }} aria-label={`Run ${s.run.id}`}>
      <div className="row">
        <StatusBadge family="run" value={s.run.status} />
        {s.run.outcome && <StatusBadge family="outcome" value={s.run.outcome} />}
        {s.run.lab && <Badge tone="ai">LAB</Badge>}
        {s.run.isDemo && <DemoBadge />}
      </div>
      <Link to={`/app/studio/runs/${s.run.id}`} className="mono" style={{ fontSize: 12 }}>
        {s.run.id.slice(0, 8)} · {s.run.graph}
      </Link>
      <dl className="kv">
        <dt>Model</dt>
        <dd className="mono">{used?.model ?? used?.modelConfigId ?? '—'}</dd>
        <dt>Attempts</dt>
        <dd className="mono">{s.model.attempts}</dd>
        <dt>Cost</dt>
        <dd className="mono">
          {formatUsd(s.cost.total)} <span className="subtle">{s.cost.tier}</span>
        </dd>
        <dt>Tokens</dt>
        <dd className="mono">
          {formatInt(s.tokens.input)} in · {formatInt(s.tokens.output)} out
        </dd>
        <dt>Duration</dt>
        <dd className="mono">{formatMs(s.durationMs)}</dd>
        {s.retrieval && (
          <>
            <dt>Retrieval</dt>
            <dd className="mono">
              {s.retrieval.candidates} cand. · {s.retrieval.packed.length} packed · {s.retrieval.params?.fusion ?? s.retrieval.params?.mode ?? 'rrf'}
            </dd>
          </>
        )}
      </dl>
      <div>
        <p className="eyebrow">Answer</p>
        {s.answer ? <CitedText text={s.answer} citations={Object.fromEntries(s.citations.map((c) => [c.marker, c]))} /> : <p className="subtle">No answer.</p>}
      </div>
      {s.retrieval?.packed?.length > 0 && (
        <p className="subtle mono" style={{ fontSize: 11.5 }}>
          {s.retrieval.packed.map((p) => `[${p.marker}] p.${p.page ?? '?'} ${p.level ?? ''} ${p.tokens ?? '?'}tok`).join(' · ')}
        </p>
      )}
    </article>
  );
}
