import React, { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { MealType } from '../types';
import BillEditor, { type EditorItem } from '../components/BillEditor';
import PaymentBar, { type PaymentEntry } from '../components/PaymentBar';

// Lunch before the configured cutoff hour (default 17 = 5pm), dinner after.
function mealForNow(lunchUntilHour: number): MealType {
  return new Date().getHours() < lunchUntilHour ? 'lunch' : 'dinner';
}

export default function QuickBillPage() {
  const { menu, settings } = useStore();
  const [items, setItems] = useState<EditorItem[]>([]);
  const lunchUntil = parseInt(settings.lunch_until_hour || '17', 10) || 17;
  const [mealType, setMealType] = useState<MealType>(mealForNow(lunchUntil));
  // Quick billing is always a takeaway-type sale (dine-in goes through Tables).
  // Takeaway-specific products live in the menu itself, so no type toggle.
  const type = 'takeaway' as const;
  const [discount, setDiscount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const subtotal = items.reduce((s, i) => s + i.qty * i.unit_price, 0);
  const maxPct = parseFloat(settings.discount_max_pct || '0') || 0;
  const maxDiscount = +((subtotal * maxPct) / 100).toFixed(2);
  const appliedDiscount = Math.min(Math.max(0, discount), maxDiscount);
  const total = Math.max(0, +(subtotal - appliedDiscount).toFixed(2));

  async function settle(payments: PaymentEntry[], print: boolean) {
    if (items.length === 0) return;
    setBusy(true);
    setMsg(null);
    const r = await api.bills.quickBill({
      type,
      meal_type: mealType,
      items,
      payments,
      discount: appliedDiscount,
      print,
    });
    setBusy(false);
    if (!r?.ok) {
      setMsg(r?.error || 'Failed');
      return;
    }
    setMsg(
      `Token ${r.bill.token_no} saved.${r.printError ? ' Print failed: ' + r.printError : ''}`
    );
    setItems([]);
    setDiscount(0);
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold">Quick billing</h1>
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
        <div className="flex flex-col gap-3">
          {maxPct > 0 && (
            <div className="card space-y-1 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-stone-600">Subtotal</span>
                <span>₹{subtotal.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-stone-600">Discount (max ₹{maxDiscount.toFixed(0)})</span>
                <input
                  type="number"
                  min={0}
                  max={maxDiscount}
                  className="w-24 rounded border border-stone-300 px-2 py-0.5 text-right"
                  value={discount || ''}
                  onChange={(e) =>
                    setDiscount(Math.min(maxDiscount, Math.max(0, parseFloat(e.target.value) || 0)))
                  }
                />
              </div>
            </div>
          )}
          <PaymentBar
            total={total}
            disabled={busy || items.length === 0}
            primaryLabel="Save & Print"
            secondaryLabel="Save"
            onSettle={settle}
          />
        </div>
      </div>
    </div>
  );
}
