import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { reanchor, similarity } from '../../src/common/anchors';

const fixtures = JSON.parse(readFileSync(join(__dirname, '../../../../packages/contracts/fixtures/anchor-cases.json'), 'utf8'));

describe('reanchor golden fixtures', () => {
  for (const c of fixtures.cases) {
    it(c.name, () => {
      const r = reanchor(c.newText, c.anchor);
      expect(r.state).toBe(c.expected.state);
      if (c.expected.start !== undefined) expect([r.start, r.end]).toEqual([c.expected.start, c.expected.end]);
    });
  }

  it('scores bigram similarity symmetrically', () => {
    expect(similarity('night', 'nacht')).toBeCloseTo(similarity('nacht', 'night'));
    expect(similarity('silver', 'silver')).toBe(1);
    expect(similarity('a', 'ab')).toBe(0);
  });
});
