import { aggregate, EvalObservation, scoreItem } from '../../src/modules/studio/evaluation';

const target = 'v-target';
const obs = (o: Partial<EvalObservation>): EvalObservation => ({
  runId: 'r1',
  status: 'SUCCEEDED',
  outcome: 'ANSWERED',
  answer: 'The base case grows at 14.2% a year [S1].',
  citations: [{ state: 'VALID' }],
  packed: [{ sourceVersionId: target, page: 1, pageFrom: 1, pageTo: 1 }],
  targetVersionId: target,
  cost: 0.0001,
  latencyMs: 900,
  ...o,
});
const item = { id: 'q1', question: 'Growth?', doc: 'atlas-brief.pdf', answerable: true, page: 2, evidence: '14.2%' };

describe('RAG evaluation scoring', () => {
  it('counts a retrieval hit when a packed parent section spans the evidence page', () => {
    expect(scoreItem(item, obs({})).retrievalHit).toBe(false);
    expect(scoreItem(item, obs({ packed: [{ sourceVersionId: target, page: 1, pageFrom: 1, pageTo: 2 }] })).retrievalHit).toBe(true);
    expect(scoreItem(item, obs({ packed: [{ sourceVersionId: 'other', page: 2, pageFrom: 2, pageTo: 2 }] })).retrievalHit).toBe(false);
    expect(scoreItem(item, obs({ packed: [{ sourceVersionId: target, page: 2 }] })).retrievalHit).toBe(true);
  });

  it('scores abstention, evidence and cost including the judge', () => {
    const unanswerable = { ...item, id: 'q2', answerable: false, page: undefined, evidence: undefined };
    const abstained = scoreItem(unanswerable, obs({ outcome: 'ABSTAINED', answer: 'Not found.', citations: [], packed: [] }));
    expect(abstained).toMatchObject({ abstained: true, abstainCorrect: true, retrievalHit: null, evidenceFound: null });
    const answered = scoreItem(item, obs({ relevance: 4, judgeCost: 0.00005 }));
    expect(answered).toMatchObject({ evidenceFound: true, relevance: 4, citations: { total: 1, valid: 1, weak: 0, unresolved: 0 } });
    expect(answered.cost).toBeCloseTo(0.00015);
    const failed = scoreItem(item, obs({ status: 'FAILED', outcome: null }));
    expect(failed).toMatchObject({ abstainCorrect: null, retrievalHit: null, evidenceFound: null });

    const m = aggregate([answered, abstained, failed]);
    expect(m).toMatchObject({ items: 3, completed: 2, failed: 1, faithfulness: 1, retrievalRecall: 0, answerAccuracy: 1, abstentionAccuracy: 1, answerRelevance: 4 });
    expect(m.costPerAnswer).toBe((Number(m.costTotal) / 2).toFixed(8));
  });
});
