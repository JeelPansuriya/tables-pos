import React, { useEffect, useMemo, useState } from 'react';
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
import { api } from '../api';

type Overview = {
  from: string;
  to: string;
  daily: Array<{ date: string; bills: number; revenue: number; plates: number; preorder: number }>;
  byHour: Array<{ hour: number; bills: number; revenue: number }>;
  byWeekday: Array<{ dow: number; bills: number; revenue: number }>;
  byMode: Array<{ mode: string; amt: number }>;
  topItems: Array<{ name: string; qty: number; revenue: number }>;
  cash: Array<{ date: string; collected: number; counted: number | null; expense: number | null }>;
  totals: {
    revenue: number;
    billRevenue: number;
    preorderCollected: number;
    totalCollected: number;
    bills: number;
    plates: number;
    activeDays: number;
    avgPerDay: number;
    avgPerPlate: number;
    avgPlatesPerDay: number;
    avgDineMins: number | null;
    totalCashExpense: number;
    bestDay: { date: string; revenue: number } | null;
    peakHour: { hour: number; revenue: number } | null;
  };
};

const minsLabel = (m: number | null) =>
  m == null ? '—' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MODE_HEX: Record<string, string> = {
  cash: '#059669', // emerald
  upi: '#0284c7', // sky
  card: '#7c3aed', // violet
  other: '#78716c', // stone
};

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}
const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

export default function AnalyticsPage() {
  const today = ymd(new Date());
  const [to, setTo] = useState(today);
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return ymd(d);
  });
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    const r = await api.analytics.overview({ from, to });
    if (r?.ok) setData(r);
    setLoading(false);
  }
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  function preset(days: number) {
    const t = new Date();
    const f = new Date();
    f.setDate(f.getDate() - (days - 1));
    setFrom(ymd(f));
    setTo(ymd(t));
  }
  function thisMonth() {
    const n = new Date();
    setFrom(ymd(new Date(n.getFullYear(), n.getMonth(), 1)));
    setTo(ymd(n));
  }

  const peakHour = data?.totals.peakHour?.hour ?? -1;
  const weekdayData = useMemo(() => {
    const map = new Map((data?.byWeekday ?? []).map((w) => [w.dow, w]));
    return WEEKDAYS.map((label, dow) => ({
      label,
      revenue: map.get(dow)?.revenue ?? 0,
      bills: map.get(dow)?.bills ?? 0,
    }));
  }, [data]);

  const hourData = useMemo(
    () => (data?.byHour ?? []).map((h) => ({ ...h, label: hourLabel(h.hour) })),
    [data]
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold">Analytics</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
          <button className="btn-ghost border border-stone-300" onClick={() => preset(7)}>
            7 days
          </button>
          <button className="btn-ghost border border-stone-300" onClick={() => preset(30)}>
            30 days
          </button>
          <button className="btn-ghost border border-stone-300" onClick={thisMonth}>
            This month
          </button>
          <input type="date" className="input w-36" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          <span className="text-stone-400">→</span>
          <input type="date" className="input w-36" value={to} max={today} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {loading && !data ? (
        <div className="py-20 text-center text-stone-400">Loading analytics…</div>
      ) : data ? (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            <KPI
              label="Total collected"
              value={inr(data.totals.totalCollected)}
              sub={`bills ${inr(data.totals.billRevenue)} · pre-orders ${inr(data.totals.preorderCollected)}`}
              accent
            />
            <KPI label="Bill sales" value={inr(data.totals.billRevenue)} sub={`${data.totals.bills} bills`} />
            <KPI label="Pre-order collected" value={inr(data.totals.preorderCollected)} />
            <KPI label="Cash expense" value={inr(data.totals.totalCashExpense)} tone="rose" />
            <KPI label="Avg / day" value={inr(data.totals.avgPerDay)} />
            <KPI label="Avg / plate" value={inr(data.totals.avgPerPlate)} />
            <KPI label="Avg plates / day" value={String(data.totals.avgPlatesPerDay)} />
            <KPI label="Avg dine-in time" value={minsLabel(data.totals.avgDineMins)} sub="table open → closed" />
            <KPI label="Total plates" value={String(data.totals.plates)} />
            <KPI
              label="Best day"
              value={data.totals.bestDay ? inr(data.totals.bestDay.revenue) : '—'}
              sub={data.totals.bestDay?.date.slice(5)}
            />
            <KPI
              label="Peak hour"
              value={data.totals.peakHour ? hourLabel(data.totals.peakHour.hour) : '—'}
              sub={data.totals.peakHour ? inr(data.totals.peakHour.revenue) : undefined}
            />
          </section>

          <div className="card p-4">
            <div className="mb-2 flex items-center gap-3">
              <h2 className="text-sm font-semibold text-stone-700">Daily revenue</h2>
              <span className="flex items-center gap-1 text-xs text-stone-500">
                <span className="inline-block h-2 w-3 rounded-sm" style={{ background: '#0f766e' }} /> bills
              </span>
              <span className="flex items-center gap-1 text-xs text-stone-500">
                <span className="inline-block h-2 w-3 rounded-sm" style={{ background: '#7c3aed' }} /> pre-orders
              </span>
            </div>
            {data.daily.length ? (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={data.daily}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" fontSize={11} tickFormatter={(d) => d.slice(5)} />
                  <YAxis fontSize={12} tickFormatter={(v) => '₹' + v} />
                  <Tooltip formatter={(v: number) => inr(v)} />
                  <Line type="monotone" dataKey="revenue" name="bills" stroke="#0f766e" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="preorder" name="pre-orders" stroke="#7c3aed" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <Empty>No sales in range</Empty>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="card p-4">
              <h2 className="mb-2 text-sm font-semibold text-stone-700">
                Peak hours <span className="font-normal text-stone-400">(busiest highlighted)</span>
              </h2>
              {hourData.length ? (
                <ResponsiveContainer width="100%" height={220}>
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
              <h2 className="mb-2 text-sm font-semibold text-stone-700">By weekday</h2>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={weekdayData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" fontSize={11} />
                  <YAxis fontSize={12} tickFormatter={(v) => '₹' + v} />
                  <Tooltip formatter={(v: number) => inr(v)} />
                  <Bar dataKey="revenue" fill="#0d9488" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="card p-4">
              <h2 className="mb-2 text-sm font-semibold text-stone-700">Payment modes</h2>
              {data.byMode.length ? (
                <div className="space-y-2">
                  {data.byMode.map((m) => {
                    const tot = data.byMode.reduce((s, x) => s + x.amt, 0) || 1;
                    const pct = Math.round((m.amt / tot) * 100);
                    return (
                      <div key={m.mode} className="text-sm">
                        <div className="mb-0.5 flex justify-between">
                          <span className="capitalize" style={{ color: MODE_HEX[m.mode] ?? MODE_HEX.other }}>
                            ● {m.mode}
                          </span>
                          <span className="tabular-nums font-medium">
                            {inr(m.amt)} <span className="text-stone-400">· {pct}%</span>
                          </span>
                        </div>
                        <div className="h-2 w-full rounded bg-stone-100">
                          <div
                            className="h-2 rounded"
                            style={{ width: `${pct}%`, background: MODE_HEX[m.mode] ?? MODE_HEX.other }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <Empty>No payments</Empty>
              )}
            </div>

            <div className="card p-4">
              <h2 className="mb-2 text-sm font-semibold text-stone-700">Top items</h2>
              {data.topItems.length ? (
                <table className="w-full text-sm">
                  <tbody>
                    {data.topItems.map((it) => (
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
            <h2 className="mb-2 text-sm font-semibold text-stone-700">
              Daily cash &amp; expense
              <span className="ml-2 font-normal text-stone-400">
                cash taken in vs counted close · difference = cash paid out
              </span>
            </h2>
            {data.cash.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-stone-500">
                    <tr>
                      <th className="p-1">Date</th>
                      <th className="p-1 text-right">Cash in</th>
                      <th className="p-1 text-right">Counted close</th>
                      <th className="p-1 text-right">Cash expense</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.cash.map((c) => (
                      <tr key={c.date} className="border-t border-stone-100">
                        <td className="p-1">{c.date.slice(5)}</td>
                        <td className="p-1 text-right tabular-nums text-emerald-700">{inr(c.collected)}</td>
                        <td className="p-1 text-right tabular-nums">
                          {c.counted != null ? inr(c.counted) : <span className="text-stone-400">—</span>}
                        </td>
                        <td className="p-1 text-right tabular-nums">
                          {c.expense == null ? (
                            <span className="text-stone-400">—</span>
                          ) : (
                            <span className={c.expense > 0 ? 'text-rose-700' : 'text-emerald-700'}>
                              {inr(c.expense)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-stone-500">
                  Expense needs both the day's and the previous day's counted close (enter it on the
                  Day Summary page). Total cash expense in range: {inr(data.totals.totalCashExpense)}.
                </p>
              </div>
            ) : (
              <Empty>No cash activity</Empty>
            )}
          </div>
        </>
      ) : (
        <Empty>Could not load analytics</Empty>
      )}
    </div>
  );
}

function KPI({
  label,
  value,
  sub,
  accent,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  accent?: boolean;
  tone?: 'rose';
}) {
  const valueColor = tone === 'rose' ? 'text-rose-700' : accent ? 'text-brand-700' : 'text-stone-800';
  return (
    <div className={`card p-3 ${accent ? 'ring-1 ring-brand-200' : ''}`}>
      <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`mt-1 text-xl font-bold ${valueColor}`}>{value}</div>
      {sub && <div className="text-xs text-stone-400">{sub}</div>}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-10 text-center text-sm text-stone-400">{children}</div>;
}
