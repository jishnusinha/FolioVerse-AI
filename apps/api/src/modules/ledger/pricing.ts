import { Decimal } from 'decimal.js';

export interface PriceInput {
  inputPerMTok: string | Decimal;
  outputPerMTok: string | Decimal;
  cachedInputPerMTok?: string | Decimal | null;
  reasoningPerMTok?: string | Decimal | null;
  batchDiscount?: string | Decimal | null;
}

export interface UsageInput {
  input: number;
  output: number;
  cachedInput?: number;
  reasoning?: number;
}

export interface PricedUsage {
  amount: Decimal;
  status: 'FINALIZED' | 'FINAL_ESTIMATED';
  reason: 'PRICE_MISSING' | 'USAGE_ESTIMATED' | null;
}

const MTOK = new Decimal(1_000_000);

/**
 * Prices token usage. Mirrors packages/contracts/scripts/make_pricing_fixtures.py and the
 * AI service ledger; all three are checked against fixtures/pricing-cases.json.
 */
export function priceUsage(price: PriceInput | null, usage: UsageInput, reported = true): PricedUsage {
  if (!price) return { amount: new Decimal(0), status: 'FINAL_ESTIMATED', reason: 'PRICE_MISSING' };
  const inP = new Decimal(price.inputPerMTok);
  const outP = new Decimal(price.outputPerMTok);
  const cP = price.cachedInputPerMTok != null ? new Decimal(price.cachedInputPerMTok) : inP;
  const rP = price.reasoningPerMTok != null ? new Decimal(price.reasoningPerMTok) : outP;
  const disc = new Decimal(price.batchDiscount ?? 0);
  const cached = usage.cachedInput ?? 0;
  const reasoning = usage.reasoning ?? 0;
  if (cached > usage.input) throw new RangeError('cachedInput exceeds input');
  if (reasoning > usage.output) throw new RangeError('reasoning exceeds output');

  const total = new Decimal(usage.input - cached)
    .mul(inP)
    .plus(new Decimal(cached).mul(cP))
    .plus(new Decimal(usage.output - reasoning).mul(outP))
    .plus(new Decimal(reasoning).mul(rP))
    .div(MTOK)
    .mul(new Decimal(1).minus(disc))
    .toDecimalPlaces(8, Decimal.ROUND_HALF_UP);

  if (!reported) return { amount: total, status: 'FINAL_ESTIMATED', reason: 'USAGE_ESTIMATED' };
  return { amount: total, status: 'FINALIZED', reason: null };
}

/** Rough token estimate used only for preflight reservations (~4 chars per token). */
export const estimateTokens = (text: string) => Math.ceil((text?.length ?? 0) / 4);
