import React, { useEffect, useState } from 'react';
import { api } from '../api';

type Summary = {
  date: string;
  totals: { bills: number; revenue: number; plates: number };
  byMode: Array<{ mode: string; amt: number }>;
  byMeal: Array<{ meal_type: string; bills: number; plates: number; revenue: number }>;
  items: Array<{ name: string; qty: number; revenue: number }>;
  preorderPaid: number;
  totalCollected: number;
  cancelled: Array<{
    id: number;
    token_no: number | null;
    total: number;
    cancel_reason: string | null;
    cancelled_at: string | null;
  }>;
  cancelledTotal: number;
};

// Local calendar date as YYYY-MM-DD (toISOString is UTC and shifts the day in
// +offset timezones, which broke the Prev/Next buttons near midnight).
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

const MODE_COLORS: Record<string, string> = {
  cash: 'bg-emerald-100 text-emerald-800',
  upi: 'bg-sky-100 text-sky-800',
  card: 'bg-violet-100 text-violet-800',
  other: 'bg-stone-100 text-stone-700',
};

export default function DaySummaryPage() {
  const today = ymd(new Date());
  const [date, setDate] = useState(today);
  const [data, setData] = useState<Summary | null>(null);
  const [printMsg, setPrintMsg] = useState<string | null>(null);
  const [closeDayOpen, setCloseDayOpen] = useState(false);

  async function refresh() {
    const r = await api.daySummary(date);
    if (r?.ok) setData(r);
  }
  useEffect(() => {
    refresh();
  }, [date]);

  async function print() {
    const r = await api.daySummaryPrint(date);
    setPrintMsg(r?.ok ? 'Sent to printer.' : r?.error || 'Print failed');
    setTimeout(() => setPrintMsg(null), 3000);
  }

  function shiftDay(days: number) {
    const d = new Date(date + 'T00:00:00'); // local midnight
    d.setDate(d.getDate() + days);
    setDate(ymd(d)); // format in local time — no UTC drift
  }

  if (!data) return <div>Loading…</div>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold">Day Summary</h1>
        <div className="ml-auto flex items-center gap-2">
          <button className="btn-ghost border border-stone-300" onClick={() => shiftDay(-1)}>
            ← Prev
          </button>
          <input
            type="date"
            className="input w-40"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <button
            className="btn-ghost border border-stone-300"
            onClick={() => shiftDay(1)}
            disabled={date >= today}
          >
            Next →
          </button>
          <button className="btn-ghost border border-stone-300" onClick={() => setDate(today)}>
            Today
          </button>
          <button className="btn-ghost border border-stone-300" onClick={print}>
            Print
          </button>
          {date === today && (
            <button className="btn-primary" onClick={() => setCloseDayOpen(true)}>
              Close day
            </button>
          )}
        </div>
      </div>

      {closeDayOpen && (
        <CloseDayModal
          date={today}
          collected={data.totalCollected ?? data.totals.revenue}
          onClose={() => setCloseDayOpen(false)}
          onDone={(m) => {
            setCloseDayOpen(false);
            setPrintMsg(m);
            setTimeout(() => setPrintMsg(null), 4000);
            refresh();
          }}
        />
      )}
      {printMsg && (
        <div className="rounded-md bg-stone-100 px-3 py-2 text-sm text-stone-700">{printMsg}</div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KPI label="Bills" value={data.totals.bills} />
        <KPI label="Bill revenue" value={`₹${data.totals.revenue.toFixed(2)}`} />
        <KPI label="Plates" value={data.totals.plates.toFixed(1)} />
        <KPI label="Pre-order payments" value={`₹${(data.preorderPaid ?? 0).toFixed(2)}`} />
        <KPI label="Total collected" value={`₹${(data.totalCollected ?? data.totals.revenue).toFixed(2)}`} />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="card p-3">
          <div className="mb-2 text-sm font-semibold">
            By payment mode <span className="font-normal text-stone-500">(bills + advances)</span>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-stone-500">
              <tr>
                <th className="p-1">Mode</th>
                <th className="p-1">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.byMode.map((m) => (
                <tr key={m.mode} className="border-t border-stone-100">
                  <td className="p-1">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${
                        MODE_COLORS[m.mode] ?? MODE_COLORS.other
                      }`}
                    >
                      {m.mode}
                    </span>
                  </td>
                  <td className="p-1 font-medium">₹{m.amt.toFixed(2)}</td>
                </tr>
              ))}
              {data.byMode.length === 0 && (
                <tr>
                  <td colSpan={2} className="p-2 text-stone-500">
                    No payments yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="card p-3">
          <div className="mb-2 text-sm font-semibold">By meal</div>
          <table className="w-full text-sm">
            <thead className="text-left text-stone-500">
              <tr>
                <th className="p-1">Meal</th>
                <th className="p-1">Plates</th>
                <th className="p-1">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {data.byMeal.map((m) => (
                <tr key={m.meal_type} className="border-t border-stone-100">
                  <td className="p-1 capitalize">{m.meal_type}</td>
                  <td className="p-1">{m.plates.toFixed(1)}</td>
                  <td className="p-1">₹{m.revenue.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-3">
        <div className="mb-2 text-sm font-semibold">Items sold</div>
        <table className="w-full text-sm">
          <thead className="text-left text-stone-500">
            <tr>
              <th className="p-1">Item</th>
              <th className="p-1">Qty</th>
              <th className="p-1">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((it) => (
              <tr key={it.name} className="border-t border-stone-100">
                <td className="p-1">{it.name}</td>
                <td className="p-1">{it.qty}</td>
                <td className="p-1">₹{it.revenue.toFixed(2)}</td>
              </tr>
            ))}
            {data.items.length === 0 && (
              <tr>
                <td colSpan={3} className="p-2 text-stone-500">
                  No items.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KPI({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}

// Guided end-of-day close: warns about still-open bills and prints the day
// summary. (Cash/UPI expenses are logged separately in the Money tab.)
function CloseDayModal({
  date,
  collected,
  onClose,
  onDone,
}: {
  date: string;
  collected: number;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [openBills, setOpenBills] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.tables.list().then((r: any) => {
      if (r?.ok) setOpenBills(r.tables.reduce((s: number, t: any) => s + (t.openBills?.length || 0), 0));
    });
  }, [date]);

  async function finish() {
    setBusy(true);
    const pr = await api.daySummaryPrint(date);
    setBusy(false);
    onDone(pr?.ok ? 'Day closed — summary printed.' : `Day closed. Print failed: ${pr?.error || ''}`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-md space-y-4 p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">Close day · {date}</h2>

        <div className="rounded-md border border-stone-200 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-stone-600">Collected today</span>
            <strong>₹{collected.toFixed(2)}</strong>
          </div>
        </div>

        {openBills == null ? (
          <div className="text-sm text-stone-500">Checking open bills…</div>
        ) : openBills > 0 ? (
          <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            ⚠️ {openBills} table bill{openBills === 1 ? '' : 's'} still open. Settle or cancel them on
            the Tables page first — open bills aren't counted in today's totals and are auto-cancelled
            after midnight.
          </div>
        ) : (
          <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            All table bills are settled. ✓
          </div>
        )}

        <p className="text-xs text-stone-500">
          Log today's cash &amp; UPI expenses in the <strong>Money</strong> tab.
        </p>

        <div className="flex justify-end gap-2">
          <button className="btn-ghost border border-stone-300" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={finish} disabled={busy}>
            {busy ? 'Working…' : 'Print summary & close'}
          </button>
        </div>
      </div>
    </div>
  );
}
