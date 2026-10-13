import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { CartesianGrid, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import { can, useCurrentWorkspace } from '@/features/auth/session.js';
import { EvaluationPanel } from '@/features/discover/EvaluationPanel.jsx';
import { useProjects, useSources } from '@/features/knowledge/queries.js';
import { formatMs, formatUsd } from '@/shared/format.js';
import { Button, Callout, DemoBadge, Empty, Field, Input, Progress, Select, Skeleton, StatusBadge, toast } from '@/shared/ui/index.js';
import { notebookRows, repoLink } from './notebooks.js';
import { StudioFrame } from './parts.jsx';
import { RAG_METRICS, pct, qualityScore, scatterPoints, studioApi, studioKeys, useCapabilities, useRagEvaluation, useRagEvaluations } from './queries.js';

const READY = new Set(['READY', 'PARTIAL']);
const fmtMetric = (key, v) => (v == null ? '—' : key === 'answerRelevance' ? `${v.toFixed(2)} / 5` : pct(v));

export function EvaluationsPage() {
  const ws = useCurrentWorkspace();
  const wid = ws?.id;
  const caps = useCapabilities(wid);
  const evals = useRagEvaluations(wid);
  const [selected, setSelected] = useState(/** @type {string | null} */ (null));
  const current = selected ?? evals.data?.[0]?.id ?? null;
  const models = caps.data?.models ?? [];
  const name = new Map(models.map((m) => [m.id, m.displayName]));
  return (
    <StudioFrame
      view="evaluations"
      eyebrow={`Evaluations · ${ws?.name ?? ''}`}
      title="Evaluations"
      intro="RAG evaluations run a golden question set through grounded Q&A as LAB runs and score retrieval recall, faithfulness (citation validity), answer accuracy and abstention. Each question is one billed run; the optional judge adds one more call per answer."
    >
      <div className="dash">
        <NewEvaluation wid={wid} ws={ws} caps={caps.data} onCreated={setSelected} />
        <section className="card pad c-7" aria-labelledby="cq-h">
          <h2 className="sect-h" id="cq-h">
            Cost vs quality
          </h2>
          <CostQuality points={scatterPoints(evals.data, models)} />
        </section>
        <section className="card pad c-12" aria-labelledby="eval-list">
          <h2 className="sect-h" id="eval-list">
            RAG evaluation runs
          </h2>
          {evals.isPending ? (
            <Skeleton height={80} />
          ) : !evals.data?.length ? (
            <Empty>No RAG evaluations yet. Upload the synthetic Atlas brief (datasets/synthetic/docs) to a project, then run the golden set against it.</Empty>
          ) : (
            <div style={{ overflow: 'auto' }}>
              <table className="table" aria-label="RAG evaluations">
                <thead>
                  <tr>
                    <th scope="col">Started</th>
                    <th scope="col">Model</th>
                    <th scope="col">Status</th>
                    {RAG_METRICS.map(([k, label, help]) => (
                      <th key={k} scope="col" className="num" title={help}>
                        {label}
                      </th>
                    ))}
                    <th scope="col" className="num">
                      Cost / answer
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {evals.data.map((e) => (
                    <tr key={e.id} className={e.id === current ? 'sel' : undefined}>
                      <td>
                        <button type="button" className="btn sm ghost" onClick={() => setSelected(e.id)} aria-pressed={e.id === current}>
                          {new Date(e.createdAt).toLocaleString()}
                        </button>
                      </td>
                      <td>
                        {name.get(e.modelConfigId) ?? e.modelConfigId} {e.isDemo && <DemoBadge />}
                      </td>
                      <td>
                        <StatusBadge family="run" value={e.status} />
                        {(e.status === 'RUNNING' || e.status === 'QUEUED') && e.progress.total ? (
                          <span className="mono subtle"> {e.progress.done}/{e.progress.total}</span>
                        ) : null}
                      </td>
                      {RAG_METRICS.map(([k]) => (
                        <td key={k} className="num mono">
                          {fmtMetric(k, e.metrics?.[k])}
                        </td>
                      ))}
                      <td className="num mono">{e.metrics?.costPerAnswer != null ? formatUsd(e.metrics.costPerAnswer) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        {current && <EvaluationDetail wid={wid} id={current} />}
        <EvaluationPanel headingId="studio-rec-eval" />
        <ResearchNotebooks results={caps.data?.notebooks} />
      </div>
    </StudioFrame>
  );
}

function NewEvaluation({ wid, ws, caps, onCreated }) {
  const projects = useProjects(wid);
  const knowledge = (projects.data ?? []).filter((p) => p.kind === 'KNOWLEDGE' && !p.deletedAt);
  const [projectId, setProjectId] = useState('');
  const pid = projectId || knowledge[0]?.id;
  const sources = useSources(wid, pid);
  const ready = (sources.data ?? []).filter((s) => READY.has(s.ingestionState));
  const dataset = caps?.datasets?.[0];
  const [model, setModel] = useState('');
  const [topK, setTopK] = useState(8);
  const [fusion, setFusion] = useState('rrf');
  const [judge, setJudge] = useState(false);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const stem = (t) => t.toLowerCase().replace(/\.[a-z0-9]+$/, '');
  const hasDoc = dataset ? ready.some((s) => stem(s.title) === stem(dataset.doc)) : false;
  const start = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const row = await studioApi.evaluate(wid, {
        dataset: dataset.id,
        scope: { projectId: pid },
        ...(model ? { modelPreference: model } : {}),
        options: { topK, fusion },
        judge,
      });
      await qc.invalidateQueries({ queryKey: studioKeys.evaluations(wid) });
      onCreated(row.id);
      toast('Evaluation queued', 'ok');
    } catch (err) {
      toast(err.message || 'The evaluation could not be queued', 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card pad c-5 stack" style={{ gap: 12 }} onSubmit={start} aria-labelledby="eval-new">
      <h2 className="sect-h" id="eval-new">
        Run a RAG evaluation
      </h2>
      {!dataset ? (
        <Callout>No golden dataset is installed on this server.</Callout>
      ) : (
        <p className="subtle" style={{ fontSize: 12.5 }}>
          {dataset.label}: {dataset.items} questions, {dataset.answerable} answerable, about <span className="mono">{dataset.doc}</span>.
        </p>
      )}
      <Field label="Project (scope)" hint={dataset && !sources.isPending && !hasDoc ? `This project has no ready ${dataset.doc}.` : undefined}>
        <Select value={pid ?? ''} onChange={(e) => setProjectId(e.target.value)}>
          {knowledge.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Model">
        <Select value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="">Workspace default</option>
          {(caps?.models ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
              {m.isDemo ? ' (DEMO)' : ''}
            </option>
          ))}
        </Select>
      </Field>
      <div className="row" style={{ gap: 10 }}>
        <Field label="Top-K">
          <Input type="number" min={1} max={20} value={topK} onChange={(e) => setTopK(Number(e.target.value))} style={{ width: 80 }} />
        </Field>
        <Field label="Fusion">
          <Select value={fusion} onChange={(e) => setFusion(e.target.value)}>
            <option value="rrf">Hybrid (RRF)</option>
            <option value="dense">Dense only</option>
            <option value="sparse">BM25 only</option>
          </Select>
        </Field>
      </div>
      <label className="row" style={{ gap: 6 }}>
        <input type="checkbox" checked={judge} onChange={(e) => setJudge(e.target.checked)} /> Score answer relevance with a judge model
      </label>
      {judge && (
        <p className="subtle" style={{ fontSize: 12 }}>
          {caps?.judge?.liveModel
            ? 'The judge uses the selected model: one extra billed call per answered question.'
            : 'No live model is configured, so relevance comes from the DEMO mock judge (a word-overlap heuristic), not a real model.'}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={busy || !dataset || !hasDoc || !can(ws, 'EDITOR')}>
        {busy ? 'Queuing…' : `Run ${dataset?.items ?? ''} questions`}
      </Button>
    </form>
  );
}

function RepoPath({ path, children }) {
  const href = repoLink(path);
  return href ? (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ) : (
    <span className="mono subtle">{path}</span>
  );
}

function ResearchNotebooks({ results }) {
  const rows = notebookRows(results);
  return (
    <section className="card pad c-12 stack" style={{ gap: 10 }} aria-labelledby="nb-h">
      <div className="row between">
        <h2 className="sect-h" id="nb-h" style={{ margin: 0 }}>
          Research notebooks
        </h2>
        <DemoBadge />
      </div>
      <p className="subtle" style={{ fontSize: 12.5, margin: 0 }}>
        Offline studies of retrieval, citations, cost, recommendations and graph traces on synthetic data, run in CI in smoke mode. Findings are from the last committed full run. Guide:{' '}
        <RepoPath path="docs/notebooks.md">notebook guide</RepoPath>
      </p>
      <ol aria-label="Research notebooks" className="stack" style={{ gap: 4, margin: 0, padding: 0, listStyle: 'none' }}>
        {rows.map((r) => (
          <li key={r.id}>
            <details>
              <summary>
                <span className="mono subtle">{r.id.slice(0, 2)}</span> <strong>{r.title}</strong> <span className="subtle">· {r.question}</span>
              </summary>
              <div className="stack" style={{ gap: 6, padding: '6px 0 6px 24px' }}>
                {r.run?.findings.length ? (
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
                    {r.run.findings.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="subtle" style={{ margin: 0, fontSize: 12.5 }}>
                    No committed results on this server.
                  </p>
                )}
                <p className="subtle" style={{ margin: 0, fontSize: 12 }}>
                  {r.run?.createdAt ? `Full run ${new Date(r.run.createdAt).toLocaleDateString()} · ` : ''}
                  <RepoPath path={r.notebook}>notebook with outputs</RepoPath> · <RepoPath path={r.results}>metrics JSON</RepoPath>
                </p>
              </div>
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}

function CostQuality({ points }) {
  if (!points.length) return <Empty>Finished evaluations appear here, one point per run: cost per answer against the mean of the deterministic quality scores.</Empty>;
  return (
    <div style={{ overflow: 'auto' }} role="img" aria-label={`Cost versus quality for ${points.length} evaluation runs`}>
      <ScatterChart width={560} height={260} margin={{ top: 10, right: 20, bottom: 30, left: 10 }}>
        <CartesianGrid stroke="var(--fv-border)" />
        <XAxis
          type="number"
          dataKey="cost"
          name="Cost per answer"
          tickFormatter={(v) => `$${v.toFixed(5)}`}
          stroke="var(--fv-muted)"
          fontSize={11}
          label={{ value: 'Cost per answer (USD)', position: 'insideBottom', offset: -18, fill: 'var(--fv-muted)', fontSize: 11 }}
        />
        <YAxis type="number" dataKey="quality" name="Quality" domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} stroke="var(--fv-muted)" fontSize={11} />
        <ZAxis range={[220, 220]} />
        <Tooltip
          cursor={{ stroke: 'var(--fv-border-strong)' }}
          content={({ payload }) => {
            const p = payload?.[0]?.payload;
            return p ? (
              <div className="tip">
                {p.model}
                {p.isDemo ? ' (DEMO)' : ''} · {formatUsd(p.cost.toFixed(8))} · {pct(p.quality)}
              </div>
            ) : null;
          }}
        />
        <Scatter data={points} fill="var(--fv-accent)" />
      </ScatterChart>
      <p className="subtle" style={{ fontSize: 11.5 }}>
        Quality is the mean of faithfulness, retrieval recall, answer accuracy and abstention accuracy. Up and to the left is better.
      </p>
    </div>
  );
}

function EvaluationDetail({ wid, id }) {
  const ev = useRagEvaluation(wid, id);
  if (ev.isPending) return <Skeleton height={120} />;
  if (ev.error) return <Callout tone="bad">{ev.error.message}</Callout>;
  const e = ev.data;
  const m = e.metrics;
  const busy = e.status === 'QUEUED' || e.status === 'RUNNING';
  return (
    <section className="card pad c-12 stack" style={{ gap: 12 }} aria-labelledby="eval-detail">
      <div className="row between">
        <h2 className="sect-h" id="eval-detail" style={{ margin: 0 }}>
          Evaluation {e.id.slice(0, 8)} · {e.dataset}
        </h2>
        <span className="row">
          <StatusBadge family="run" value={e.status} />
          {e.isDemo && <DemoBadge />}
        </span>
      </div>
      {busy && e.progress.total ? <Progress value={(e.progress.done / e.progress.total) * 100} label="Evaluation progress" /> : null}
      {e.error && <Callout tone="bad">{e.error}</Callout>}
      {m && (
        <dl className="strip" aria-label="Evaluation metrics" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', margin: 0 }}>
          {RAG_METRICS.map(([k, label, help]) => (
            <div key={k} title={help}>
              <dt className="subtle">{label}</dt>
              <dd className="mono" style={{ fontSize: 18, margin: 0 }}>
                {fmtMetric(k, m[k])}
              </dd>
            </div>
          ))}
          <div>
            <dt className="subtle">Quality (mean)</dt>
            <dd className="mono" style={{ fontSize: 18, margin: 0 }}>
              {pct(qualityScore(m))}
            </dd>
          </div>
          <div>
            <dt className="subtle">Total cost</dt>
            <dd className="mono" style={{ fontSize: 18, margin: 0 }}>
              {formatUsd(m.costTotal)}
            </dd>
          </div>
          <div>
            <dt className="subtle">Median latency</dt>
            <dd className="mono" style={{ fontSize: 18, margin: 0 }}>
              {formatMs(m.latencyP50Ms)}
            </dd>
          </div>
        </dl>
      )}
      {e.items?.length > 0 && (
        <div style={{ overflow: 'auto' }}>
          <table className="table" aria-label="Per-question results">
            <thead>
              <tr>
                <th scope="col">Question</th>
                <th scope="col">Outcome</th>
                <th scope="col">Retrieved</th>
                <th scope="col">Correct</th>
                <th scope="col" className="num">
                  Valid citations
                </th>
                <th scope="col" className="num">
                  Relevance
                </th>
                <th scope="col" className="num">
                  Cost
                </th>
              </tr>
            </thead>
            <tbody>
              {e.items.map((it) => (
                <tr key={it.id}>
                  <td>
                    {it.runId ? <Link to={`/app/studio/runs/${it.runId}`}>{it.question}</Link> : it.question}
                    {!it.answerable && <span className="subtle"> · should abstain</span>}
                  </td>
                  <td>{it.outcome ? <StatusBadge family="outcome" value={it.outcome} /> : <StatusBadge family="run" value={it.status} />}</td>
                  <td>{it.retrievalHit == null ? '—' : it.retrievalHit ? '✓ evidence page' : '✕ missed'}</td>
                  <td>{it.answerable ? (it.evidenceFound == null ? '—' : it.evidenceFound ? '✓' : '✕') : it.abstainCorrect ? '✓ abstained' : '✕ answered'}</td>
                  <td className="num mono">
                    {it.citations.valid}/{it.citations.total}
                  </td>
                  <td className="num mono">{it.relevance ?? '—'}</td>
                  <td className="num mono">{formatUsd(it.cost.toFixed(8))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
