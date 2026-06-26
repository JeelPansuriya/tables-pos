import { TIMEZONE } from './supabase';
import type { Bill, BillItem, BillPayment, PreorderPayment, PayMode } from './types';

/**
 * The POS stores timestamps via SQLite datetime('now'), i.e. UTC in the form
 * "YYYY-MM-DD HH:MM:SS" (no timezone marker). We parse that as UTC and re-derive
 * the *business* day in the restaurant's timezone so a sale at 11pm local still
 * counts on the right day regardless of where the dashboard is opened.
 */
function asUtcDate(ts: string | null): Date | null {
  if (!ts) return null;
  const iso = ts.includes('T') ? ts : ts.replace(' ', 'T');
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z';
  const d = new Date(withZone);
  return isNaN(d.getTime()) ? null : d;
}

const ymdFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Business-day key "YYYY-MM-DD" in the restaurant timezone, or '' if unparseable. */
export function bizDay(ts: string | null): string {
  const d = asUtcDate(ts);
  return d ? ymdFmt.format(d) : '';
}

/** Today's business day in the restaurant timezone. */
export function todayKey(): string {
  return ymdFmt.format(new Date());
}

/** YYYY-MM-DD for `days` ago (business day). */
export function dayKeyOffset(days: number): string {
  return ymdFmt.format(new Date(Date.now() - days * 86400000));
}

export const inr = (n: number) =>
  '₹' + (Math.round((n + Number.EPSILON) * 100) / 100).toLocaleString('en-IN');

export type DaySummary = {
  date: string;
  collected: number;
  billSales: number;
  billCount: number;
  plates: number;
  byMode: Record<PayMode, number>;
  preorderAdvance: number;
  cancelledCount: number;
  cancelledTotal: number;
  topItems: Array<{ name: string; qty: number; total: number }>;
};

const emptyModes = (): Record<PayMode, number> => ({ cash: 0, upi: 0, card: 0, other: 0 });

/**
 * Compute a single day's summary, mirroring the desktop app: money is keyed to
 * closed bills + pre-order payments received that day; cancelled bills are shown
 * separately, not netted into sales.
 */
export function daySummary(
  date: string,
  bills: Bill[],
  payments: BillPayment[],
  items: BillItem[],
  preorderPayments: PreorderPayment[]
): DaySummary {
  const closed = bills.filter((b) => b.status === 'closed' && bizDay(b.closed_at) === date);
  const closedIds = new Set(closed.map((b) => b.id));
  const cancelled = bills.filter((b) => b.status === 'cancelled' && bizDay(b.cancelled_at) === date);

  const byMode = emptyModes();
  let collected = 0;
  for (const p of payments) {
    if (!closedIds.has(p.bill_id)) continue;
    byMode[p.mode] = (byMode[p.mode] ?? 0) + p.amount;
    collected += p.amount;
  }

  let preorderAdvance = 0;
  for (const p of preorderPayments) {
    if (bizDay(p.received_at) !== date) continue;
    byMode[p.mode] = (byMode[p.mode] ?? 0) + p.amount;
    preorderAdvance += p.amount;
    collected += p.amount;
  }

  const itemAgg = new Map<string, { name: string; qty: number; total: number }>();
  for (const it of items) {
    if (!closedIds.has(it.bill_id)) continue;
    const cur = itemAgg.get(it.name) ?? { name: it.name, qty: 0, total: 0 };
    cur.qty += it.qty;
    cur.total += it.total;
    itemAgg.set(it.name, cur);
  }

  return {
    date,
    collected,
    billSales: closed.reduce((s, b) => s + b.total, 0),
    billCount: closed.length,
    plates: closed.reduce((s, b) => s + (b.plates || 0), 0),
    byMode,
    preorderAdvance,
    cancelledCount: cancelled.length,
    cancelledTotal: cancelled.reduce((s, b) => s + b.total, 0),
    topItems: [...itemAgg.values()].sort((a, b) => b.qty - a.qty).slice(0, 8),
  };
}

/** Daily collected totals across a set of bills+payments, for the trend chart. */
export function dailyTrend(
  bills: Bill[],
  payments: BillPayment[],
  preorderPayments: PreorderPayment[],
  fromKey: string
): Array<{ date: string; sales: number }> {
  const closedDay = new Map<number, string>();
  for (const b of bills) {
    if (b.status === 'closed') closedDay.set(b.id, bizDay(b.closed_at));
  }
  const totals = new Map<string, number>();
  for (const p of payments) {
    const d = closedDay.get(p.bill_id);
    if (d && d >= fromKey) totals.set(d, (totals.get(d) ?? 0) + p.amount);
  }
  for (const p of preorderPayments) {
    const d = bizDay(p.received_at);
    if (d && d >= fromKey) totals.set(d, (totals.get(d) ?? 0) + p.amount);
  }
  return [...totals.entries()]
    .map(([date, sales]) => ({ date, sales: Math.round(sales) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
