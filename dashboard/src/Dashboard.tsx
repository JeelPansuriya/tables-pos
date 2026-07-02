import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
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
} from 'recharts';
import { supabase, table, TIMEZONE } from './supabase';
import type { Bill, BillItem, BillPayment, Preorder, PreorderPayment } from './types';
import { daySummary, dailyTrend, dayKeyOffset, todayKey, inr, bizDay } from './analytics';
import AnalyticsView from './AnalyticsView';

// The Day tab only needs the last 14 days (the trend window); deeper history is
// the Analytics tab's job. Keeping this small keeps each read cheap.
const WINDOW_DAYS = 14;

function tsMs(ts: string | null): number {
  if (!ts) return 0;
  const iso = ts.includes('T') ? ts : ts.replace(' ', 'T');
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? iso : iso + 'Z');
  return isNaN(d.getTime()) ? 0 : d.getTime();
}
function agoLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

// Clock time (e.g. "08:42 pm") in the restaurant timezone, from a UTC timestamp.
const clockFmt = new Intl.DateTimeFormat('en-IN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
  timeZone: TIMEZONE,
});
function fmtClock(ts: string | null): string {
  const ms = tsMs(ts);
  return ms ? clockFmt.format(new Date(ms)) : '—';
}
const MODE_CLS: Record<string, string> = {
  cash: 'bg-emerald-100 text-emerald-800',
  upi: 'bg-sky-100 text-sky-800',
  card: 'bg-violet-100 text-violet-800',
  other: 'bg-stone-100 text-stone-700',
};

/** UTC cutoff string ("YYYY-MM-DD 00:00:00") for the fetch window. */
function cutoffIso(days: number): string {
  const d = new Date(Date.now() - days * 86400000);
  return d.toISOString().slice(0, 10) + ' 00:00:00';
}

async function chunkedIn<T>(
  tbl: string,
  cols: string,
  column: string,
  ids: number[]
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);
    const { data, error } = await supabase.from(tbl).select(cols).in(column, slice);
    if (error) throw error;
    if (data) out.push(...(data as T[]));
  }
  return out;
}

type Data = {
  bills: Bill[];
  payments: BillPayment[];
  items: BillItem[];
  preorders: Preorder[];
  preorderPayments: PreorderPayment[];
};

export default function Dashboard({ session }: { session: Session }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(todayKey());
  const [view, setView] = useState<'day' | 'analytics'>('day');
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [, forceTick] = useState(0); // re-render so "x min ago" stays fresh

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cutoff = cutoffIso(WINDOW_DAYS);
      const [billsRes, payRes, preRes, prePayRes] = await Promise.all([
        supabase
          .from(table('bills'))
          .select(
            'id,token_no,type,status,table_label,meal_type,customer_name,subtotal,discount,total,plates,opened_at,closed_at,cancelled_at,cancel_reason'
          )
          .gte('opened_at', cutoff)
          .limit(10000),
        supabase
          .from(table('bill_payments'))
          .select('id,bill_id,amount,mode,received_at')
          .gte('received_at', cutoff)
          .limit(10000),
        supabase
          .from(table('preorders'))
          .select('id,customer_name,for_date,total,advance_paid,balance_due,status,created_at')
          .gte('created_at', cutoff)
          .limit(10000),
        supabase
          .from(table('preorder_payments'))
          .select('id,preorder_id,amount,mode,received_at')
          .gte('received_at', cutoff)
          .limit(10000),
      ]);
      for (const r of [billsRes, payRes, preRes, prePayRes]) {
        if (r.error) throw r.error;
      }
      const bills = (billsRes.data ?? []) as Bill[];
      const items = await chunkedIn<BillItem>(
        table('bill_items'),
        'id,bill_id,name,qty,unit_price,total',
        'bill_id',
        bills.map((b) => b.id)
      );
      setData({
        bills,
        payments: (payRes.data ?? []) as BillPayment[],
        items,
        preorders: (preRes.data ?? []) as Preorder[],
        preorderPayments: (prePayRes.data ?? []) as PreorderPayment[],
      });
      setLastLoadedAt(Date.now());
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Live counter check: while viewing today, refresh every 30 min and ONLY while
  // the tab is visible — a backgrounded/sleeping phone fetches nothing. With
  // several people using the dashboard this keeps total reads tiny and well
  // inside Supabase's free egress. The tab also refreshes the moment it's
  // reopened, and there's always the manual Refresh button for "right now".
  const REFRESH_MS = 30 * 60 * 1000;
  const isToday = date === todayKey();
  useEffect(() => {
    if (view !== 'day' || !isToday) return;
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    const refresh = setInterval(refreshIfVisible, REFRESH_MS);
    const tick = setInterval(() => forceTick((n) => n + 1), 60000);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      clearInterval(refresh);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [view, isToday, load]);

  const summary = useMemo(() => {
    if (!data) return null;
    return daySummary(date, data.bills, data.payments, data.items, data.preorderPayments);
  }, [data, date]);

  const trend = useMemo(() => {
    if (!data) return [];
    return dailyTrend(data.bills, data.payments, data.preorderPayments, dayKeyOffset(13));
  }, [data]);

  const pendingPreorders = useMemo(
    () => (data ? data.preorders.filter((p) => p.status !== 'fulfilled' && p.status !== 'cancelled') : []),
    [data]
  );

  const modeData = summary
    ? (['cash', 'upi', 'card', 'other'] as const)
        .map((m) => ({ mode: m.toUpperCase(), amount: Math.round(summary.byMode[m] || 0) }))
        .filter((d) => d.amount > 0)
    : [];

  // Closed bills for the selected day, newest close first, with their pay modes.
  const todaysBills = useMemo(() => {
    if (!data) return [];
    const modeByBill = new Map<number, Set<string>>();
    for (const p of data.payments) {
      if (!modeByBill.has(p.bill_id)) modeByBill.set(p.bill_id, new Set());
      modeByBill.get(p.bill_id)!.add(p.mode);
    }
    return data.bills
      .filter((b) => b.status === 'closed' && bizDay(b.closed_at) === date)
      .map((b) => ({ ...b, modes: [...(modeByBill.get(b.id) ?? [])] }))
      .sort((a, b) => (b.closed_at || '').localeCompare(a.closed_at || ''));
  }, [data, date]);

  // Voided bills (once closed, later cancelled — they carry a token) for the day.
  const voidedBills = useMemo(() => {
    if (!data) return [];
    return data.bills
      .filter(
        (b) =>
          b.status === 'cancelled' &&
          b.token_no != null &&
          bizDay(b.cancelled_at || b.closed_at) === date
      )
      .sort((a, b) => (b.cancelled_at || '').localeCompare(a.cancelled_at || ''));
  }, [data, date]);

  return (
    <div className="mx-auto max-w-5xl p-3 sm:p-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-brand-800">Sales Dashboard</h1>
          <p className="text-xs text-stone-500">
            {session.user.email} · times in {TIMEZONE}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-stone-300 bg-white p-0.5 text-sm">
            {(['day', 'analytics'] as const).map((v) => (
              <button
                key={v}
                className={`rounded px-3 py-1 capitalize ${
                  view === v ? 'bg-brand-700 text-white' : 'text-stone-700'
                }`}
                onClick={() => setView(v)}
              >
                {v === 'day' ? 'Day' : 'Analytics'}
              </button>
            ))}
          </div>
          {view === 'day' && (
            <>
              <input
                type="date"
                className="input"
                value={date}
                max={todayKey()}
                onChange={(e) => setDate(e.target.value)}
              />
              <button className="btn" onClick={load} disabled={loading}>
                {loading ? '…' : 'Refresh'}
              </button>
            </>
          )}
          <button
            className="rounded-md border border-stone-300 px-3 py-2 text-sm"
            onClick={() => supabase.auth.signOut()}
          >
            Sign out
          </button>
        </div>
      </header>

      {view === 'analytics' && <AnalyticsView />}

      {view === 'day' && isToday && lastLoadedAt && (
        (() => {
          const todayClosed = (data?.bills ?? []).filter(
            (b) => b.status === 'closed' && bizDay(b.closed_at) === todayKey()
          );
          const lastSaleMs = todayClosed.reduce((mx, b) => Math.max(mx, tsMs(b.closed_at)), 0);
          return (
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              <span className="flex items-center gap-1 font-medium">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                Auto-updates every 30 min · tap Refresh for now
              </span>
              <span>Updated {agoLabel(Date.now() - lastLoadedAt)}</span>
              <span>
                Last sale: {lastSaleMs ? agoLabel(Date.now() - lastSaleMs) : 'none today'}
              </span>
            </div>
          );
        })()
      )}

      {view === 'day' && error && (
        <div className="mb-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
          <div className="mt-1 text-xs text-rose-500">
            If this says permission denied, add the SELECT policies for authenticated users (see
            dashboard README).
          </div>
        </div>
      )}

      {view === 'day' &&
        (loading && !data ? (
        <div className="py-20 text-center text-stone-400">Loading sales…</div>
      ) : summary ? (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Collected" value={inr(summary.collected)} accent />
            <Stat label="Bill sales" value={inr(summary.billSales)} />
            <Stat label="Bills" value={String(summary.billCount)} />
            <Stat label="Plates" value={summary.plates.toFixed(1)} />
          </section>

          <section className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="card p-4">
              <h2 className="mb-2 text-sm font-semibold text-stone-700">Payment modes — {date}</h2>
              {modeData.length ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={modeData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="mode" fontSize={12} />
                    <YAxis fontSize={12} />
                    <Tooltip formatter={(v: number) => inr(v)} />
                    <Bar dataKey="amount" fill="#0d9488" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <Empty>No payments this day</Empty>
              )}
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <Row k="Cash" v={inr(summary.byMode.cash)} />
                <Row k="UPI" v={inr(summary.byMode.upi)} />
                <Row k="Pre-order advances" v={inr(summary.preorderAdvance)} />
                <Row k="Cancelled" v={`${summary.cancelledCount} · ${inr(summary.cancelledTotal)}`} />
              </div>
            </div>

            <div className="card p-4">
              <h2 className="mb-2 text-sm font-semibold text-stone-700">Last 14 days</h2>
              {trend.length ? (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={trend}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" fontSize={11} tickFormatter={(d) => d.slice(5)} />
                    <YAxis fontSize={12} />
                    <Tooltip formatter={(v: number) => inr(v)} />
                    <Line type="monotone" dataKey="sales" stroke="#0f766e" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <Empty>No sales in range</Empty>
              )}
            </div>
          </section>

          <section className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="card p-4">
              <h2 className="mb-2 text-sm font-semibold text-stone-700">Top items — {date}</h2>
              {summary.topItems.length ? (
                <table className="w-full text-sm">
                  <tbody>
                    {summary.topItems.map((it) => (
                      <tr key={it.name} className="border-t border-stone-100">
                        <td className="py-1.5">{it.name}</td>
                        <td className="py-1.5 text-right tabular-nums text-stone-500">×{it.qty}</td>
                        <td className="py-1.5 text-right tabular-nums">{inr(it.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty>No items sold</Empty>
              )}
            </div>

            <div className="card p-4">
              <h2 className="mb-2 text-sm font-semibold text-stone-700">
                Open pre-orders ({pendingPreorders.length})
              </h2>
              {pendingPreorders.length ? (
                <table className="w-full text-sm">
                  <tbody>
                    {[...pendingPreorders]
                      .sort((a, b) => (a.for_date || '').localeCompare(b.for_date || ''))
                      .slice(0, 12)
                      .map((p) => {
                        const due =
                          p.for_date === todayKey()
                            ? { label: 'Today', cls: 'bg-amber-200 text-amber-900' }
                            : p.for_date === dayKeyOffset(-1)
                            ? { label: 'Tomorrow', cls: 'bg-sky-200 text-sky-900' }
                            : null;
                        return (
                          <tr key={p.id} className="border-t border-stone-100">
                            <td className="py-1.5">{p.customer_name}</td>
                            <td className="py-1.5 text-stone-500">
                              {due ? (
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${due.cls}`}>
                                  {due.label}
                                </span>
                              ) : (
                                p.for_date
                              )}
                            </td>
                            <td
                              className={`py-1.5 text-right tabular-nums ${
                                p.balance_due > 0 ? 'font-medium text-rose-700' : 'text-emerald-700'
                              }`}
                            >
                              {p.balance_due > 0 ? `due ${inr(p.balance_due)}` : 'paid'}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              ) : (
                <Empty>None pending</Empty>
              )}
            </div>
          </section>

          <section className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="card p-4">
              <h2 className="mb-2 text-sm font-semibold text-stone-700">
                Bills — {date} ({todaysBills.length})
              </h2>
              {todaysBills.length ? (
                <div className="max-h-96 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-stone-400">
                      <tr>
                        <th className="py-1">Token</th>
                        <th className="py-1">Closed</th>
                        <th className="py-1">Mode</th>
                        <th className="py-1 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {todaysBills.map((b) => (
                        <tr key={b.id} className="border-t border-stone-100">
                          <td className="py-1.5">{b.token_no ?? '—'}</td>
                          <td className="py-1.5 text-stone-500">{fmtClock(b.closed_at)}</td>
                          <td className="py-1.5">
                            {b.modes.map((m) => (
                              <span
                                key={m}
                                className={`mr-1 rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${
                                  MODE_CLS[m] ?? MODE_CLS.other
                                }`}
                              >
                                {m}
                              </span>
                            ))}
                          </td>
                          <td className="py-1.5 text-right tabular-nums">{inr(b.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>No bills yet</Empty>
              )}
            </div>

            <div className="card p-4">
              <h2 className="mb-2 text-sm font-semibold text-stone-700">
                Voided bills ({voidedBills.length})
              </h2>
              {voidedBills.length ? (
                <div className="max-h-96 overflow-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {voidedBills.map((b) => (
                        <tr key={b.id} className="border-t border-stone-100">
                          <td className="py-1.5">{b.token_no ?? '—'}</td>
                          <td className="py-1.5 text-stone-500">
                            {fmtClock(b.cancelled_at || b.closed_at)}
                          </td>
                          <td className="py-1.5 text-rose-700">{b.cancel_reason || '—'}</td>
                          <td className="py-1.5 text-right tabular-nums text-rose-700">
                            −{inr(b.total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>None voided</Empty>
              )}
            </div>
          </section>

          <p className="mt-4 text-center text-xs text-stone-400">
            Showing data synced from the POS · last {WINDOW_DAYS} days · {data?.bills.length ?? 0} bills
            loaded · today is {bizDay(new Date().toISOString())}
          </p>
        </>
      ) : null)}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`stat ${accent ? 'ring-1 ring-brand-200' : ''}`}>
      <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`mt-1 text-xl font-bold ${accent ? 'text-brand-700' : 'text-stone-800'}`}>
        {value}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-stone-500">{k}</span>
      <span className="tabular-nums">{v}</span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-8 text-center text-sm text-stone-400">{children}</div>;
}
