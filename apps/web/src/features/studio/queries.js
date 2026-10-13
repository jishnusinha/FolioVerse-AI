import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client.js';

export const studioKeys = {
  all: (wid) => ['studio', wid],
  capabilities: (wid) => ['studio', wid, 'capabilities'],
  checkpoints: (wid, runId) => ['studio', wid, 'checkpoints', runId],
  compare: (wid, ids) => ['studio', wid, 'compare', ids],
  battles: (wid) => ['studio', wid, 'battles'],
  battle: (wid, id) => ['studio', wid, 'battle', id],
  evaluations: (wid) => ['studio', wid, 'evaluations'],
  evaluation: (wid, id) => ['studio', wid, 'evaluation', id],
};

const base = (wid) => `/workspaces/${wid}/studio`;
const BUSY = new Set(['QUEUED', 'RUNNING']);

/** Lab switches, usable chat models, failure kinds and golden datasets. */
export function useCapabilities(wid) {
  return useQuery({ queryKey: studioKeys.capabilities(wid), queryFn: () => api(`${base(wid)}/capabilities`), enabled: Boolean(wid), staleTime: 60_000 });
}

/** LangGraph checkpoints of a run (state summaries only, no source text). */
export function useCheckpoints(wid, runId, enabled = true) {
  return useQuery({
    queryKey: studioKeys.checkpoints(wid, runId),
    queryFn: () => api(`/workspaces/${wid}/runs/${runId}/checkpoints`),
    enabled: Boolean(wid && runId && enabled),
    retry: false,
  });
}

export function useCompare(wid, ids) {
  return useQuery({
    queryKey: studioKeys.compare(wid, ids),
    queryFn: () => api(`${base(wid)}/compare?runs=${ids.join(',')}`),
    enabled: Boolean(wid && ids.length >= 2),
  });
}

export function useBattles(wid) {
  return useQuery({ queryKey: studioKeys.battles(wid), queryFn: () => api(`${base(wid)}/battles`), enabled: Boolean(wid) });
}

/** One battle; polls until every contestant has finished. */
export function useBattle(wid, id) {
  return useQuery({
    queryKey: studioKeys.battle(wid, id),
    queryFn: () => api(`${base(wid)}/battles/${id}`),
    enabled: Boolean(wid && id),
    refetchInterval: (q) => (q.state.data && !q.state.data.finished ? 1500 : false),
  });
}

export function useRagEvaluations(wid) {
  return useQuery({
    queryKey: studioKeys.evaluations(wid),
    queryFn: () => api(`${base(wid)}/evaluations`),
    enabled: Boolean(wid),
    refetchInterval: (q) => (q.state.data?.some((r) => BUSY.has(r.status)) ? 2000 : false),
  });
}

export function useRagEvaluation(wid, id) {
  return useQuery({
    queryKey: studioKeys.evaluation(wid, id),
    queryFn: () => api(`${base(wid)}/evaluations/${id}`),
    enabled: Boolean(wid && id),
    refetchInterval: (q) => (BUSY.has(q.state.data?.status) ? 2000 : false),
  });
}

export const studioApi = {
  fork: (wid, runId, body) => api(`/workspaces/${wid}/runs/${runId}/fork`, { method: 'POST', body }),
  labRun: (wid, body) => api(`/workspaces/${wid}/runs`, { method: 'POST', body: { ...body, lab: true, detached: true } }),
  createBattle: (wid, body) => api(`${base(wid)}/battles`, { method: 'POST', body }),
  vote: (wid, id, winner) => api(`${base(wid)}/battles/${id}/vote`, { method: 'POST', body: { winner } }),
  evaluate: (wid, body) => api(`${base(wid)}/evaluations`, { method: 'POST', body }),
};

// ───────────── Time machine ─────────────

/**
 * Field-level changes between two checkpoint state summaries (values are already redacted by the AI service).
 * @returns {{ key: string, before: unknown, after: unknown, change: 'added'|'removed'|'changed'|'same' }[]}
 */
export function diffCheckpoints(prev, next) {
  const a = prev?.state ?? {};
  const b = next?.state ?? {};
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return keys.map((key) => {
    const before = a[key];
    const after = b[key];
    const change = !(key in a) ? 'added' : !(key in b) ? 'removed' : JSON.stringify(before) === JSON.stringify(after) ? 'same' : 'changed';
    return { key, before, after, change };
  });
}

/** Label for a checkpoint row: the node(s) it is about to run, or the end of the run. */
export function checkpointLabel(cp) {
  if (cp.step === -1) return 'input';
  return cp.next?.length ? `before ${cp.next.join(', ')}` : 'end';
}

// ───────────── Replay ─────────────

/**
 * Node executions after applying the first `count` recorded node events. Replays cost nothing: they
 * only re-read stored events.
 */
export function replayFrame(events, count) {
  const out = {};
  let n = 0;
  for (const e of events) {
    if (!e.type.startsWith('node.')) continue;
    if (n >= count) break;
    n += 1;
    const d = e.data ?? {};
    out[d.node] = e.type === 'node.started' ? { status: 'RUNNING', step: d.step } : { status: d.status ?? 'SUCCEEDED', step: d.step, durationMs: d.durationMs };
  }
  return out;
}

export const nodeEventCount = (events) => events.filter((e) => e.type.startsWith('node.')).length;

// ───────────── RAG X-Ray ─────────────

export const NOTE_LABEL = {
  'packed-parent': 'Packed (parent section)',
  'packed-child': 'Packed (child chunk)',
  'parent-already-packed': 'Skipped: parent already packed',
  'over-budget': 'Dropped: over context budget',
  'missing-text': 'Dropped: chunk text missing',
  'below-top-k': 'Below top-K',
};

/**
 * Candidate rows of a recorded retrieval: ranks from each retriever, the fused (RRF) rank, the final rank
 * after reranking, how far reranking moved it, and what the context packer did with it.
 */
export function xrayRows(retrieval) {
  const packed = new Map((retrieval?.packed ?? []).map((p) => [p.chunkId, p]));
  return (retrieval?.candidates ?? []).map((c, i) => {
    const finalRank = c.finalRank ?? i + 1;
    const p = packed.get(c.chunkId);
    return {
      ...c,
      finalRank,
      delta: c.fusedRank != null ? c.fusedRank - finalRank : null,
      marker: p?.marker ?? null,
      level: p?.level ?? null,
      tokens: p?.tokens ?? null,
      note: c.note ?? (p ? 'packed-child' : 'below-top-k'),
    };
  });
}

/** Context budget use of a recorded retrieval. */
export function budgetUse(retrieval) {
  const used = (retrieval?.packed ?? []).reduce((a, p) => a + (p.tokens ?? 0), 0);
  const budget = retrieval?.params?.budget ?? null;
  return { used, budget, pct: budget ? Math.min(100, Math.round((used / budget) * 100)) : null };
}

// ───────────── Evaluations ─────────────

export const RAG_METRICS = [
  ['faithfulness', 'Faithfulness', 'Share of citations that validate against the cited passage (deterministic, no model).'],
  ['retrievalRecall', 'Retrieval recall', 'Answerable questions whose evidence page reached the packed context.'],
  ['answerAccuracy', 'Answer accuracy', 'Answerable questions whose answer contains the gold evidence.'],
  ['abstentionAccuracy', 'Abstention accuracy', 'Questions where the run abstained exactly when it should.'],
  ['answerRelevance', 'Answer relevance', 'Mean judge score from 1 to 5 (opt-in; one extra model call per answer).'],
];

/** One quality number for the scatter: the mean of the deterministic ratios that are present. */
export function qualityScore(m) {
  const xs = ['faithfulness', 'retrievalRecall', 'answerAccuracy', 'abstentionAccuracy'].map((k) => m?.[k]).filter((v) => typeof v === 'number');
  return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 1000 : null;
}

/** Cost-vs-quality points for finished evaluations. */
export function scatterPoints(evaluations, models = []) {
  const name = new Map(models.map((m) => [m.id, m.displayName]));
  return (evaluations ?? [])
    .filter((e) => e.status === 'SUCCEEDED' && e.metrics?.costPerAnswer != null)
    .map((e) => ({
      id: e.id,
      model: name.get(e.modelConfigId) ?? e.modelConfigId,
      cost: Number(e.metrics.costPerAnswer),
      quality: qualityScore(e.metrics),
      isDemo: e.isDemo,
    }))
    .filter((p) => p.quality != null);
}

export const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
