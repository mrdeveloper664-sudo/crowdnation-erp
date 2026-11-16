/** Money arrives from the API as decimal strings; only formatting (never arithmetic on floats) happens in the UI. */
export function money(v: string | number | null | undefined, dp = 2): string {
  if (v === null || v === undefined || v === '') return '';
  const s = String(v);
  if (!/^-?\d+(\.\d+)?$/.test(s)) return s;
  const neg = s.startsWith('-');
  const [i, d = ''] = s.replace('-', '').split('.');
  const frac = (d + '0'.repeat(dp)).slice(0, dp);
  return `${neg ? '-' : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${dp ? '.' + frac : ''}`;
}
export const today = () => new Date().toISOString().slice(0, 10);
export function titleCase(s: string) { return s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()); }
export function sumMoney(values: Array<string | undefined>, dp = 2): string {
  // integer-cents arithmetic (no floating point drift)
  const f = 10 ** dp; let t = 0;
  for (const v of values) if (v && /^-?\d+(\.\d+)?$/.test(v)) t += Math.round(Number(v) * f);
  const s = (t / f).toFixed(dp); return s;
}

/** Client-side ESTIMATE of a document line (integer cents; the API recalculates authoritatively). */
export function estimateLine(qty: string, price: string, discountPct: string, ratePct: number, inclusive: boolean) {
  const q = Number(qty || 0), p = Number(price || 0), d = Number(discountPct || 0);
  const base = Math.round(q * p * (100 - d)) / 100; // cents
  const baseC = Math.round(base * 100);
  const netC = inclusive ? Math.round((baseC * 100) / (100 + ratePct)) : baseC;
  const vatC = inclusive ? baseC - netC : Math.round((baseC * ratePct) / 100);
  return { net: (netC / 100).toFixed(2), vat: (vatC / 100).toFixed(2), gross: ((netC + vatC) / 100).toFixed(2) };
}
