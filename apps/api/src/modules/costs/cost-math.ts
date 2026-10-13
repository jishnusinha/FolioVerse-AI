import { Decimal } from 'decimal.js';

export const DAY_MS = 86400_000;

/** UTC midnight of the day containing `d`. */
export function utcDay(d: Date | string | number): Date {
  const x = new Date(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
}

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export interface AnomalyOptions {
  /** Flag at or above this many standard deviations. */
  z: number;
  /** Ignore days below this amount (noise floor). */
  minAmount: number;
  /** Baseline days that must have spend before anything is flagged. */
  minDays: number;
}

/**
 * z-score of `value` against a trailing baseline (missing days count as zero). The standard deviation is floored
 * at 10% of the mean so a perfectly flat history does not make every small change infinite.
 */
export function anomalyScore(baseline: number[], value: number, opts: AnomalyOptions) {
  if (baseline.filter((v) => v > 0).length < opts.minDays) return null;
  const mean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
  const std = Math.sqrt(baseline.reduce((a, b) => a + (b - mean) ** 2, 0) / baseline.length);
  const floor = Math.max(std, mean * 0.1, 1e-9);
  const z = (value - mean) / floor;
  return { mean, std, z, flagged: value >= opts.minAmount && value > mean && z >= opts.z };
}

/**
 * Splits `total` across entries in proportion to `weights`, rounded to 8 decimals; the largest weight absorbs the
 * rounding remainder so the parts always sum to `total` exactly. Equal split when every weight is zero.
 */
export function allocate(total: Decimal.Value, weights: Decimal.Value[]): Decimal[] {
  const t = new Decimal(total);
  if (!weights.length) return [];
  const w = weights.map((x) => Decimal.max(new Decimal(x), 0));
  const sum = w.reduce((a, b) => a.plus(b), new Decimal(0));
  const parts = sum.isZero()
    ? w.map(() => t.div(w.length).toDecimalPlaces(8, Decimal.ROUND_DOWN))
    : w.map((x) => t.mul(x).div(sum).toDecimalPlaces(8, Decimal.ROUND_DOWN));
  const rest = t.minus(parts.reduce((a, b) => a.plus(b), new Decimal(0)));
  let big = 0;
  w.forEach((x, i) => {
    if (x.gt(w[big])) big = i;
  });
  parts[big] = parts[big].plus(rest);
  return parts;
}

export interface ProviderDay {
  day: string;
  amount: string;
  currency: string;
}

const DATE_COLS = ['date', 'day', 'usage_date', 'start_time', 'bucket_start'];
const AMOUNT_COLS = ['amount', 'cost', 'amount_value', 'cost_usd', 'value', 'total'];

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseDay(raw: string): string | null {
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return isoDay(utcDay(n > 1e11 ? n : n * 1000));
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

/**
 * Reads a provider cost export: a header row naming a date column and an amount column (common names accepted,
 * e.g. `date,amount` or `start_time,amount_value`), optional `currency`. Rows on the same day are summed.
 */
export function parseProviderCsv(text: string): { days: ProviderDay[]; errors: string[] } {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { days: [], errors: ['The file is empty'] };
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const di = header.findIndex((h) => DATE_COLS.includes(h));
  const ai = header.findIndex((h) => AMOUNT_COLS.includes(h));
  const ci = header.indexOf('currency');
  if (di < 0 || ai < 0) return { days: [], errors: ['The header must name a date column (date, day, start_time) and an amount column (amount, cost, amount_value)'] };
  const byDay = new Map<string, { amount: Decimal; currency: string }>();
  const errors: string[] = [];
  lines.slice(1).forEach((line, i) => {
    const cells = splitCsvLine(line);
    const day = parseDay(cells[di] ?? '');
    const raw = (cells[ai] ?? '').replace(/^\$/, '');
    const currency = (ci >= 0 ? cells[ci] : 'USD')?.toUpperCase() || 'USD';
    if (!day || !/^-?\d+(\.\d+)?$/.test(raw)) {
      errors.push(`Row ${i + 2}: unreadable date or amount`);
      return;
    }
    const prev = byDay.get(day);
    if (prev && prev.currency !== currency) {
      errors.push(`Row ${i + 2}: mixed currencies on ${day}`);
      return;
    }
    byDay.set(day, { amount: (prev?.amount ?? new Decimal(0)).plus(raw), currency });
  });
  const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day, amount: v.amount.toFixed(8), currency: v.currency }));
  return { days, errors };
}
