import React, { useEffect, useState } from 'react';
import { api } from '../api';

type Summary = {
  date: string;
  totals: { bills: number; revenue: number; plates: number };
  byMode: Array<{ mode: string; amt: number }>;
  byMeal: Array<{ meal_type: string; bills: number; revenue: number }>;
  items: Array<{ name: string; qty: number; revenue: number }>;
};

export default function DaySummaryPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [data, setData] = useState<Summary | null>(null);

  async function refresh() {
    const r = await api.daySummary(date);
    if (r?.ok) setData(r);
  }
  useEffect(() => {
    refresh();
  }, [date]);

  if (!data) return <div>Loading…</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold">Day Summary</h1>
        <input type="date" className="input ml-auto w-40" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <KPI label="Bills" value={data.totals.bills} />
        <KPI label="Revenue" value={`₹${data.totals.revenue.toFixed(2)}`} />
        <KPI label="Plates" value={data.totals.plates.toFixed(1)} />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="card p-3">
          <div className="mb-2 text-sm font-semibold">By payment mode</div>
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
                  <td className="p-1 capitalize">{m.mode}</td>
                  <td className="p-1">₹{m.amt.toFixed(2)}</td>
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
                <th className="p-1">Bills</th>
                <th className="p-1">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {data.byMeal.map((m) => (
                <tr key={m.meal_type} className="border-t border-stone-100">
                  <td className="p-1 capitalize">{m.meal_type}</td>
                  <td className="p-1">{m.bills}</td>
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
