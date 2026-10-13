import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDate, formatInt, formatMs, formatUsd } from '@/shared/format.js';
import { Button, Callout, DemoBadge, Empty, Field, Input, Segmented, Select, Skeleton, StatusBadge, Textarea, toast } from '@/shared/ui/index.js';
import { AdminFrame } from './parts.jsx';
import { adminApi, adminKeys, importSummary, useAdminModels, useAdminOverview, useInfra, useIsSuperAdmin, useReconciliation } from './queries.js';

const RANGES = [7, 30, 90];
const SERIES = [
  ['aiApi', 'AI API', 'var(--fv-chart-1)'],
  ['cloudInfra', 'Cloud infra', 'var(--fv-chart-2)'],
  ['localCompute', 'Local (est.)', 'var(--fv-chart-3)'],
];

/** Platform-wide spend for super admins: classes, models, people, workflows, reconciliation and cloud costs. */
export function AdminCostsPage() {
  const admin = useIsSuperAdmin();
  const qc = useQueryClient();
  const [range, setRange] = useState(30);
  const [model, setModel] = useState('');
  const overview = useAdminOverview(range, model || null, admin);
  const models = useAdminModels(admin);
  const [busy, setBusy] = useState(false);
  const o = overview.data;

  const recompute = async () => {
    setBusy(true);
    try {
      const r = await adminApi.rollup(Math.min(range + 1, 365));
      toast(`Rollups recomputed (${formatInt(r.rows)} rows)${r.anomalies ? `, ${r.anomalies} new anomalies` : ''}`, 'ok');
      qc.invalidateQueries({ queryKey: adminKeys.all });
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminFrame
      title="Cost Command Center"
      intro="Platform-wide spend from hourly and daily ledger rollups. Amounts, models and names only: no run inputs or document content are shown here."
      actions={
        <>
          {o?.isDemo && <DemoBadge />}
          <Segmented label="Range" value={String(range)} onChange={(v) => setRange(Number(v))} options={RANGES.map((r) => ({ value: String(r), label: `${r}d` }))} />
          <label className="sr" htmlFor="admin-model">
            Model filter
          </label>
          <Select id="admin-model" value={model} onChange={(e) => setModel(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All models</option>
            {(models.data ?? [])
              .filter((m) => m.provider !== 'local')
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                </option>
              ))}
          </Select>
          <Button size="sm" onClick={recompute} disabled={busy}>
            Recompute rollups
          </Button>
        </>
      }
    >
      {overview.isPending ? (
        <Skeleton height={200} />
      ) : overview.error ? (
        <Callout tone="bad">The overview could not be loaded.</Callout>
      ) : (
        <>
          <p className="subtle" style={{ marginBottom: 10 }}>
            {o.rolledUpAt ? `Rollups updated ${new Date(o.rolledUpAt).toLocaleString()}; the worker refreshes them every 10 minutes.` : 'No rollups yet: recompute them or wait for the worker.'}
          </p>
          <div className="strip" style={{ marginBottom: 18 }}>
            {[
              ['Platform total', formatUsd(o.totals.platform, { min: 2, max: 2 }), 'AI API + cloud + local estimate'],
              ['AI API · settled', formatUsd(o.totals.aiApi, { min: 2, max: 2 }), model ? model : 'Provider-reported usage'],
              ['Running estimates', `≤ ${formatUsd(o.totals.running.amount, { min: 2, max: 2 })}`, `${o.totals.running.runs} open reservations`],
              ['Cloud infra', formatUsd(o.totals.cloudInfra, { min: 2, max: 2 }), 'Billing export or manual entry'],
              ['Local compute', formatUsd(o.totals.localCompute, { min: 2, max: 2 }), 'Estimated, not billed'],
              [
                'Reconciliation',
                `${Number(o.totals.reconciliation.variance) > 0 ? '+' : ''}${formatUsd(o.totals.reconciliation.variance, { min: 2, max: 4 })}`,
                `Variance on ${o.totals.reconciliation.varianceDays} days · ${o.totals.reconciliation.reconciledDays} reconciled`,
              ],
            ].map(([label, value, sub]) => (
              <div key={label}>
                <p className="eyebrow">{label}</p>
                <p className="figure">{value}</p>
                <p className="subtle" style={{ fontSize: 11.5 }}>
                  {sub}
                </p>
              </div>
            ))}
          </div>

          <div className="dash">
            <section className="card pad c-8" aria-labelledby="h-daily">
              <div className="row between">
                <h2 id="h-daily">Daily spend by class</h2>
                <div className="legend">
                  {SERIES.map(([, label, color]) => (
                    <span key={label}>
                      <i style={{ background: color }} />
                      {label}
                    </span>
                  ))}
                </div>
              </div>
              <DailyChart daily={o.daily} days={o.days} />
            </section>

            <section className="card pad c-4" aria-labelledby="h-bymodel">
              <h2 id="h-bymodel" className="sect-h">
                AI API by model
              </h2>
              <Bars items={o.byModel.map((m) => ({ key: m.key, amount: m.amount }))} empty="No model spend in this range." mono />
              <h2 className="sect-h" style={{ marginTop: 18 }}>
                Budget alerts
              </h2>
              {!o.budgetAlerts.length && !o.rejected.length ? (
                <p className="subtle">No budget has crossed an alert threshold this period.</p>
              ) : (
                <ul className="list" style={{ fontSize: 13 }}>
                  {o.budgetAlerts.map((a, i) => (
                    <li key={`${a.workspaceId}-${a.label}-${i}`} className="li">
                      <span className="badge" data-tone={a.threshold >= 100 ? 'bad' : a.threshold >= 90 ? 'warn' : 'info'}>
                        {a.threshold}%
                      </span>
                      <span>
                        {a.label} · {a.workspace} · {formatUsd(a.spent, { min: 2 })} of {formatUsd(a.limit, { min: 2 })}
                      </span>
                    </li>
                  ))}
                  {o.rejected.map((r) => (
                    <li key={`rej-${r.workspaceId}`} className="li">
                      <StatusBadge family="run" value="BUDGET_REJECTED" />
                      <span>
                        {r.runs} {r.runs === 1 ? 'run' : 'runs'} · {r.workspace}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card c-6" aria-labelledby="h-users">
              <div className="pad" style={{ paddingBottom: 0 }}>
                <h2 id="h-users">Top users</h2>
              </div>
              {o.topUsers.length ? (
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">User</th>
                      <th scope="col">Workspace</th>
                      <th scope="col" className="num">
                        AI API
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.topUsers.map((u) => (
                      <tr key={`${u.workspaceId}-${u.userId}`}>
                        <td>{u.name}</td>
                        <td className="subtle">{u.workspace}</td>
                        <td className="num mono">{formatUsd(u.amount, { min: 2 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="pad">
                  <Empty>{model ? 'Per-user figures are not split by model.' : 'No user spend in this range.'}</Empty>
                </div>
              )}
            </section>

            <section className="card c-6" aria-labelledby="h-flows">
              <div className="pad" style={{ paddingBottom: 0 }}>
                <h2 id="h-flows">High-cost workflows</h2>
              </div>
              {o.workflows.length ? (
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Workflow</th>
                      <th scope="col" className="num">
                        Runs
                      </th>
                      <th scope="col" className="num">
                        Avg / run
                      </th>
                      <th scope="col" className="num">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.workflows.map((w) => (
                      <tr key={w.feature}>
                        <td className="mono">{w.feature}</td>
                        <td className="num">{formatInt(w.runs)}</td>
                        <td className="num mono">{w.perRun ? formatUsd(w.perRun) : '—'}</td>
                        <td className="num mono">{formatUsd(w.amount, { min: 2 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="pad">
                  <Empty>No workflow spend in this range.</Empty>
                </div>
              )}
            </section>

            <section className="card pad c-4" aria-labelledby="h-anomalies">
              <h2 id="h-anomalies" className="sect-h">
                Anomalies
              </h2>
              {o.anomalies.length ? (
                <ul className="list" style={{ fontSize: 13 }}>
                  {o.anomalies.map((a) => (
                    <li key={a.id} className="li">
                      <span className="badge" data-tone="bad">
                        z {a.zScore.toFixed(1)}
                      </span>
                      <span>
                        {a.dimension === 'total' ? 'AI spend' : `AI spend on ${a.key}`} · {a.workspace} · {formatDate(a.day)}: {formatUsd(a.amount, { min: 2 })} vs{' '}
                        {formatUsd(Number(a.baselineMean).toFixed(8), { min: 2 })} average{a.isDemo ? ' · DEMO' : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="subtle">Nothing unusual: no daily spend is 3 standard deviations above its 14-day baseline.</p>
              )}
            </section>

            <Reconciliation />
            <RecentCalls calls={o.recentCalls} />
            <CloudCosts />
          </div>
        </>
      )}
    </AdminFrame>
  );
}

function DailyChart({ daily, days }) {
  const data = daily.map((d) => ({ date: d.date.slice(5), aiApi: Number(d.aiApi), cloudInfra: Number(d.cloudInfra), localCompute: Number(d.localCompute) }));
  return (
    <div style={{ overflow: 'auto', marginTop: 12 }} role="img" aria-label={`Stacked daily spend by class over ${days} days`}>
      <BarChart width={780} height={240} data={data} margin={{ top: 6, right: 8, bottom: 4, left: 4 }}>
        <CartesianGrid stroke="var(--fv-border)" vertical={false} />
        <XAxis dataKey="date" stroke="var(--fv-muted)" fontSize={11} interval={days > 31 ? 6 : days > 7 ? 2 : 0} />
        <YAxis stroke="var(--fv-muted)" fontSize={11} tickFormatter={(v) => `$${v.toFixed(2)}`} width={56} />
        <Tooltip
          cursor={{ fill: 'var(--fv-neutral-soft)' }}
          content={({ payload, label }) =>
            payload?.length ? (
              <div className="tip">
                {label}: {payload.map((p) => `${SERIES.find((s) => s[0] === p.dataKey)?.[1]} ${formatUsd(Number(p.value).toFixed(8), { min: 2 })}`).join(' · ')}
              </div>
            ) : null
          }
        />
        {SERIES.map(([key, , color]) => (
          <Bar key={key} dataKey={key} stackId="a" fill={color} isAnimationActive={false} />
        ))}
      </BarChart>
    </div>
  );
}

function Bars({ items, empty, mono = false }) {
  if (!items?.length) return <p className="subtle">{empty}</p>;
  const max = Math.max(...items.map((i) => Number(i.amount)), 0);
  return items.map((i, n) => (
    <div key={i.key} className="hbar">
      <span className={mono ? 'mono' : undefined}>{i.key}</span>
      <div className="bar">
        <i style={{ width: `${max > 0 ? (Number(i.amount) / max) * 100 : 0}%`, background: `var(--fv-chart-${(n % 3) + 1})` }} />
      </div>
      <span className="num mono">{formatUsd(i.amount, { min: 2 })}</span>
    </div>
  ));
}

const STATUS_BADGE = { RECONCILED: 'RECONCILED', VARIANCE: 'VARIANCE' };

function Reconciliation() {
  const qc = useQueryClient();
  const recon = useReconciliation(14);
  const [provider, setProvider] = useState('openai');
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState(/** @type {string[]} */ ([]));
  const r = recon.data;
  const done = (res) => {
    setErrors(res.errors ?? []);
    toast(importSummary(res.results), res.results.some((x) => x.status === 'CONFLICT') ? 'warn' : 'ok');
    qc.invalidateQueries({ queryKey: adminKeys.all });
  };
  const importFile = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      done(await adminApi.importCsv(provider.trim().toLowerCase(), csv));
      setCsv('');
    } catch (err) {
      setErrors(err.problem?.errors ?? []);
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  };
  const fetchApi = async () => {
    setBusy(true);
    try {
      done(await adminApi.fetchProvider('openai', 7));
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  };
  const readFile = async (e) => {
    const f = e.target.files?.[0];
    if (f) setCsv(await f.text());
  };

  return (
    <section className="card c-8" aria-labelledby="h-recon">
      <div className="pad" style={{ paddingBottom: 0 }}>
        <div className="row between">
          <h2 id="h-recon">Reconciliation</h2>
          {r && (
            <span className="subtle" style={{ fontSize: 12 }}>
              Tolerance {formatUsd(r.tolerance, { min: 2 })} per day
            </span>
          )}
        </div>
        <p className="subtle" style={{ fontSize: 12.5, marginTop: 4 }}>
          Each closed UTC day is compared once with the provider’s report. Within tolerance every final entry gets a zero RECONCILED entry; otherwise the difference is
          split pro rata as VARIANCE entries. Nothing is edited.
        </p>
      </div>
      {recon.isPending ? (
        <div className="pad">
          <Skeleton height={80} />
        </div>
      ) : !r?.rows.length ? (
        <div className="pad">
          <Empty>No AI API spend or provider reports in the last 14 days.</Empty>
        </div>
      ) : (
        <div style={{ overflow: 'auto' }}>
          <table className="table">
            <caption className="sr">Ledger against provider reports per day</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Provider</th>
                <th scope="col" className="num">
                  Ledger
                </th>
                <th scope="col" className="num">
                  Provider report
                </th>
                <th scope="col" className="num">
                  Variance
                </th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {r.rows.map((row) => (
                <tr key={`${row.provider}-${row.day}`}>
                  <td>{formatDate(`${row.day}T00:00:00Z`)}</td>
                  <td className="mono">
                    {row.provider}
                    {row.isDemo ? ' · DEMO' : ''}
                  </td>
                  <td className="num mono">{formatUsd(row.ledger, { min: 2 })}</td>
                  <td className="num mono">{row.report != null ? formatUsd(row.report, { min: 2 }) : '—'}</td>
                  <td className="num mono">{row.variance != null ? `${Number(row.variance) > 0 ? '+' : ''}${formatUsd(row.variance, { min: 2 })}` : '—'}</td>
                  <td>
                    {STATUS_BADGE[row.status] ? (
                      <StatusBadge family="cost" value={STATUS_BADGE[row.status]} />
                    ) : (
                      <span className="badge">{row.status === 'OPEN' ? 'Day still open' : 'Waiting for report'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className="pad" onSubmit={importFile} aria-label="Import a provider cost report">
        <div className="form" style={{ maxWidth: 'none', gridTemplateColumns: '160px minmax(0, 1fr)' }}>
          <Field label="Provider">
            <Input value={provider} onChange={(e) => setProvider(e.target.value)} />
          </Field>
          <Field label="Cost report (CSV)" hint="A date column (date, day or start_time) and an amount column (amount, cost or amount_value); optional currency. USD only.">
            <Textarea rows={3} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'date,amount\n2026-10-01,2.08'} className="mono" />
          </Field>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <label className="btn sm">
            Choose file…
            <input type="file" accept=".csv,text/csv" className="sr" onChange={readFile} />
          </label>
          <Button type="submit" size="sm" variant="primary" disabled={busy || !csv.trim()}>
            Import and reconcile
          </Button>
          <Button size="sm" onClick={fetchApi} disabled={busy || !r?.apiConfigured.openai} title={r?.apiConfigured.openai ? undefined : 'Set OPENAI_ADMIN_KEY on the API to enable'}>
            Fetch from OpenAI
          </Button>
          {r && !r.apiConfigured.openai && <span className="subtle">OpenAI Costs API not configured (OPENAI_ADMIN_KEY); use a CSV export.</span>}
        </div>
        {errors.length > 0 && (
          <ul role="alert" style={{ color: 'var(--fv-bad)', marginTop: 8, fontSize: 12.5 }}>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </form>
    </section>
  );
}

function RecentCalls({ calls }) {
  return (
    <section className="card c-12" aria-labelledby="h-calls">
      <div className="pad" style={{ paddingBottom: 0 }}>
        <h2 id="h-calls">Recent model calls</h2>
      </div>
      {!calls.length ? (
        <div className="pad">
          <Empty>No model calls yet.</Empty>
        </div>
      ) : (
        <div style={{ overflow: 'auto' }}>
          <table className="table mono">
            <thead>
              <tr>
                <th scope="col">Call</th>
                <th scope="col">Run · workflow</th>
                <th scope="col">Model</th>
                <th scope="col" className="num">
                  In / cached / out
                </th>
                <th scope="col" className="num">
                  Latency
                </th>
                <th scope="col">Cost state</th>
                <th scope="col" className="num">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <tr key={c.id}>
                  <td>{c.id.slice(0, 8)}</td>
                  <td>
                    {c.runId.slice(0, 8)} · {c.graph ?? '—'}
                  </td>
                  <td>{c.modelConfigId}</td>
                  <td className="num">{c.tokens ? `${formatInt(c.tokens.input)} / ${formatInt(c.tokens.cachedInput)} / ${formatInt(c.tokens.output)}` : '— / — / —'}</td>
                  <td className="num">{c.status === 'SUCCEEDED' ? formatMs(c.latencyMs) : `${c.status.toLowerCase()}${c.errorClass ? ` · ${c.errorClass}` : ''}`}</td>
                  <td>{c.tier ? <StatusBadge family="cost" value={c.tier} /> : <span className="subtle">no charge</span>}</td>
                  <td className="num">{c.amount != null ? `${c.isDemo ? 'DEMO ' : ''}${formatUsd(c.amount)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

function CloudCosts() {
  const qc = useQueryClient();
  const infra = useInfra(30);
  const [form, setForm] = useState({ day: today(), service: '', amount: '', note: '', isDemo: false });
  const [busy, setBusy] = useState(false);
  const d = infra.data;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await adminApi.addInfra({ day: form.day, service: form.service.trim(), amount: form.amount.trim(), ...(form.note.trim() ? { note: form.note.trim() } : {}), isDemo: form.isDemo });
      toast('Cloud cost recorded', 'ok');
      setForm((f) => ({ ...f, service: '', amount: '', note: '' }));
      qc.invalidateQueries({ queryKey: adminKeys.all });
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  };
  const importGcp = async () => {
    setBusy(true);
    try {
      const r = await adminApi.importGcp(7);
      toast(`Imported ${r.imported} service-days from the billing export${r.skippedNonUsd ? ` (${r.skippedNonUsd} non-USD skipped)` : ''}`, 'ok');
      qc.invalidateQueries({ queryKey: adminKeys.all });
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card c-12" aria-labelledby="h-cloud">
      <div className="pad" style={{ paddingBottom: 0 }}>
        <div className="row between">
          <h2 id="h-cloud">Cloud infrastructure · 30d</h2>
          <Button size="sm" onClick={importGcp} disabled={busy || !d?.gcpConfigured} title={d?.gcpConfigured ? undefined : 'Set FV_GCP_BILLING_TABLE on the API to enable'}>
            Import GCP billing export
          </Button>
        </div>
        {d && !d.gcpConfigured && (
          <p className="subtle" style={{ fontSize: 12.5, marginTop: 4 }}>
            The GCP billing export is not configured (FV_GCP_BILLING_TABLE), so cloud costs are entered by hand below.
          </p>
        )}
      </div>
      <div className="dash pad" style={{ gap: 18 }}>
        <div className="c-5">
          <Bars items={(d?.byService ?? []).map((s) => ({ key: s.service, amount: s.amount }))} empty="No cloud costs recorded in the last 30 days." />
        </div>
        <form className="c-7 form" onSubmit={add} style={{ maxWidth: 'none', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }} aria-label="Record a cloud cost">
          <Field label="Day">
            <Input type="date" value={form.day} max={today()} onChange={set('day')} required />
          </Field>
          <Field label="Service">
            <Input value={form.service} onChange={set('service')} placeholder="Cloud Run" required />
          </Field>
          <Field label="Amount (USD)">
            <Input inputMode="decimal" value={form.amount} onChange={set('amount')} placeholder="1.25" required />
          </Field>
          <Field label="Note">
            <Input value={form.note} onChange={set('note')} placeholder="From the invoice, line 4" />
          </Field>
          <label className="row" style={{ alignSelf: 'end', paddingBottom: 8 }}>
            <input type="checkbox" checked={form.isDemo} onChange={set('isDemo')} /> DEMO figure
          </label>
          <div>
            <Button type="submit" size="sm" variant="primary" disabled={busy}>
              Record cost
            </Button>
          </div>
        </form>
      </div>
      {d?.rows.length > 0 && (
        <div style={{ overflow: 'auto' }}>
          <table className="table">
            <caption className="sr">Recorded cloud costs</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Service</th>
                <th scope="col">Source</th>
                <th scope="col" className="num">
                  Amount
                </th>
                <th scope="col">Note</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.slice(0, 30).map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(`${r.day}T00:00:00Z`)}</td>
                  <td>{r.service}</td>
                  <td className="subtle">{r.source === 'MANUAL' ? 'Manual' : 'GCP billing export'}</td>
                  <td className="num mono">
                    {r.isDemo ? 'DEMO ' : ''}
                    {formatUsd(r.amount, { min: 2 })}
                  </td>
                  <td className="subtle">{r.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
