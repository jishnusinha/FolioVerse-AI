import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client.js';

export const discoverKeys = {
  all: (wid) => ['discover', wid],
  taste: (wid) => ['discover', wid, 'taste'],
  latest: (wid, mode) => ['discover', wid, 'latest', mode],
  saved: (wid) => ['discover', wid, 'saved'],
  similar: (wid, id, otherKind) => ['discover', wid, 'similar', id, otherKind],
  model: (wid) => ['discover', wid, 'model'],
  evaluations: (wid) => ['discover', wid, 'evaluations'],
};

/** Scoring factors in display order, with the prototype's labels. */
export const FACTORS = [
  ['semantic', 'Semantic affinity'],
  ['tfidf', 'TF-IDF similarity'],
  ['theme', 'Theme overlap'],
  ['preference', 'Preference match'],
  ['prior', 'Quality prior (capped)'],
];
export const DEFAULT_WEIGHTS = { semantic: 0.35, tfidf: 0.2, theme: 0.2, preference: 0.2, prior: 0.05 };
export const DEFAULT_LAMBDA = 0.7;

/** Offline metrics in report order; `lowerIsBetter` marks popularity bias. */
export const METRICS = [
  ['precision', 'Precision@K'],
  ['recall', 'Recall@K'],
  ['ndcg', 'nDCG@K'],
  ['hitRate', 'Hit rate'],
  ['coverage', 'Catalog coverage'],
  ['diversity', 'Intra-list diversity'],
  ['novelty', 'Novelty'],
  ['popularityPercentile', 'Popularity bias', true],
];
export const VARIANT_LABEL = {
  popularity: 'Most popular',
  item_knn: 'Item kNN (CF)',
  nmf: 'NMF (implicit CF)',
  content: 'Content only',
  hybrid: 'Hybrid',
  hybrid_mmr: 'Hybrid + MMR (served)',
};

const base = (wid) => `/workspaces/${wid}/discover`;

export function useTaste(wid) {
  return useQuery({ queryKey: discoverKeys.taste(wid), queryFn: () => api(`${base(wid)}/taste`), enabled: Boolean(wid), staleTime: 60_000 });
}

/** The member's most recent logged set for a mode (`{ id: null, items: [] }` when there is none). */
export function useLatestSet(wid, mode = 'DISCOVER') {
  return useQuery({ queryKey: discoverKeys.latest(wid, mode), queryFn: () => api(`${base(wid)}/recommendations/latest?mode=${mode}`), enabled: Boolean(wid) });
}

export function useSaved(wid) {
  return useQuery({ queryKey: discoverKeys.saved(wid), queryFn: () => api(`${base(wid)}/saved`), enabled: Boolean(wid) });
}

export function useSimilar(wid, itemId, otherKind = true) {
  return useQuery({
    queryKey: discoverKeys.similar(wid, itemId, otherKind),
    queryFn: () => api(`${base(wid)}/catalog/${itemId}/similar?otherKind=${otherKind}`),
    enabled: Boolean(wid && itemId),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useRecModel(wid) {
  return useQuery({ queryKey: discoverKeys.model(wid), queryFn: () => api(`${base(wid)}/model`), enabled: Boolean(wid), retry: false, staleTime: 5 * 60_000 });
}

/** Recent evaluation reports; polls while one is queued or running. */
export function useEvaluations(wid) {
  return useQuery({
    queryKey: discoverKeys.evaluations(wid),
    queryFn: () => api(`${base(wid)}/evaluations`),
    enabled: Boolean(wid),
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === 'QUEUED' || r.status === 'RUNNING') ? 1500 : false),
  });
}

export const discoverApi = {
  saveTaste: (wid, body) => api(`${base(wid)}/taste`, { method: 'PUT', body }),
  recommend: (wid, body) => api(`${base(wid)}/recommendations`, { method: 'POST', body }),
  feedback: (wid, body) => api(`${base(wid)}/feedback`, { method: 'POST', body }),
  explain: (wid, setId, itemId) => api(`${base(wid)}/recommendations/${setId}/items/${itemId}/explain`, { method: 'POST' }),
  evaluate: (wid, k = 10) => api(`${base(wid)}/evaluations`, { method: 'POST', body: { k } }),
};

/** Weighted contribution of each factor, largest first, for the "why this" bars. */
export function factorBars(rec) {
  const rows = (rec.factors ?? []).map((f) => ({ ...f, contribution: f.contribution ?? f.value * f.weight }));
  return rows.sort((a, b) => b.contribution - a.contribution);
}

/** Rank movement of each item in `next` relative to `prev` (positive = moved up; null = new). */
export function rankShift(prev, next) {
  const before = new Map((prev?.items ?? []).map((i) => [i.itemId, i.rank]));
  return Object.fromEntries((next?.items ?? []).map((i) => [i.itemId, before.has(i.itemId) ? before.get(i.itemId) - i.rank : null]));
}

export const saveLabel = (item) => (item.feedback?.saved ? '✓ Saved' : item.kind === 'FILM' ? '+ Watchlist' : '+ To read');
