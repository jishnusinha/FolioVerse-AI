import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { priceUsage } from '../../src/modules/ledger/pricing';

const fixtures = JSON.parse(readFileSync(join(__dirname, '../../../../packages/contracts/fixtures/pricing-cases.json'), 'utf8'));

describe('priceUsage golden fixtures', () => {
  for (const c of fixtures.cases) {
    it(c.name, () => {
      const r = priceUsage(c.prices, c.usage, c.reported);
      expect(r.amount.toFixed(8)).toBe(c.expected.amount);
      expect(r.status).toBe(c.expected.status);
      expect(r.reason).toBe(c.expected.reason);
    });
  }

  it('rejects cached tokens above input', () => {
    expect(() => priceUsage({ inputPerMTok: '1', outputPerMTok: '1' }, { input: 1, output: 0, cachedInput: 2 })).toThrow(RangeError);
  });
});
