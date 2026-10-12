import { useMemo } from 'react';
import { Link } from 'react-router';
import { useCurrentWorkspace, useMe } from '@/features/auth/session.js';
import { formatInt, formatUsd } from '@/shared/format.js';
import { DemoBadge, StatusBadge } from '@/shared/StatusBadge.jsx';
import { Callout, Empty, Skeleton } from '@/shared/ui/index.js';
import { useCostEntries, useCostSummary, useRuns } from '../runs/queries.js';
import { TERMINAL_RUN } from '../runs/runState.js';

/**
 * Groups ledger entries per run: the preflight estimate next to the final amount and its tier.
 * @param {any[]} entries newest first
 */
export function runCostRows(entries) {
  const byRun = new Map();
  for (const e of entries) {
    if (!e.runId) continue;
    const row = byRun.get(e.runId) ?? { runId: e.runId, feature: e.feature, createdAt: e.createdAt, estimate: null, final: 0, finalTier: null, isDemo: false };
    if (e.entryType === 'ESTIMATE') row.estimate = e.amount;
    else {
      row.final += Number(e.amount);
      row.finalTier = row.finalTier === 'FINALIZED' || !row.finalTier ? e.tier : row.finalTier;
    }
    row.isDemo ||= e.isDemo;
    if (e.createdAt < row.createdAt) row.createdAt = e.createdAt;
    byRun.set(e.runId, row);
  }
  return [...byRun.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Personal cost center: month-to-date budget, daily trend, breakdowns and per-run cost states. */
export function CostsPage() {
  const workspace = useCurrentWorkspace();
  const me = useMe();
  const wid = workspace?.id;
  const summary = useCostSummary(wid, 30);
  const entries = useCostEntries(wid);
  const runs = useRuns(wid, { limit: 100 });
  const rows = useMemo(() => runCostRows(entries.data ?? []).slice(0, 20), [entries.data]);
  const statusOf = useMemo(() => new Map((runs.data ?? []).map((r) => [r.id, r.status])), [runs.data]);
  const s = summary.data;
  const budget = s?.budget;
  const limit = Number(budget?.limit ?? 0);
  const spent = Number(budget?.spent ?? 0);
  const reserved = Number(budget?.reserved ?? 0);
  const pct = (v) => (limit > 0 ? Math.min(100, (v / limit) * 100) : 0);
  const maxDay = Math.max(...(s?.daily ?? []).map((d) => Number(d.amount)), 0);

  return (
    <div className="page">
      <header className="row between" style={{ alignItems: 'flex-end', marginBottom: 20 }}>
        <div>
          <p className="eyebrow">Cost Center · {me.data?.user?.displayName ?? workspace?.name}</p>
          <h1>Your AI usage</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            Amounts come from the cost ledger. External API charges and local compute are tracked separately.
          </p>
        </div>
        {s?.isDemo && <DemoBadge />}
      </header>
      {summary.isPending ? (
        <Skeleton height={160} />
      ) : summary.error ? (
        <Callout tone="bad">Costs could not be loaded.</Callout>
      ) : (
        <div className="dash">
          <section className="card pad c-8" aria-labelledby="h-budget">
            <div className="row between">
              <h2 id="h-budget">Monthly budget</h2>
              {budget && (
                <span className="subtle">
                  {new Date(budget.periodStart).toLocaleDateString()} – {new Date(budget.periodEnd).toLocaleDateString()} · {budget.hard ? 'hard limit' : 'soft limit'}
                </span>
              )}
            </div>
            {budget ? (
              <>
                <p className="figure" style={{ marginTop: 10 }}>
                  {formatUsd(budget.spent, { min: 2 })}{' '}
                  <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>
                    finalized of {formatUsd(budget.limit, { min: 2 })}
                  </span>
                </p>
                <div className="bar" style={{ height: 10, margin: '12px 0 8px' }} role="img" aria-label={`${pct(spent).toFixed(0)}% of the budget finalized, ${pct(reserved).toFixed(0)}% reserved`}>
                  <i style={{ width: `${pct(spent)}%` }} />
                  <i style={{ width: `${pct(reserved)}%`, background: 'var(--fv-ai-line)' }} />
                </div>
                <div className="legend">
                  <span>
                    <i style={{ background: 'var(--fv-accent)' }} />
                    <StatusBadge family="cost" value="FINALIZED" /> {formatUsd(budget.spent)}
                  </span>
                  <span>
                    <i style={{ background: 'var(--fv-ai-line)' }} />
                    <StatusBadge family="cost" value="PREFLIGHT_ESTIMATE" /> reserved {formatUsd(budget.reserved)}
                  </span>
                  <span>Remaining {formatUsd(budget.remaining)}</span>
                </div>
              </>
            ) : (
              <p className="muted" style={{ marginTop: 10 }}>
                No budget is set for this workspace.
              </p>
            )}
          </section>

          <section className="card pad c-4" aria-labelledby="h-tokens">
            <h2 id="h-tokens">Last 30 days</h2>
            <p className="figure" style={{ marginTop: 10 }}>
              {formatUsd(s.total, { min: 2 })}
            </p>
            <dl className="kv" style={{ marginTop: 8 }}>
              <dt>Model calls</dt>
              <dd className="mono">{formatInt(s.tokens.calls)}</dd>
              <dt>Input tokens</dt>
              <dd className="mono">
                {formatInt(s.tokens.input)}
                {s.tokens.cachedInput ? ` (${formatInt(s.tokens.cachedInput)} cached)` : ''}
              </dd>
              <dt>Output tokens</dt>
              <dd className="mono">{formatInt(s.tokens.output)}</dd>
            </dl>
            <p className="subtle" style={{ fontSize: 11.5, marginTop: 6 }}>
              Reasoning tokens, where reported, are counted inside output and never added twice.
            </p>
          </section>

          <section className="card pad c-8" aria-labelledby="h-trend">
            <h2 id="h-trend">Daily spend</h2>
            <div className="cost-bars" role="img" aria-label={`Daily AI spend over ${s.days} days, total ${formatUsd(s.total)}`} style={{ marginTop: 12 }}>
              {s.daily.map((d) => (
                <i key={d.date} title={`${d.date}: ${formatUsd(d.amount)}`} style={{ height: `${maxDay > 0 ? (Number(d.amount) / maxDay) * 100 : 0}%` }} />
              ))}
            </div>
          </section>

          <section className="card pad c-4" aria-labelledby="h-break">
            <h2 id="h-break" className="sect-h">
              By model
            </h2>
            <Breakdown items={s.byModel} empty="No finalized model spend yet." />
            <h2 className="sect-h" style={{ marginTop: 16 }}>
              By feature
            </h2>
            <Breakdown items={s.byFeature} empty="No finalized feature spend yet." />
          </section>

          <section className="card c-12" aria-labelledby="h-runs">
            <div className="pad" style={{ paddingBottom: 0 }}>
              <h2 id="h-runs">Recent runs</h2>
            </div>
            {entries.isPending ? (
              <div className="pad">
                <Skeleton height={60} />
              </div>
            ) : rows.length === 0 ? (
              <div className="pad">
                <Empty>No AI runs yet. Costs appear here after your first question.</Empty>
              </div>
            ) : (
              <div style={{ overflow: 'auto' }}>
                <table className="table">
                  <caption className="sr">Recent AI runs with their estimated and final cost</caption>
                  <thead>
                    <tr>
                      <th scope="col">Run</th>
                      <th scope="col">Feature</th>
                      <th scope="col" className="num">
                        Preflight estimate
                      </th>
                      <th scope="col">Cost state</th>
                      <th scope="col" className="num">
                        Final
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.runId}>
                        <td className="mono">
                          <Link to={`/app/studio/runs/${r.runId}`}>{r.runId.slice(0, 8)}</Link>
                          <div className="subtle" style={{ fontSize: 11.5 }}>
                            {new Date(r.createdAt).toLocaleString()}
                          </div>
                        </td>
                        <td>{r.feature ?? '—'}</td>
                        <td className="num mono">{r.estimate != null ? `≤ ${formatUsd(r.estimate)}` : '—'}</td>
                        <td>
                          {r.finalTier ? (
                            <StatusBadge family="cost" value={r.finalTier} />
                          ) : TERMINAL_RUN.has(statusOf.get(r.runId)) ? (
                            <span className="subtle">No model call</span>
                          ) : (
                            <StatusBadge family="cost" value="PREFLIGHT_ESTIMATE" />
                          )}
                        </td>
                        <td className="num mono">
                          {r.finalTier
                            ? `${r.isDemo ? 'DEMO ' : ''}${formatUsd(r.final.toFixed(8))}`
                            : TERMINAL_RUN.has(statusOf.get(r.runId))
                              ? formatUsd('0')
                              : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function Breakdown({ items, empty }) {
  if (!items?.length) return <p className="subtle">{empty}</p>;
  const max = Math.max(...items.map((i) => Number(i.amount)), 0);
  return items.map((i, n) => (
    <div key={i.key} className="hbar">
      <span className="mono">{i.key}</span>
      <div className="bar">
        <i style={{ width: `${max > 0 ? (Number(i.amount) / max) * 100 : 0}%`, background: `var(--fv-chart-${(n % 3) + 1})` }} />
      </div>
      <span className="num mono">{formatUsd(i.amount)}</span>
    </div>
  ));
}
