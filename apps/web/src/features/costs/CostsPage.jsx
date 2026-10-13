import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { downloadFile } from '@/api/client.js';
import { can, useCurrentWorkspace, useMe } from '@/features/auth/session.js';
import { formatDate, formatInt, formatUsd } from '@/shared/format.js';
import { DemoBadge, StatusBadge } from '@/shared/StatusBadge.jsx';
import { Button, Callout, Empty, Field, Input, Segmented, Select, Skeleton, toast } from '@/shared/ui/index.js';
import { useCostEntries, useCostSummary, useModels, useRuns } from '../runs/queries.js';
import { TERMINAL_RUN } from '../runs/runState.js';
import { SCOPE_LABEL, budgetUse, costApi, tokenMix } from './queries.js';

const RANGES = [7, 30, 90];

/**
 * Groups AI API ledger entries per run: the preflight estimate next to the settled amount and its tier.
 * Local compute is reported on its own and never counted in a run's API cost.
 * @param {any[]} entries newest first
 */
export function runCostRows(entries) {
  const byRun = new Map();
  for (const e of entries) {
    if (!e.runId || (e.costClass && e.costClass !== 'AI_API')) continue;
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

/** Personal cost center: budgets, spend trend, breakdowns, local compute, prices, estimator and per-run cost states. */
export function CostsPage() {
  const workspace = useCurrentWorkspace();
  const me = useMe();
  const wid = workspace?.id;
  const [range, setRange] = useState(30);
  const [model, setModel] = useState('');
  const summary = useCostSummary(wid, range, model || null);
  const entries = useCostEntries(wid);
  const runs = useRuns(wid, { limit: 100 });
  const models = useModels();
  const rows = useMemo(() => runCostRows(entries.data ?? []).slice(0, 20), [entries.data]);
  const statusOf = useMemo(() => new Map((runs.data ?? []).map((r) => [r.id, r.status])), [runs.data]);
  const chatModels = (models.data ?? []).filter((m) => m.provider !== 'local');
  const s = summary.data;

  const exportCsv = async () => {
    try {
      await downloadFile(`/workspaces/${wid}/costs/export.csv?days=${range}`, `folioverse-costs-${range}d.csv`);
    } catch (e) {
      toast(e.message, 'bad');
    }
  };

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
        <div className="row">
          {s?.isDemo && <DemoBadge />}
          <Button size="sm" onClick={exportCsv} disabled={!wid}>
            Export CSV
          </Button>
        </div>
      </header>
      {summary.isPending ? (
        <Skeleton height={160} />
      ) : summary.error ? (
        <Callout tone="bad">Costs could not be loaded.</Callout>
      ) : (
        <div className="dash">
          <BudgetCard summary={s} canManage={can(workspace, 'ADMIN')} />
          <LocalComputeCard local={s.localCompute} days={s.days} />

          <section className="card pad c-8" aria-labelledby="h-trend">
            <div className="row between">
              <h2 id="h-trend">Spending trend</h2>
              <div className="row">
                <Segmented label="Range" value={String(range)} onChange={(v) => setRange(Number(v))} options={RANGES.map((r) => ({ value: String(r), label: `${r}d` }))} />
                <label className="sr" htmlFor="cost-model">
                  Model filter
                </label>
                <Select id="cost-model" value={model} onChange={(e) => setModel(e.target.value)} style={{ width: 'auto' }}>
                  <option value="">All models</option>
                  {chatModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <p className="subtle" style={{ margin: '6px 0 10px' }}>
              {formatUsd(s.total, { min: 2 })} AI API spend in the last {s.days} days · {model || 'all models'}
              {s.isDemo ? ' · DEMO' : ''}
            </p>
            <DailyBars daily={s.daily} total={s.total} days={s.days} />
          </section>

          <section className="card pad c-4" aria-labelledby="h-break">
            <h2 id="h-break" className="sect-h">
              By model · {s.days}d
            </h2>
            <Breakdown items={s.byModel} empty="No settled model spend yet." />
            <h2 className="sect-h" style={{ marginTop: 18 }}>
              Tokens · {s.days}d
            </h2>
            <TokenMix tokens={s.tokens} />
          </section>

          <section className="card c-8" aria-labelledby="h-runs">
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

          <section className="card pad c-4" aria-labelledby="h-proj">
            <h2 id="h-proj" className="sect-h">
              By project · {s.days}d
            </h2>
            <Breakdown items={s.byProject} empty="No project spend yet." wide />
            <h2 className="sect-h" style={{ marginTop: 18 }}>
              By feature
            </h2>
            <Breakdown items={s.byFeature} empty="No settled feature spend yet." />
            {s.byUser && (
              <>
                <h2 className="sect-h" style={{ marginTop: 18 }}>
                  By member
                </h2>
                <Breakdown items={s.byUser} empty="No member spend yet." wide />
              </>
            )}
          </section>

          {s.anomalies?.length > 0 && <AnomaliesCard anomalies={s.anomalies} />}

          <PricesCard models={models.data} pending={models.isPending} />
          <Estimator wid={wid} models={chatModels} />
        </div>
      )}
    </div>
  );
}

function BudgetCard({ summary: s, canManage }) {
  const budget = s.budget;
  const use = budgetUse(budget);
  const others = (s.budgets ?? []).filter((b) => b.scope !== 'WORKSPACE');
  const thresholds = (s.budgets ?? []).find((b) => b.scope === 'WORKSPACE')?.alertThresholds ?? [75, 90, 100];
  return (
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
          <div className="bar" style={{ height: 10, margin: '12px 0 8px' }} role="img" aria-label={`${use.spent.toFixed(0)}% of the budget finalized, ${use.reserved.toFixed(0)}% reserved`}>
            <i style={{ width: `${use.spent}%` }} />
            <i style={{ width: `${use.reserved}%`, background: 'var(--fv-ai-line)' }} />
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
      {others.length > 0 && (
        <ul className="list" style={{ marginTop: 14 }} aria-label="Other budgets that apply to you">
          {others.map((b) => {
            const u = budgetUse(b.current);
            return (
              <li key={b.id} className="li" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 140px auto', gap: 10, alignItems: 'center' }}>
                <span>
                  <span className="badge">{SCOPE_LABEL[b.scope]}</span> {b.label}
                  <span className="subtle"> · {b.period === 'DAILY' ? 'daily' : 'monthly'}, {b.hard ? 'hard' : 'soft'}</span>
                </span>
                <div className="bar" role="img" aria-label={`${b.label}: ${u.spent.toFixed(0)}% used`}>
                  <i style={{ width: `${u.spent}%` }} />
                  <i style={{ width: `${u.reserved}%`, background: 'var(--fv-ai-line)' }} />
                </div>
                <span className="num mono">
                  {formatUsd(b.current.spent, { min: 2 })} / {formatUsd(b.current.limit, { min: 2 })}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="subtle" style={{ fontSize: 12, marginTop: 10 }}>
        Alerts go out at {thresholds.join('%, ')}% of the workspace budget.{' '}
        {canManage ? <Link to="/app/settings/budgets">Manage budgets</Link> : 'Workspace admins manage budgets.'}
      </p>
    </section>
  );
}

function LocalComputeCard({ local, days }) {
  const hours = (local?.seconds ?? 0) / 3600;
  return (
    <section className="card pad c-4" aria-labelledby="h-local">
      <h2 id="h-local">Local compute</h2>
      <p className="figure" style={{ marginTop: 10 }}>
        {formatUsd(local?.amount ?? '0', { min: 2 })}{' '}
        <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>
          estimated, not billed
        </span>
      </p>
      <p className="muted" style={{ marginTop: 6 }}>
        Embeddings and reranking ran on FolioVerse’s own CPUs: {hours < 0.1 ? `${formatInt(Math.round(local?.seconds ?? 0))} CPU-seconds` : `about ${hours.toFixed(1)} CPU-hours`} in the last {days}{' '}
        days. This is never counted as API spend or against budgets.
      </p>
      {local && !local.priced && (local.seconds ?? 0) > 0 && (
        <p className="subtle" style={{ fontSize: 12, marginTop: 6 }}>
          No CPU-hour rate has been entered yet, so the amount shows as $0 (<StatusBadge family="cost" value="FINAL_ESTIMATED" />).
        </p>
      )}
    </section>
  );
}

function DailyBars({ daily, total, days }) {
  const max = Math.max(...daily.map((d) => Number(d.amount)), 0);
  return (
    <div className="cost-bars" role="img" aria-label={`Daily AI spend over ${days} days, total ${formatUsd(total)}`}>
      {daily.map((d) => (
        <i key={d.date} title={`${d.date}: ${formatUsd(d.amount)}`} style={{ height: `${max > 0 ? (Number(d.amount) / max) * 100 : 0}%` }} />
      ))}
    </div>
  );
}

function TokenMix({ tokens }) {
  const mix = tokenMix(tokens);
  if (!mix) return <p className="subtle">No model calls in this range.</p>;
  return (
    <>
      <div className="bar" style={{ height: 12 }} role="img" aria-label={`Token mix: ${mix.uncached}% uncached input, ${mix.cached}% cached input, ${mix.output}% output`}>
        <i style={{ width: `${mix.uncached}%`, background: 'var(--fv-chart-1)' }} />
        <i style={{ width: `${mix.cached}%`, background: 'var(--fv-chart-2)' }} />
        <i style={{ width: `${mix.output}%`, background: 'var(--fv-chart-3)' }} />
      </div>
      <div className="legend" style={{ marginTop: 8 }}>
        <span>
          <i style={{ background: 'var(--fv-chart-1)' }} />
          Input {formatInt(mix.counts[0])}
        </span>
        <span>
          <i style={{ background: 'var(--fv-chart-2)' }} />
          Cached {formatInt(mix.counts[1])}
        </span>
        <span>
          <i style={{ background: 'var(--fv-chart-3)' }} />
          Output {formatInt(mix.counts[2])}
        </span>
      </div>
      <p className="subtle" style={{ fontSize: 11.5, marginTop: 6 }}>
        {formatInt(tokens.calls)} model calls. Reasoning tokens, where reported, are counted inside output and never added twice.
      </p>
    </>
  );
}

function AnomaliesCard({ anomalies }) {
  return (
    <section className="card pad c-12" aria-labelledby="h-anom">
      <h2 id="h-anom" className="sect-h">
        Unusual spend
      </h2>
      <ul className="list" style={{ fontSize: 13 }}>
        {anomalies.map((a) => (
          <li key={a.id} className="li">
            <span className="badge" data-tone="bad">
              z {a.zScore.toFixed(1)}
            </span>
            <span>
              {a.dimension === 'total' ? 'AI spend' : `AI spend on ${a.key}`} on {formatDate(a.day)}: {formatUsd(a.amount, { min: 2 })} against a 14-day average of{' '}
              {formatUsd(Number(a.baselineMean).toFixed(8), { min: 2 })}
              {a.isDemo ? ' · DEMO' : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PricesCard({ models, pending }) {
  const anyDemo = (models ?? []).some((m) => m.price?.isDemo);
  return (
    <section className="card c-7" aria-labelledby="h-prices">
      <div className="pad" style={{ paddingBottom: 0 }}>
        <h2 id="h-prices">Model prices</h2>
        {anyDemo && (
          <div style={{ marginTop: 8 }}>
            <Callout tone="warn">
              DEMO rates are illustrative, not real provider prices. Real prices are entered by a platform admin with a source link and an effective date.
            </Callout>
          </div>
        )}
      </div>
      {pending ? (
        <div className="pad">
          <Skeleton height={60} />
        </div>
      ) : (
        <div style={{ overflow: 'auto' }}>
          <table className="table">
            <caption className="sr">Current price per model configuration</caption>
            <thead>
              <tr>
                <th scope="col">Model config</th>
                <th scope="col" className="num">
                  Input
                </th>
                <th scope="col" className="num">
                  Cached
                </th>
                <th scope="col" className="num">
                  Output
                </th>
                <th scope="col">Effective</th>
              </tr>
            </thead>
            <tbody>
              {(models ?? []).map((m) => (
                <tr key={m.id}>
                  <td className="mono">{m.id}</td>
                  {!m.price ? (
                    <td colSpan={3} className="subtle">
                      No price yet: usage is recorded at $0 as FINAL_ESTIMATED
                    </td>
                  ) : m.price.unit === 'CPU_HOUR' ? (
                    <td colSpan={3} className="num mono">
                      {formatUsd(m.price.inputPerMTok, { min: 2 })} per CPU-hour · local compute
                    </td>
                  ) : (
                    <>
                      <td className="num mono">{formatUsd(m.price.inputPerMTok, { min: 2 })}</td>
                      <td className="num mono">{m.price.cachedInputPerMTok ? formatUsd(m.price.cachedInputPerMTok, { min: 2 }) : '—'}</td>
                      <td className="num mono">{formatUsd(m.price.outputPerMTok, { min: 2 })}</td>
                    </>
                  )}
                  <td className="subtle">
                    {m.price ? (
                      <>
                        {m.price.effectiveFrom ? formatDate(m.price.effectiveFrom) : '—'}
                        {m.price.isDemo ? ' · DEMO' : ''}
                        {m.price.sourceUrl?.startsWith('https://') && (
                          <>
                            {' · '}
                            <a href={m.price.sourceUrl} target="_blank" rel="noreferrer">
                              source
                            </a>
                          </>
                        )}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="subtle pad" style={{ fontSize: 11.5, paddingTop: 6 }}>
            Rates in USD per 1M tokens unless marked otherwise.
          </p>
        </div>
      )}
    </section>
  );
}

const int = (v) => Math.max(0, Math.floor(Number(v) || 0));

function Estimator({ wid, models }) {
  const [form, setForm] = useState({ model: '', calls: '10', input: '6000', cached: '1500', output: '500' });
  const modelId = form.model || models.find((m) => m.isDefault)?.id || models[0]?.id || '';
  const other = models.find((m) => m.id !== modelId && m.price);
  const body = (id) => ({ modelConfigId: id, calls: Math.max(1, int(form.calls)), inputTokens: int(form.input), cachedInputTokens: Math.min(int(form.cached), int(form.input)), outputTokens: int(form.output) });
  const est = useQuery({ queryKey: ['estimate', wid, body(modelId)], queryFn: () => costApi.estimate(wid, body(modelId)), enabled: Boolean(wid && modelId) });
  const alt = useQuery({ queryKey: ['estimate', wid, other ? body(other.id) : null], queryFn: () => costApi.estimate(wid, body(other.id)), enabled: Boolean(wid && other) });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const e = est.data;
  const delta = e && alt.data && Number(e.total) > 0 ? Math.round(((Number(alt.data.total) - Number(e.total)) / Number(e.total)) * 100) : null;
  return (
    <section className="card pad c-5" aria-labelledby="h-est">
      <h2 id="h-est">Cost estimator</h2>
      <div className="form" style={{ marginTop: 12, gridTemplateColumns: '1fr 1fr' }}>
        <Field label="Model">
          <Select value={modelId} onChange={set('model')}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Calls">
          <Input type="number" min={1} value={form.calls} onChange={set('calls')} />
        </Field>
        <Field label="Input tokens per call">
          <Input type="number" min={0} value={form.input} onChange={set('input')} />
        </Field>
        <Field label="…of which cached">
          <Input type="number" min={0} value={form.cached} onChange={set('cached')} />
        </Field>
        <Field label="Output tokens per call">
          <Input type="number" min={0} value={form.output} onChange={set('output')} />
        </Field>
      </div>
      <div style={{ marginTop: 14 }} aria-live="polite">
        {!e ? (
          <Skeleton height={28} />
        ) : e.status === 'PRICE_MISSING' ? (
          <Callout tone="warn">This model has no price yet, so its usage would be recorded at $0 as an estimate.</Callout>
        ) : (
          <>
            <p className="row">
              <StatusBadge family="cost" value="PREFLIGHT_ESTIMATE" />
              <span className="figure" style={{ fontSize: 22 }}>
                {formatUsd(e.total)}
              </span>
              {e.price?.isDemo && <span className="subtle">DEMO</span>}
            </p>
            <p className="mono subtle" style={{ fontSize: 11.5, marginTop: 6 }}>
              {formatUsd(e.perCall)} per call × {formatInt(e.calls)} calls
            </p>
            {other && alt.data?.status === 'PRICED' && (
              <p style={{ fontSize: 12.5, marginTop: 8 }}>
                With <span className="mono">{other.id}</span> instead: {formatUsd(alt.data.total)}
                {delta != null ? ` (${delta > 0 ? '+' : ''}${delta}%)` : ''}.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function Breakdown({ items, empty, wide = false }) {
  if (!items?.length) return <p className="subtle">{empty}</p>;
  const max = Math.max(...items.map((i) => Number(i.amount)), 0);
  return items.map((i, n) => (
    <div key={i.key} className="hbar" style={wide ? { gridTemplateColumns: '130px 1fr 70px' } : undefined}>
      <span className={wide ? undefined : 'mono'}>{i.key}</span>
      <div className="bar">
        <i style={{ width: `${max > 0 ? (Number(i.amount) / max) * 100 : 0}%`, background: `var(--fv-chart-${(n % 3) + 1})` }} />
      </div>
      <span className="num mono">{formatUsd(i.amount)}</span>
    </div>
  ));
}
