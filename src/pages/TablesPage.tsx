import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { MealType, TableTile } from '../types';
import BillEditor, { type EditorItem } from '../components/BillEditor';
import PaymentBar, { type PaymentEntry } from '../components/PaymentBar';

export default function TablesPage() {
  const { menu, settings } = useStore();
  const [tiles, setTiles] = useState<TableTile[]>([]);
  const [pickerTableId, setPickerTableId] = useState<number | null>(null);

  const [activeBillId, setActiveBillId] = useState<number | null>(null);
  const [activeTableLabel, setActiveTableLabel] = useState<string>('');
  const [items, setItems] = useState<EditorItem[]>([]);
  const [mealType, setMealType] = useState<MealType>(
    (settings.default_meal_type as MealType) || 'dinner'
  );
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function refresh() {
    const r = await api.tables.list();
    if (r?.ok) setTiles(r.tables);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function openTable(t: TableTile) {
    setErrorMsg(null);
    setPickerTableId(null);
    if (t.openBills.length === 0) {
      const r = await api.tables.newBill(t.id, mealType);
      if (r?.ok) loadFromBill(r.bill, t.label);
      await refresh();
    } else if (t.openBills.length === 1) {
      const r = await api.tables.loadBill(t.openBills[0].id);
      if (r?.ok) loadFromBill(r.bill, t.label);
    } else {
      setPickerTableId(t.id);
    }
  }

  async function newBillForTable(tableId: number, label: string) {
    setPickerTableId(null);
    const r = await api.tables.newBill(tableId, mealType);
    if (r?.ok) loadFromBill(r.bill, label);
    await refresh();
  }

  async function loadBillById(billId: number, label: string) {
    setPickerTableId(null);
    const r = await api.tables.loadBill(billId);
    if (r?.ok) loadFromBill(r.bill, label);
  }

  function loadFromBill(bill: any, label: string) {
    setActiveBillId(bill.id);
    setActiveTableLabel(label);
    setMealType(bill.meal_type);
    setItems(
      bill.items.map((it: any) => ({
        menu_item_id: it.menu_item_id,
        name: it.name,
        qty: it.qty,
        unit_price: it.unit_price,
        plate_weight: it.plate_weight,
        is_custom: !!it.is_custom,
      }))
    );
  }

  async function saveOpen() {
    if (!activeBillId) return;
    setBusy(true);
    const r = await api.tables.saveOpen(activeBillId, items);
    setBusy(false);
    if (!r?.ok) setErrorMsg(r?.error || 'Save failed');
    await refresh();
  }

  async function closeAndPrint(payments: PaymentEntry[]) {
    if (!activeBillId) return;
    setBusy(true);
    setErrorMsg(null);
    const save = await api.tables.saveOpen(activeBillId, items);
    if (!save?.ok) {
      setBusy(false);
      setErrorMsg(save?.error || 'Save failed');
      return;
    }
    const r = await api.tables.closeAndPrint(activeBillId, payments);
    setBusy(false);
    if (!r?.ok) {
      setErrorMsg(r?.error || 'Close failed');
      return;
    }
    if (r.printError) {
      setErrorMsg(`Bill closed but print failed: ${r.printError}`);
    }
    setActiveBillId(null);
    setItems([]);
    setActiveTableLabel('');
    await refresh();
  }

  async function cancelBill() {
    if (!activeBillId) return;
    if (!confirm('Cancel this bill and discard items?')) return;
    const reason = prompt('Reason for cancellation?') || '';
    const r = await api.tables.cancel(activeBillId, reason);
    if (r?.ok) {
      setActiveBillId(null);
      setItems([]);
      setActiveTableLabel('');
      await refresh();
    }
  }

  const subtotal = items.reduce((s, i) => s + i.qty * i.unit_price, 0);
  const row1 = tiles.filter((t) => t.row_no === 1);
  const row2 = tiles.filter((t) => t.row_no === 2);

  if (activeBillId) {
    const otherCount =
      tiles.find((t) => t.label === activeTableLabel)?.openBills.filter((b) => b.id !== activeBillId)
        .length || 0;
    return (
      <div className="flex h-full flex-col gap-3">
        <div className="flex items-center gap-2">
          <button className="btn-ghost border border-stone-300" onClick={() => setActiveBillId(null)}>
            ← Back to tables
          </button>
          <div className="text-lg font-semibold">
            {activeTableLabel} · Bill #{activeBillId}
          </div>
          {otherCount > 0 && (
            <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
              {otherCount} other open bill{otherCount > 1 ? 's' : ''}
            </span>
          )}
          <button
            className="btn-ghost border border-stone-300"
            onClick={() => {
              const tile = tiles.find((t) => t.label === activeTableLabel);
              if (tile) newBillForTable(tile.id, tile.label);
            }}
          >
            + New bill on {activeTableLabel}
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button className="btn-ghost text-red-700" onClick={cancelBill} disabled={busy}>
              Cancel bill
            </button>
            <button className="btn-ghost border border-stone-300" onClick={saveOpen} disabled={busy}>
              Save (no print)
            </button>
          </div>
        </div>
        {errorMsg && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errorMsg}</div>
        )}
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
            onSettle={closeAndPrint}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {errorMsg && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errorMsg}</div>
      )}
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold">Tables</h1>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <span className="text-stone-500">Default meal for new bills:</span>
          <div className="flex rounded-md border border-stone-300 bg-white p-0.5 text-sm">
            {(['lunch', 'dinner'] as MealType[]).map((m) => (
              <button
                key={m}
                className={`rounded px-3 py-1 ${
                  mealType === m ? 'bg-brand-600 text-white' : 'text-stone-700'
                }`}
                onClick={() => setMealType(m)}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      {[row1, row2].map((row, ri) => (
        <div key={ri} className="space-y-2">
          <div className="text-xs uppercase tracking-wide text-stone-500">
            Row {ri + 1} · {row.length} tables
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {row.map((t) => {
              const total = t.openBills.reduce((s, b) => s + b.total, 0);
              const isPicker = pickerTableId === t.id;
              const status = t.openBills.length === 0 ? 'free' : t.openBills.length === 1 ? 'open' : 'multi';
              return (
                <div key={t.id} className="space-y-1">
                  <button
                    onClick={() => openTable(t)}
                    className={`flex h-28 w-full flex-col items-start justify-between rounded-lg border p-3 text-left shadow-sm transition ${
                      status === 'free'
                        ? 'border-emerald-300 bg-emerald-50 hover:bg-emerald-100'
                        : status === 'open'
                        ? 'border-amber-300 bg-amber-50 hover:bg-amber-100'
                        : 'border-rose-300 bg-rose-50 hover:bg-rose-100'
                    }`}
                  >
                    <div className="text-xl font-bold">{t.label}</div>
                    <div className="text-xs">
                      {status === 'free'
                        ? 'free'
                        : `${t.openBills.length} open · ₹${total.toFixed(0)}`}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {t.openBills.map((b) => (
                        <span
                          key={b.id}
                          className="rounded bg-white/70 px-1.5 py-0.5 text-[10px] text-stone-700"
                        >
                          #{b.id}
                          {b.token_no ? ` T${b.token_no}` : ''}
                        </span>
                      ))}
                    </div>
                  </button>
                  {isPicker && (
                    <div className="card p-2 text-sm">
                      <div className="mb-1 font-medium">Choose a bill on {t.label}</div>
                      <div className="flex flex-col gap-1">
                        {t.openBills.map((b) => (
                          <button
                            key={b.id}
                            className="rounded border border-stone-200 px-2 py-1 text-left hover:bg-stone-50"
                            onClick={() => loadBillById(b.id, t.label)}
                          >
                            #{b.id} · ₹{b.total.toFixed(0)} · {b.meal_type}
                          </button>
                        ))}
                        <button
                          className="rounded bg-brand-50 px-2 py-1 text-left text-brand-800 hover:bg-brand-100"
                          onClick={() => newBillForTable(t.id, t.label)}
                        >
                          + Start a new bill on {t.label}
                        </button>
                        <button
                          className="text-xs text-stone-500 underline"
                          onClick={() => setPickerTableId(null)}
                        >
                          cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
