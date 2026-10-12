import { useQueryClient } from '@tanstack/react-query';
import { can, useCurrentWorkspace } from '@/features/auth/session.js';
import { Button, Callout, DemoBadge, Empty, Skeleton, StatusBadge, toast } from '@/shared/ui/index.js';
import { METRICS, discoverApi, discoverKeys, useEvaluations } from './queries.js';

const fmt = (key, v) => (v == null ? '—' : key === 'novelty' ? v.toFixed(2) : v.toFixed(3));

/** Best value per metric across variants (popularity bias: closest to 0.5 is best). */
function best(variants, key, lowerIsBetter) {
  const vals = variants.map((v) => v[key]).filter((x) => typeof x === 'number');
  if (!vals.length) return null;
  return lowerIsBetter ? vals.reduce((a, b) => (Math.abs(b - 0.5) < Math.abs(a - 0.5) ? b : a)) : Math.max(...vals);
}

export function EvaluationTable({ report }) {
  const variants = Array.isArray(report.variants) ? report.variants : [];
  return (
    <div style={{ overflow: 'auto' }}>
      <table className="table" aria-label={`Offline evaluation at K=${report.k}`}>
        <thead>
          <tr>
            <th scope="col">Variant</th>
            {METRICS.map(([key, label]) => (
              <th key={key} scope="col" className="num" title={report.metrics?.[key] ?? label}>
                {label.replace('@K', `@${report.k}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {variants.map((v) => (
            <tr key={v.name} aria-current={v.name === 'hybrid_mmr' ? 'true' : undefined}>
              <th scope="row" style={{ fontWeight: v.name === 'hybrid_mmr' ? 600 : 450 }}>
                {v.label ?? v.name}
              </th>
              {METRICS.map(([key, , lower]) => {
                const top = best(variants, key, lower) === v[key];
                return (
                  <td key={key} className="num mono" style={top ? { color: 'var(--fv-accent)', fontWeight: 600 } : undefined}>
                    {fmt(key, v[key])}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Offline evaluation of the served recommender on the synthetic holdout split. Running one queues a worker job
 * (no language model, nothing billed); the panel polls until the report is stored.
 */
export function EvaluationPanel({ headingId = 'rec-eval', compact = false }) {
  const ws = useCurrentWorkspace();
  const wid = ws?.id;
  const qc = useQueryClient();
  const reports = useEvaluations(wid);
  const latest = reports.data?.[0];
  const done = reports.data?.find((r) => r.status === 'SUCCEEDED');
  const busy = latest && (latest.status === 'QUEUED' || latest.status === 'RUNNING');
  const run = async () => {
    try {
      await discoverApi.evaluate(wid, 10);
      await qc.invalidateQueries({ queryKey: discoverKeys.evaluations(wid) });
      toast('Evaluation queued', 'ok');
    } catch (e) {
      toast(e.message || 'The evaluation could not be queued', 'bad');
    }
  };
  return (
    <section className={compact ? undefined : 'card pad c-12'} aria-labelledby={headingId}>
      <div className="row between" style={{ marginBottom: 10 }}>
        <h2 className="sect-h" id={headingId} style={{ margin: 0 }}>
          Offline evaluation
        </h2>
        <div className="row">
          {latest && <StatusBadge family="run" value={latest.status} />}
          <Button onClick={run} disabled={!can(ws, 'EDITOR') || busy} title={can(ws, 'EDITOR') ? undefined : 'Running an evaluation needs the Editor role'}>
            {busy ? 'Evaluating…' : 'Run evaluation'}
          </Button>
        </div>
      </div>
      {reports.isPending ? (
        <Skeleton height={120} />
      ) : reports.error ? (
        <Callout tone="bad">Evaluation reports could not be loaded: {reports.error.message}</Callout>
      ) : !done ? (
        <Empty>
          {busy
            ? 'Scoring the holdout split. This takes a few seconds.'
            : 'No evaluation has been run on this model yet. A run scores the held-out interactions of synthetic users and reports Precision@K, Recall@K, nDCG@K, catalog coverage, intra-list diversity, novelty and popularity bias for the served model and its baselines.'}
        </Empty>
      ) : (
        <>
          <p className="subtle" style={{ fontSize: 12, marginBottom: 10 }}>
            {done.report.modelVersion} · K={done.report.k} · {done.report.users} users · {done.report.catalogItems} titles · {new Date(done.finishedAt ?? done.createdAt).toLocaleString()}
            {done.report.durationMs != null ? ` · ${(done.report.durationMs / 1000).toFixed(1)} s` : ''} {done.report.isDemo && <DemoBadge />}
          </p>
          <EvaluationTable report={done.report} />
          <p className="subtle" style={{ fontSize: 12, marginTop: 10 }}>
            {done.report.note} Highlighted values are the best per column; for popularity bias, closest to 0.5.
          </p>
        </>
      )}
      {latest?.status === 'FAILED' && (
        <Callout tone="bad" role="alert">
          The last evaluation failed: {latest.error ?? 'unknown error'}
        </Callout>
      )}
    </section>
  );
}
