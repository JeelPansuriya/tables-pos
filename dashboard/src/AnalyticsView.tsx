import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from 'recharts';
import { supabase, table, pageAll } from './supabase';
import type { Bill, BillItem, BillPayment, PreorderPayment, CashCount } from './types';
import { rangeAnalytics, inr, todayKey, bizDay } from './analytics';

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}
function addDays(key: string, n: number): string {
  const d = new Date(key + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return ymd(d);
}
function diffDays(from: string, to: string): number {
  return Math.round((new Date(to + 'T00:00:00').getTime() - new Date(from + 'T00:00:00').getTime()) / 86400000) + 1;
}
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;
const monthLabel = (m: string) =>
  new Date(m + '-01T00:00:00').toLocaleString('en-US', { month: 'short', year: '2-digit' });
const MODE_HEX: Record<string, string> = { cash: '#059669', upi: '#0284c7', card: '#7c3aed', other: '#78716c' };
const pct = (cur: number, prev: number): number | null => (prev > 0 ? +(((cur - prev) / prev) * 100).toFixed(1) : null);

async function chunkedIn<T>(tbl: string, cols: string, column: string, ids: number[]): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from(tbl).select(cols).in(column, ids.slice(i, i + 200));
    if (error) throw error;
    if (data) out.push(...(data as T[]));
  }
  return out;
}

export default function AnalyticsView() {
  const [to, setTo] = useState(todayKey());
  const [from, setFrom] = useState(() => addDays(todayKey(), -29));
  const [bills, setBills] = useState<Bill[]>([]);
  const [payments, setPayments] = useState<BillPayment[]>([]);
  const [items, setItems] = useState<BillItem[]>([]);
  const [prePays, setPrePays] = useState<PreorderPayment[]>([]);
  const [cashCounts, setCashCounts] = useState<CashCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const rangeLen = diffDays(from, to);
  const prevFrom = addDays(from, -rangeLen);
  const prevTo = addDays(from, -1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch a window covering the selected range + the equal previous period
      // (for growth %), with a couple days' slack for cash carry-over.
      const cutoff = new Date(prevFrom + 'T00:00:00');
      cutoff.setDate(cutoff.getDate() - 2);
      const iso = ymd(cutoff) + ' 00:00:00';
      const [b, pays, prePaysRows, cashRes] = await Promise.all([
        pageAll<Bill>((f, t) =>
          supabase
            .from(table('bills'))
            .select('id,status,token_no,meal_type,total,plates,discount,opened_at,closed_at,cancelled_at')
            .in('status', ['closed', 'cancelled'])
            .gte('closed_at', iso)
            .order('id', { ascending: false })
            .range(f, t)
        ),
        pageAll<BillPayment>((f, t) =>
          supabase
            .from(table('bill_payments'))
            .select('id,bill_id,amount,mode,received_at')
            .gte('received_at', iso)
            .order('id', { ascending: false })
            .range(f, t)
        ),
        pageAll<PreorderPayment>((f, t) =>
          supabase
            .from(table('preorder_payments'))
            .select('id,preorder_id,amount,mode,received_at')
            .gte('received_at', iso)
            .order('id', { ascending: false })
            .range(f, t)
        ),
        supabase.from(table('cash_counts')).select('date,counted_cash,note').gte('date', ymd(cutoff)).lte('date', to),
      ]);
      if (cashRes.error) throw cashRes.error;
      // Items only for closed bills in the *selected* range (keeps payload small).
      const rangeIds = b
        .filter((x) => x.status === 'closed' && bizDay(x.closed_at) >= from && bizDay(x.closed_at) <= to)
        .map((x) => x.id);
      const it = await chunkedIn<BillItem>(table('bill_items'), 'id,bill_id,name,qty,unit_price,total', 'bill_id', rangeIds);
      setBills(b);
      setPayments(pays);
      setItems(it);
      setPrePays(prePaysRows);
      setCashCounts((cashRes.data ?? []) as CashCount[]);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [from, to, prevFrom]);

  useEffect(() => {
    load();
  }, [load]);

  const a = useMemo(
    () => rangeAnalytics(from, to, bills, payments, items, prePays, cashCounts),
    [from, to, bills, payments, items, prePays, cashCounts]
  );
  const prev = useMemo(
    () => rangeAnalytics(prevFrom, prevTo, bills, payments, [], prePays, cashCounts),
    [prevFrom, prevTo, bills, payments, prePays, cashCounts]
  );

  // Voids (token-bearing cancelled) + discounts in the selected range.
  const voids = useMemo(() => {
    const inRange = (k: string) => k >= from && k <= to;
    const v = bills.filter(
      (b) => b.status === 'cancelled' && b.token_no != null && inRange(bizDay(b.cancelled_at || b.closed_at))
    );
    return { count: v.length, total: v.reduce((s, b) => s + b.total, 0) };
  }, [bills, from, to]);

  const discounts = useMemo(() => {
    const inRange = (k: string) => k >= from && k <= to;
    return bills
      .filter((b) => b.status === 'closed' && inRange(bizDay(b.closed_at)))
      .reduce((s, b) => s + (b.discount || 0), 0);
  }, [bills, from, to]);

  // Month-to-date for the month containing `to`.
  const mtd = useMemo(() => {
    const monthStart = to.slice(0, 7) + '-01';
    const inMtd = (k: string) => k >= monthStart && k <= to;
    const billRev = bills
      .filter((b) => b.status === 'closed' && inMtd(bizDay(b.closed_at)))
      .reduce((s, b) => s + b.total, 0);
    const pre = prePays.filter((p) => inMtd(bizDay(p.received_at))).reduce((s, p) => s + p.amount, 0);
    return billRev + pre;
  }, [bills, prePays, to]);

  // Monthly revenue across the fetched window (a few months).
  const monthly = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of bills) {
      if (b.status !== 'closed') continue;
      const key = bizDay(b.closed_at).slice(0, 7);
      if (!key) continue;
      m.set(key, (m.get(key) ?? 0) + b.total);
    }
    return [...m.entries()].sort().map(([month, revenue]) => ({ month, label: monthLabel(month), revenue: Math.round(revenue) }));
  }, [bills]);

  // Slow items (lowest sellers) among items sold in range.
  const slowItems = useMemo(() => [...a.topItems].sort((x, y) => x.qty - y.qty).slice(0, 8), [a.topItems]);

  const peakHour = a.totals.peakHour?.hour ?? -1;
  const hourData = a.byHour.map((h) => ({ ...h, label: hourLabel(h.hour) }));
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weekdayData = WEEKDAYS.map((label, dow) => ({ label, revenue: a.byWeekday.find((x) => x.dow === dow)?.revenue ?? 0 }));
  const modeTotal = (Object.values(a.byMode) as number[]).reduce((s, n) => s + n, 0) || 1;
  const noteByDate = new Map(cashCounts.map((c) => [c.date, c.note || '']));
  const growth = pct(a.totals.totalCollected, prev.totals.totalCollected);

  function preset(days: number) {
    setFrom(addDays(todayKey(), -(days - 1)));
    setTo(todayKey());
  }
  function thisMonth() {
    setFrom(todayKey().slice(0, 7) + '-01');
    setTo(todayKey());
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
        <button className="rounded-md border border-stone-300 px-3 py-1.5" onClick={() => preset(7)}>7d</button>
        <button className="rounded-md border border-stone-300 px-3 py-1.5" onClick={() => preset(30)}>30d</button>
        <button className="rounded-md border border-stone-300 px-3 py-1.5" onClick={thisMonth}>Month</button>
        <input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        <span className="text-stone-400">→</span>
        <input type="date" className="input" value={to} max={todayKey()} onChange={(e) => setTo(e.target.value)} />
      </div>

      {error && <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      {loading && !bills.length ? (
        <div className="py-16 text-center text-stone-400">Loading analytics…</div>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="Total collected"
              value={inr(a.totals.totalCollected)}
              accent
              sub={`bills ${inr(a.totals.billRevenue)} · pre ${inr(a.totals.preorderCollected)}`}
              delta={growth}
            />
            <Stat label="vs prev period" value={inr(prev.totals.totalCollected)} sub={`${prevFrom.slice(5)}–${prevTo.slice(5)}`} />
            <Stat label="Month-to-date" value={inr(mtd)} />
            <Stat label="Cash expense" value={inr(a.totals.totalCashExpense)} tone="rose" />
            <Stat label="Avg / day" value={inr(a.totals.avgPerDay)} />
            <Stat label="Avg / plate" value={inr(a.totals.avgPerPlate)} />
            <Stat label="Voids" value={String(voids.count)} sub={inr(voids.total)} tone={voids.count ? 'rose' : undefined} />
            <Stat label="Discounts" value={inr(discounts)} />
          </section>

          <div className="card p-4">
            <div className="mb-2 flex items-center gap-3 text-sm">
              <span className="font-semibold text-stone-700">Daily revenue</span>
              <span className="text-xs text-stone-500"><span style={{ color: '#0f766e' }}>●</span> bills</span>
              <span className="text-xs text-stone-500"><span style={{ color: '#7c3aed' }}>●</span> pre-orders</span>
            </div>
            {a.daily.length ? (
              <ResponsiveContainer width="100%" height={230}>
                <LineChart data={a.daily}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" fontSize={11} tickFormatter={(d) => d.slice(5)} />
                  <YAxis fontSize={12} tickFormatter={(v) => '₹' + v} />
                  <Tooltip formatter={(v: number) => inr(v)} />
                  <Line type="monotone" dataKey="billRevenue" name="bills" stroke="#0f766e" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="preorder" name="pre-orders" stroke="#7c3aed" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <Empty>No sales in range</Empty>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="card p-4">
              <h2 className="mb-2 text-sm font-semibold text-stone-700">Peak hours</h2>
              {hourData.length ? (
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart data={hourData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" fontSize={10} interval={1} />
                    <YAxis fontSize={12} tickFormatter={(v) => '₹' + v} />
                    <Tooltip formatter={(v: number) => inr(v)} />
                    <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                      {hourData.map((h) => (
                        <Cell key={h.hour} fill={h.hour === peakHour ? '#ea580c' : '#0d9488'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <Empty>No data</Empty>
              )}
            </div>
            <div className="card p-4">
              <h2 className="mb-2 text-sm font-semibold text-stone-700">Monthly revenue</h2>
              {monthly.length ? (
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart data={monthly}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" fontSize={11} />
                    <YAxis fontSize={12} tickFormatter={(v) => '₹' + v} />
                    <Tooltip formatter={(v: number) => inr(v)} />
                    <Bar dataKey="revenue" fill="#0d9488" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <Empty>No data</Empty>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="card p-4">
              <h2 className="mb-2 text-sm font-semibold text-stone-700">By weekday</h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={weekdayData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" fontSize={11} />
                  <YAxis fontSize={12} tickFormatter={(v) => '₹' + v} />
                  <Tooltip formatter={(v: number) => inr(v)} />
                  <Bar dataKey="revenue" fill="#0d9488" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="card p-4">
              <h2 className="mb-2 text-sm font-semibold text-stone-700">Payment modes</h2>
              <div className="space-y-2">
                {(['cash', 'upi', 'card', 'other'] as const)
                  .filter((m) => a.byMode[m] > 0)
                  .map((m) => {
                    const p = Math.round((a.byMode[m] / modeTotal) * 100);
                    return (
                      <div key={m} className="text-sm">
                        <div className="mb-0.5 flex justify-between">
                          <span className="capitalize" style={{ color: MODE_HEX[m] }}>● {m}</span>
                          <span className="tabular-nums font-medium">{inr(a.byMode[m])} <span className="text-stone-400">· {p}%</span></span>
                        </div>
                        <div className="h-2 w-full rounded bg-stone-100">
                          <div className="h-2 rounded" style={{ width: `${p}%`, background: MODE_HEX[m] }} />
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="card p-4">
              <h2 className="mb-2 text-sm font-semibold text-stone-700">Top items</h2>
              {a.topItems.length ? (
                <table className="w-full text-sm">
                  <tbody>
                    {a.topItems.slice(0, 10).map((it) => (
                      <tr key={it.name} className="border-t border-stone-100">
                        <td className="py-1.5">{it.name}</td>
                        <td className="py-1.5 text-right tabular-nums text-stone-500">×{it.qty}</td>
                        <td className="py-1.5 text-right tabular-nums">{inr(it.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty>No items</Empty>
              )}
            </div>
            <div className="card p-4">
              <h2 className="mb-2 text-sm font-semibold text-stone-700">
                Slow movers <span className="font-normal text-stone-400">(lowest sellers)</span>
              </h2>
              {slowItems.length ? (
                <table className="w-full text-sm">
                  <tbody>
                    {slowItems.map((it) => (
                      <tr key={it.name} className="border-t border-stone-100">
                        <td className="py-1.5">{it.name}</td>
                        <td className="py-1.5 text-right tabular-nums text-stone-500">×{it.qty}</td>
                        <td className="py-1.5 text-right tabular-nums">{inr(it.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty>No items</Empty>
              )}
            </div>
          </div>

          <div className="card p-4">
            <h2 className="mb-2 text-sm font-semibold text-stone-700">Daily cash &amp; expense</h2>
            {a.cash.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-stone-500">
                    <tr>
                      <th className="p-1">Date</th>
                      <th className="p-1 text-right">Cash in</th>
                      <th className="p-1 text-right">Counted</th>
                      <th className="p-1 text-right">Expense</th>
                      <th className="p-1">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.cash.map((c) => (
                      <tr key={c.date} className="border-t border-stone-100">
                        <td className="p-1">{c.date.slice(5)}</td>
                        <td className="p-1 text-right tabular-nums text-emerald-700">{inr(c.collected)}</td>
                        <td className="p-1 text-right tabular-nums">{c.counted != null ? inr(c.counted) : <span className="text-stone-400">—</span>}</td>
                        <td className="p-1 text-right tabular-nums">
                          {c.expense == null ? <span className="text-stone-400">—</span> : (
                            <span className={c.expense > 0 ? 'text-rose-700' : 'text-emerald-700'}>{inr(c.expense)}</span>
                          )}
                        </td>
                        <td className="p-1 text-stone-500">{noteByDate.get(c.date) || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>No cash activity</Empty>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
  tone,
  delta,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  tone?: 'rose';
  delta?: number | null;
}) {
  const color = tone === 'rose' ? 'text-rose-700' : accent ? 'text-brand-700' : 'text-stone-800';
  return (
    <div className={`stat ${accent ? 'ring-1 ring-brand-200' : ''}`}>
      <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`mt-1 text-lg font-bold ${color}`}>{value}</div>
      {delta != null && (
        <div className={`text-xs font-medium ${delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}% vs prev
        </div>
      )}
      {sub && <div className="text-xs text-stone-400">{sub}</div>}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-8 text-center text-sm text-stone-400">{children}</div>;
}
