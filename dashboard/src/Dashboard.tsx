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

const WINDOW_DAYS = 30;

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
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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

  return (
    <div className="mx-auto max-w-5xl p-3 sm:p-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-brand-800">Sales Dashboard</h1>
          <p className="text-xs text-stone-500">
            {session.user.email} · times in {TIMEZONE}
          </p>
        </div>
        <div className="flex items-center gap-2">
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
          <button
            className="rounded-md border border-stone-300 px-3 py-2 text-sm"
            onClick={() => supabase.auth.signOut()}
          >
            Sign out
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
          <div className="mt-1 text-xs text-rose-500">
            If this says permission denied, add the SELECT policies for authenticated users (see
            dashboard README).
          </div>
        </div>
      )}

      {loading && !data ? (
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
                    {pendingPreorders.slice(0, 10).map((p) => (
                      <tr key={p.id} className="border-t border-stone-100">
                        <td className="py-1.5">{p.customer_name}</td>
                        <td className="py-1.5 text-stone-500">{p.for_date}</td>
                        <td className="py-1.5 text-right tabular-nums text-amber-700">
                          {p.balance_due > 0 ? `due ${inr(p.balance_due)}` : 'paid'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty>None pending</Empty>
              )}
            </div>
          </section>

          <p className="mt-4 text-center text-xs text-stone-400">
            Showing data synced from the POS · last {WINDOW_DAYS} days · {data?.bills.length ?? 0} bills
            loaded · today is {bizDay(new Date().toISOString())}
          </p>
        </>
      ) : null}
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
