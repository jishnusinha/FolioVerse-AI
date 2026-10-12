import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { actionFor, INSIGHT_ACTIONS } from '../../src/modules/insights/insight-actions';

const fixture = JSON.parse(readFileSync(join(__dirname, '../../../../packages/contracts/fixtures/insight-actions.json'), 'utf8'));

describe('insight action registry', () => {
  it('matches the shared contract fixture', () => {
    expect(INSIGHT_ACTIONS).toEqual(fixture.actions);
  });

  it('resolves actions per graph', () => {
    expect(actionFor('insight')?.id).toBe('quick_summary');
    expect(actionFor('insight', 'flashcards')?.tier).toBe('T1');
    expect(actionFor('risk_contradiction')?.id).toBe('risks');
    expect(actionFor('risk_contradiction', 'contradictions')?.id).toBe('contradictions');
    expect(actionFor('insight', 'compare')).toBeNull();
    expect(actionFor('insight', 'nope')).toBeNull();
    expect(actionFor('grounded_qa')).toBeNull();
  });
});
