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
import { supabase, TIMEZONE } from './supabase';
import { inr, todayKey } from './analytics';

// The analytics data is aggregated server-side by the v2_analytics RPC, so any
// range returns a small payload regardless of volume (see dashboard/analytics-rpc.sql).
type RpcResult = {
  from: string;
  to: string;
  daily: Array<{ date: string; billRevenue: number; preorder: number; bills: number; plates: number }>;
  byHour: Array<{ hour: number; bills: number; revenue: number }>;
  byWeekday: Array<{ dow: number; bills: number; revenue: number }>;
  byMode: Array<{ mode: string; amt: number }>;
  topItems: Array<{ name: string; qty: number; revenue: number }>;
  slowItems: Array<{ name: string; qty: number; revenue: number }>;
  cashDaily: Array<{ date: string; collected: number }>;
  counts: Array<{ date: string; counted: number; note: string | null }>;
  totals: {
    billRevenue: number;
    plates: number;
    bills: number;
    preorderCollected: number;
    activeDays: number;
    voidsCount: number;
    voidsTotal: number;
    discounts: number;
    avgDineMins: number | null;
    bestDay: { date: string; revenue: number } | null;
    peakHour: { hour: number; revenue: number } | null;
    prevTotalCollected: number;
    mtdTotalCollected: number;
  };
};

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
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;
const monthLabel = (m: string) =>
  new Date(m + '-01T00:00:00').toLocaleString('en-US', { month: 'short', year: '2-digit' });
const MODE_HEX: Record<string, string> = { cash: '#059669', upi: '#0284c7', card: '#7c3aed', other: '#78716c' };
const pct = (cur: number, prev: number): number | null => (prev > 0 ? +(((cur - prev) / prev) * 100).toFixed(1) : null);
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function AnalyticsView() {
  const [to, setTo] = useState(todayKey());
  // Default to the current month so the owner lands on this month's revenue.
  const [from, setFrom] = useState(() => todayKey().slice(0, 8) + '01');
  const [res, setRes] = useState<RpcResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.rpc('v2_analytics', { p_from: from, p_to: to, p_tz: TIMEZONE });
      if (error) throw error;
      setRes(data as RpcResult);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const t = res?.totals;
  const totalCollected = t ? +(t.billRevenue + t.preorderCollected).toFixed(2) : 0;
  const growth = t ? pct(totalCollected, t.prevTotalCollected) : null;
  const avgPerDay = t && t.activeDays ? +(t.billRevenue / t.activeDays).toFixed(2) : 0;
  const avgPerPlate = t && t.plates ? +(t.billRevenue / t.plates).toFixed(2) : 0;
  const avgPlatesPerDay = t && t.activeDays ? +(t.plates / t.activeDays).toFixed(1) : 0;

  const byMode = useMemo(() => {
    const m: Record<string, number> = { cash: 0, upi: 0, card: 0, other: 0 };
    (res?.byMode ?? []).forEach((x) => (m[x.mode] = x.amt));
    return m;
  }, [res]);

  // Daily cash + counted close + expense (baseline: no expense on the first day
  // counted, since there's no previous close to compare).
  const cash = useMemo(() => {
    if (!res) return [] as Array<{ date: string; collected: number; counted: number | null; expense: number | null }>;
    const coll = new Map(res.cashDaily.map((c) => [c.date, c.collected]));
    const counted = new Map(res.counts.map((c) => [c.date, c.counted]));
    const dates = new Set<string>();
    res.cashDaily.forEach((c) => dates.add(c.date));
    res.counts.forEach((c) => {
      if (c.date >= from) dates.add(c.date);
    });
    return [...dates].sort().map((date) => {
      const collected = +(coll.get(date) ?? 0).toFixed(2);
      const c = counted.has(date) ? counted.get(date)! : null;
      const prev = counted.has(addDays(date, -1)) ? counted.get(addDays(date, -1))! : null;
      const expense = c != null && prev != null ? +(prev + collected - c).toFixed(2) : null;
      return { date, collected, counted: c, expense };
    });
  }, [res, from]);
  const totalCashExpense = +cash.reduce((s, c) => s + (c.expense ?? 0), 0).toFixed(2);
  const noteByDate = new Map((res?.counts ?? []).map((c) => [c.date, c.note || '']));

  const monthly = useMemo(() => {
    const m = new Map<string, number>();
    (res?.daily ?? []).forEach((d) => {
      const k = d.date.slice(0, 7);
      m.set(k, (m.get(k) ?? 0) + d.billRevenue);
    });
    return [...m.entries()].sort().map(([month, rev]) => ({ month, label: monthLabel(month), revenue: Math.round(rev) }));
  }, [res]);

  const peakHour = t?.peakHour?.hour ?? -1;
  const hourData = (res?.byHour ?? []).map((h) => ({ ...h, label: hourLabel(h.hour) }));
  const weekdayData = WEEKDAYS.map((label, dow) => ({
    label,
    revenue: (res?.byWeekday ?? []).find((x) => x.dow === dow)?.revenue ?? 0,
  }));
  const modeTotal = (Object.values(byMode) as number[]).reduce((s, n) => s + n, 0) || 1;
  const rangeLen = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1;
  const prevFrom = addDays(from, -rangeLen);
  const prevTo = addDays(from, -1);

  // ---- Owner headline: month forecast + auto-insights (all client-side from the
  // aggregate the RPC already returned — no extra pull). ----
  const avgTicket = t && t.bills ? Math.round(t.billRevenue / t.bills) : 0;
  const tk = todayKey();
  const dayOfMonth = parseInt(tk.slice(8, 10), 10);
  const daysInMonth = new Date(parseInt(tk.slice(0, 4), 10), parseInt(tk.slice(5, 7), 10), 0).getDate();
  // Run-rate projection for the current month from month-to-date collections.
  const projectedMonth = t && dayOfMonth ? Math.round((t.mtdTotalCollected / dayOfMonth) * daysInMonth) : 0;
  // Busiest / quietest weekday within the selected range (ignore days with none).
  const wkNonZero = weekdayData.filter((w) => w.revenue > 0);
  const bestWeekday = wkNonZero.length ? wkNonZero.reduce((a, b) => (b.revenue > a.revenue ? b : a)) : null;
  const slowWeekday = wkNonZero.length ? wkNonZero.reduce((a, b) => (b.revenue < a.revenue ? b : a)) : null;
  const dominantMode = (Object.entries(byMode) as Array<[string, number]>)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])[0];

  const insights = useMemo(() => {
    if (!t) return [] as string[];
    const out: string[] = [];
    if (growth != null)
      out.push(`Collections are ${growth >= 0 ? 'up' : 'down'} ${Math.abs(growth)}% vs the previous ${rangeLen}-day period.`);
    if (projectedMonth > 0)
      out.push(`On the current run-rate, this month is tracking to about ${inr(projectedMonth)} (${dayOfMonth}/${daysInMonth} days in).`);
    if (bestWeekday) out.push(`${bestWeekday.label} is your strongest weekday${slowWeekday && slowWeekday.label !== bestWeekday.label ? `; ${slowWeekday.label} the quietest` : ''}.`);
    if (t.peakHour) out.push(`Peak trading hour is ${hourLabel(t.peakHour.hour)} (${inr(t.peakHour.revenue)}).`);
    if (dominantMode) out.push(`${dominantMode[0].toUpperCase()} is ${Math.round((dominantMode[1] / modeTotal) * 100)}% of collections.`);
    if (avgTicket) out.push(`Average bill is ${inr(avgTicket)} across ${t.bills} bills.`);
    if (t.voidsCount) out.push(`${t.voidsCount} void(s) worth ${inr(t.voidsTotal)} — worth a quick check.`);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, growth, projectedMonth, bestWeekday?.label, slowWeekday?.label, dominantMode?.[0]]);

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
      <div className="no-print flex flex-wrap items-center justify-end gap-2 text-sm">
        <button className="rounded-md border border-stone-300 px-3 py-1.5" onClick={() => preset(7)}>7d</button>
        <button className="rounded-md border border-stone-300 px-3 py-1.5" onClick={() => preset(30)}>30d</button>
        <button className="rounded-md border border-stone-300 px-3 py-1.5" onClick={thisMonth}>Month</button>
        <input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        <span className="text-stone-400">→</span>
        <input type="date" className="input" value={to} max={todayKey()} onChange={(e) => setTo(e.target.value)} />
        <button
          className="rounded-md border border-stone-300 px-3 py-1.5"
          onClick={() => window.print()}
          title="Save or print this report as a PDF"
        >
          ⤓ PDF
        </button>
      </div>
      <div className="hidden items-baseline justify-between print:flex">
        <h1 className="text-lg font-bold">Analytics — {from} to {to}</h1>
      </div>

      {error && <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      {loading && !res ? (
        <div className="py-16 text-center text-stone-400">Loading analytics…</div>
      ) : res && t ? (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Total collected" value={inr(totalCollected)} accent
              sub={`bills ${inr(t.billRevenue)} · pre ${inr(t.preorderCollected)}`} delta={growth} />
            <Stat label="vs prev period" value={inr(t.prevTotalCollected)} sub={`${prevFrom.slice(5)}–${prevTo.slice(5)}`} />
            <Stat label="Month-to-date" value={inr(t.mtdTotalCollected)} />
            <Stat label="Cash expense" value={inr(totalCashExpense)} tone="rose" />
            <Stat label="Avg / day" value={inr(avgPerDay)} />
            <Stat label="Avg / plate" value={inr(avgPerPlate)} />
            <Stat label="Avg plates / day" value={String(avgPlatesPerDay)} />
            <Stat label="Avg dine-in time" value={t.avgDineMins == null ? '—' : t.avgDineMins < 60 ? `${t.avgDineMins}m` : `${Math.floor(t.avgDineMins / 60)}h ${t.avgDineMins % 60}m`} sub="open → closed" />
            <Stat label="Total plates" value={String(t.plates)} />
            <Stat label="Voids" value={String(t.voidsCount)} sub={inr(t.voidsTotal)} tone={t.voidsCount ? 'rose' : undefined} />
            <Stat label="Discounts" value={inr(t.discounts)} />
            <Stat label="Best day" value={t.bestDay ? inr(t.bestDay.revenue) : '—'} sub={t.bestDay?.date.slice(5)} />
            <Stat label="Avg bill" value={inr(avgTicket)} sub={`${t.bills} bills`} />
          </section>

          {/* Owner headline: forecast + plain-language insights */}
          <section className="grid grid-cols-1 gap-3 lg:grid-cols-[18rem_1fr]">
            <div className="stat ring-1 ring-brand-200">
              <div className="text-xs uppercase tracking-wide text-stone-500">This month — projected</div>
              <div className="mt-1 text-2xl font-bold text-brand-700">{inr(projectedMonth)}</div>
              <div className="text-xs text-stone-500">
                {inr(t.mtdTotalCollected)} so far · {dayOfMonth}/{daysInMonth} days · run-rate
              </div>
              <div className="mt-2 h-2 w-full rounded bg-stone-100" title={`${Math.round((dayOfMonth / daysInMonth) * 100)}% of the month elapsed`}>
                <div className="h-2 rounded bg-brand-500" style={{ width: `${Math.round((dayOfMonth / daysInMonth) * 100)}%` }} />
              </div>
            </div>
            <div className="card p-4">
              <h2 className="mb-2 text-sm font-semibold text-stone-700">Insights</h2>
              {insights.length ? (
                <ul className="space-y-1.5 text-sm text-stone-700">
                  {insights.map((line, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-brand-500">•</span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>Not enough data yet</Empty>
              )}
            </div>
          </section>

          <div className="card p-4">
            <div className="mb-2 flex items-center gap-3 text-sm">
              <span className="font-semibold text-stone-700">Daily revenue</span>
              <span className="text-xs text-stone-500"><span style={{ color: '#0f766e' }}>●</span> bills</span>
              <span className="text-xs text-stone-500"><span style={{ color: '#7c3aed' }}>●</span> pre-orders</span>
            </div>
            {res.daily.length ? (
              <ResponsiveContainer width="100%" height={230}>
                <LineChart data={res.daily}>
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
                  .filter((m) => byMode[m] > 0)
                  .map((m) => {
                    const p = Math.round((byMode[m] / modeTotal) * 100);
                    return (
                      <div key={m} className="text-sm">
                        <div className="mb-0.5 flex justify-between">
                          <span className="capitalize" style={{ color: MODE_HEX[m] }}>● {m}</span>
                          <span className="tabular-nums font-medium">{inr(byMode[m])} <span className="text-stone-400">· {p}%</span></span>
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
              {res.topItems.length ? (
                <table className="w-full text-sm">
                  <tbody>
                    {res.topItems.slice(0, 10).map((it) => (
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
              {res.slowItems.length ? (
                <table className="w-full text-sm">
                  <tbody>
                    {res.slowItems.map((it) => (
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
            {cash.length ? (
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
                    {cash.map((c) => (
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
      ) : (
        <Empty>No data</Empty>
      )}
    </div>
  );
}

function Stat({ label, value, sub, accent, tone, delta }: { label: string; value: string; sub?: string; accent?: boolean; tone?: 'rose'; delta?: number | null }) {
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
