import React, { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { MealType } from '../types';
import BillEditor, { type EditorItem } from '../components/BillEditor';
import PaymentBar, { type PaymentEntry } from '../components/PaymentBar';

export default function QuickBillPage() {
  const { menu, settings } = useStore();
  const [items, setItems] = useState<EditorItem[]>([]);
  const [mealType, setMealType] = useState<MealType>(
    (settings.default_meal_type as MealType) || 'dinner'
  );
  const [type, setType] = useState<'takeaway' | 'dine_in'>('takeaway');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const subtotal = items.reduce((s, i) => s + i.qty * i.unit_price, 0);

  async function settle(payments: PaymentEntry[], print: boolean) {
    if (items.length === 0) return;
    setBusy(true);
    setMsg(null);
    const r = await api.bills.quickBill({
      type,
      meal_type: mealType,
      items,
      payments,
      print,
    });
    setBusy(false);
    if (!r?.ok) {
      setMsg(r?.error || 'Failed');
      return;
    }
    setMsg(
      `Bill #${r.bill.id} (token ${r.bill.token_no}) saved.${
        r.printError ? ' Print failed: ' + r.printError : ''
      }`
    );
    setItems([]);
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold">Quick / Takeaway</h1>
        <div className="ml-2 flex rounded-md border border-stone-300 bg-white p-0.5 text-sm">
          {(['takeaway', 'dine_in'] as const).map((m) => (
            <button
              key={m}
              className={`rounded px-3 py-1 ${
                type === m ? 'bg-brand-600 text-white' : 'text-stone-700'
              }`}
              onClick={() => setType(m)}
            >
              {m === 'takeaway' ? 'Takeaway' : 'Dine-in (no table)'}
            </button>
          ))}
        </div>
      </div>
      {msg && <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</div>}
      <div className="grid flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-[1fr_24rem]">
        <div className="overflow-hidden">
          <BillEditor
            menu={menu}
            mealType={mealType}
            onMealChange={setMealType}
            items={items}
            onChange={setItems}
          />
        </div>
        <PaymentBar
          total={subtotal}
          disabled={busy || items.length === 0}
          primaryLabel="Print & Close"
          onSettle={(p) => settle(p, true)}
          secondaryAction={{
            label: 'Save (no print)',
            onClick: () => settle([{ amount: subtotal, mode: 'cash' }], false),
            disabled: busy || items.length === 0,
          }}
        />
      </div>
    </div>
  );
}
