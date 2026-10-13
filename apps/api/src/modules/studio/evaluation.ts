import type { GoldenItem } from './datasets';

export interface EvalObservation {
  runId: string | null;
  status: string;
  outcome: string | null;
  answer: string;
  citations: { state: string }[];
  packed: { sourceVersionId: string; page: number | null; pageFrom?: number | null; pageTo?: number | null }[];
  targetVersionId: string;
  cost: number;
  latencyMs: number | null;
  relevance?: number | null;
  judgeCost?: number;
}

export interface EvalItemResult {
  id: string;
  question: string;
  answerable: boolean;
  runId: string | null;
  status: string;
  outcome: string | null;
  abstained: boolean;
  abstainCorrect: boolean | null;
  retrievalHit: boolean | null;
  evidenceFound: boolean | null;
  citations: { total: number; valid: number; weak: number; unresolved: number };
  relevance: number | null;
  cost: number;
  latencyMs: number | null;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** A packed passage covers a page if the page lies in its span (a parent section can cross pages). */
const covers = (p: EvalObservation['packed'][number], page: number | undefined) =>
  page != null && (p.page === page || (p.pageFrom != null && p.pageTo != null && p.pageFrom <= page && page <= p.pageTo));
const ratio = (n: number, d: number) => (d ? Math.round((n / d) * 10_000) / 10_000 : null);

/** Scores one golden item against its recorded run. Only completed runs are scored. */
export function scoreItem(item: GoldenItem, o: EvalObservation): EvalItemResult {
  const done = o.status === 'SUCCEEDED' || o.status === 'PARTIAL';
  const abstained = o.outcome === 'ABSTAINED';
  const count = (state: string) => o.citations.filter((c) => c.state === state).length;
  return {
    id: item.id,
    question: item.question,
    answerable: item.answerable,
    runId: o.runId,
    status: o.status,
    outcome: o.outcome,
    abstained,
    abstainCorrect: done ? abstained === !item.answerable : null,
    retrievalHit: done && item.answerable ? o.packed.some((p) => p.sourceVersionId === o.targetVersionId && covers(p, item.page)) : null,
    evidenceFound: done && item.answerable ? !abstained && !!item.evidence && norm(o.answer).includes(norm(item.evidence)) : null,
    citations: { total: o.citations.length, valid: count('VALID'), weak: count('WEAK'), unresolved: count('UNRESOLVED') },
    relevance: o.relevance ?? null,
    cost: o.cost + (o.judgeCost ?? 0),
    latencyMs: o.latencyMs,
  };
}

/**
 * Aggregate metrics. Faithfulness = VALID citations / all citations (deterministic citation validation);
 * retrieval recall = answerable items whose evidence page was packed; answer accuracy = answerable items whose
 * answer contains the gold evidence; abstention accuracy over all completed items; relevance = mean judge score (1–5).
 */
export function aggregate(items: EvalItemResult[]) {
  const done = items.filter((i) => i.abstainCorrect !== null);
  const answerable = done.filter((i) => i.answerable);
  const cited = done.reduce((a, i) => ({ total: a.total + i.citations.total, valid: a.valid + i.citations.valid }), { total: 0, valid: 0 });
  const judged = done.filter((i) => i.relevance != null);
  const latencies = done.map((i) => i.latencyMs).filter((v): v is number => v != null).sort((a, b) => a - b);
  const cost = items.reduce((a, i) => a + i.cost, 0);
  return {
    items: items.length,
    completed: done.length,
    failed: items.length - done.length,
    faithfulness: ratio(cited.valid, cited.total),
    retrievalRecall: ratio(answerable.filter((i) => i.retrievalHit).length, answerable.length),
    answerAccuracy: ratio(answerable.filter((i) => i.evidenceFound).length, answerable.length),
    abstentionAccuracy: ratio(done.filter((i) => i.abstainCorrect).length, done.length),
    answerRelevance: judged.length ? Math.round((judged.reduce((a, i) => a + (i.relevance ?? 0), 0) / judged.length) * 100) / 100 : null,
    costTotal: cost.toFixed(8),
    costPerAnswer: done.length ? (cost / done.length).toFixed(8) : null,
    latencyP50Ms: latencies.length ? latencies[Math.floor((latencies.length - 1) / 2)] : null,
  };
}
