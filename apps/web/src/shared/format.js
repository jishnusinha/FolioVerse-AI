/**
 * Format a decimal money string (or number) as USD without float rounding of stored values.
 * Keeps at least `min` and at most `max` fraction digits.
 */
export function formatUsd(amount, { min = 4, max = 8 } = {}) {
  if (amount == null || amount === '') return '—';
  const s = String(amount);
  const neg = s.startsWith('-');
  const [int, frac = ''] = s.replace('-', '').split('.');
  let f = frac.slice(0, max).replace(/0+$/, '');
  if (f.length < min) f = f.padEnd(min, '0');
  return `${neg ? '-' : ''}$${Number(int).toLocaleString('en-US')}.${f}`;
}

export function formatInt(n) {
  return n == null ? '—' : Number(n).toLocaleString('en-US');
}

export function formatDate(iso) {
  return iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
}

export function formatMs(ms) {
  if (ms == null) return '—';
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}
