import { TIMEZONE } from './supabase';
import type { Bill, BillItem, BillPayment, PreorderPayment, PayMode, CashCount } from './types';

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

function prevDayKey(d: string): string {
  const x = new Date(d + 'T00:00:00');
  x.setDate(x.getDate() - 1);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(
    x.getDate()
  ).padStart(2, '0')}`;
}

export type RangeAnalytics = {
  daily: Array<{ date: string; billRevenue: number; preorder: number; bills: number; plates: number }>;
  byHour: Array<{ hour: number; revenue: number; bills: number }>;
  byWeekday: Array<{ dow: number; revenue: number; bills: number }>;
  byMode: Record<PayMode, number>;
  topItems: Array<{ name: string; qty: number; revenue: number }>;
  cash: Array<{ date: string; collected: number; counted: number | null; expense: number | null }>;
  totals: {
    billRevenue: number;
    preorderCollected: number;
    totalCollected: number;
    bills: number;
    plates: number;
    activeDays: number;
    avgPerDay: number;
    avgPerPlate: number;
    totalCashExpense: number;
    bestDay: { date: string; revenue: number } | null;
    peakHour: { hour: number; revenue: number } | null;
  };
};

const hourInTz = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', hour12: false });
function bizHour(ts: string | null): number | null {
  const d = ts ? new Date((ts.includes('T') ? ts : ts.replace(' ', 'T')) + (/[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? '' : 'Z')) : null;
  if (!d || isNaN(d.getTime())) return null;
  return parseInt(hourInTz.format(d), 10);
}

/**
 * Range analytics computed in the browser from the synced rows — mirrors the
 * desktop Analytics tab. Closed bills only; pre-order payments fold into the
 * collected/mode totals on their received day but stay distinct from bill sales.
 */
export function rangeAnalytics(
  fromKey: string,
  toKey: string,
  bills: Bill[],
  payments: BillPayment[],
  items: BillItem[],
  preorderPayments: PreorderPayment[],
  cashCounts: CashCount[]
): RangeAnalytics {
  const inRange = (k: string) => k >= fromKey && k <= toKey;
  const closed = bills.filter((b) => b.status === 'closed' && inRange(bizDay(b.closed_at)));
  const closedDay = new Map<number, string>();
  closed.forEach((b) => closedDay.set(b.id, bizDay(b.closed_at)));
  const closedIds = new Set(closed.map((b) => b.id));

  const dailyMap = new Map<string, { billRevenue: number; preorder: number; bills: number; plates: number }>();
  const ensure = (d: string) => {
    if (!dailyMap.has(d)) dailyMap.set(d, { billRevenue: 0, preorder: 0, bills: 0, plates: 0 });
    return dailyMap.get(d)!;
  };
  for (const b of closed) {
    const e = ensure(bizDay(b.closed_at));
    e.billRevenue += b.total;
    e.bills += 1;
    e.plates += b.plates || 0;
  }
  for (const p of preorderPayments) {
    const d = bizDay(p.received_at);
    if (inRange(d)) ensure(d).preorder += p.amount;
  }

  const byHourMap = new Map<number, { revenue: number; bills: number }>();
  const byDowMap = new Map<number, { revenue: number; bills: number }>();
  for (const b of closed) {
    const h = bizHour(b.closed_at);
    if (h != null) {
      const e = byHourMap.get(h) ?? { revenue: 0, bills: 0 };
      e.revenue += b.total;
      e.bills += 1;
      byHourMap.set(h, e);
    }
    const dow = new Date(bizDay(b.closed_at) + 'T00:00:00').getDay();
    const de = byDowMap.get(dow) ?? { revenue: 0, bills: 0 };
    de.revenue += b.total;
    de.bills += 1;
    byDowMap.set(dow, de);
  }

  const byMode: Record<PayMode, number> = { cash: 0, upi: 0, card: 0, other: 0 };
  for (const p of payments) if (closedIds.has(p.bill_id)) byMode[p.mode] = (byMode[p.mode] ?? 0) + p.amount;
  for (const p of preorderPayments) if (inRange(bizDay(p.received_at))) byMode[p.mode] = (byMode[p.mode] ?? 0) + p.amount;

  const itemAgg = new Map<string, { name: string; qty: number; revenue: number }>();
  for (const it of items) {
    if (!closedIds.has(it.bill_id)) continue;
    const e = itemAgg.get(it.name) ?? { name: it.name, qty: 0, revenue: 0 };
    e.qty += it.qty;
    e.revenue += it.total;
    itemAgg.set(it.name, e);
  }

  // Cash taken in (cash mode) by day + manager's counted close + expense.
  const cashInByDay = new Map<string, number>();
  for (const p of payments) {
    if (p.mode !== 'cash') continue;
    const d = closedDay.get(p.bill_id);
    if (d) cashInByDay.set(d, (cashInByDay.get(d) ?? 0) + p.amount);
  }
  for (const p of preorderPayments) {
    if (p.mode !== 'cash') continue;
    const d = bizDay(p.received_at);
    if (inRange(d)) cashInByDay.set(d, (cashInByDay.get(d) ?? 0) + p.amount);
  }
  const countByDate = new Map(cashCounts.map((c) => [c.date, c.counted_cash]));
  // The first counted day is the opening baseline (no previous close) → no
  // expense; daily expense starts from the next count.
  const cashDates = new Set<string>([...dailyMap.keys(), ...cashInByDay.keys()]);
  cashCounts.forEach((c) => inRange(c.date) && cashDates.add(c.date));
  const cash = [...cashDates].sort().map((date) => {
    const collected = +(cashInByDay.get(date) ?? 0).toFixed(2);
    const counted = countByDate.has(date) ? countByDate.get(date)! : null;
    const prev = countByDate.has(prevDayKey(date)) ? countByDate.get(prevDayKey(date))! : null;
    const expense = counted != null && prev != null ? +(prev + collected - counted).toFixed(2) : null;
    return { date, collected, counted, expense };
  });

  const daily = [...dailyMap.entries()]
    .map(([date, v]) => ({ date, ...v, billRevenue: +v.billRevenue.toFixed(2), preorder: +v.preorder.toFixed(2) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const billRevenue = closed.reduce((s, b) => s + b.total, 0);
  const plates = closed.reduce((s, b) => s + (b.plates || 0), 0);
  const preorderCollected = preorderPayments
    .filter((p) => inRange(bizDay(p.received_at)))
    .reduce((s, p) => s + p.amount, 0);
  const activeDays = daily.filter((d) => d.bills > 0).length;
  const best = daily.reduce<{ date: string; revenue: number } | null>(
    (m, d) => (!m || d.billRevenue > m.revenue ? { date: d.date, revenue: d.billRevenue } : m),
    null
  );
  const peak = [...byHourMap.entries()].reduce<{ hour: number; revenue: number } | null>(
    (m, [hour, v]) => (!m || v.revenue > m.revenue ? { hour, revenue: v.revenue } : m),
    null
  );

  return {
    daily,
    byHour: [...byHourMap.entries()].map(([hour, v]) => ({ hour, ...v })).sort((a, b) => a.hour - b.hour),
    byWeekday: [...byDowMap.entries()].map(([dow, v]) => ({ dow, ...v })).sort((a, b) => a.dow - b.dow),
    byMode,
    topItems: [...itemAgg.values()].sort((a, b) => b.qty - a.qty).slice(0, 15),
    cash,
    totals: {
      billRevenue: +billRevenue.toFixed(2),
      preorderCollected: +preorderCollected.toFixed(2),
      totalCollected: +(billRevenue + preorderCollected).toFixed(2),
      bills: closed.length,
      plates,
      activeDays,
      avgPerDay: activeDays ? +(billRevenue / activeDays).toFixed(2) : 0,
      avgPerPlate: plates ? +(billRevenue / plates).toFixed(2) : 0,
      totalCashExpense: +cash.reduce((s, c) => s + (c.expense ?? 0), 0).toFixed(2),
      bestDay: best,
      peakHour: peak,
    },
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
