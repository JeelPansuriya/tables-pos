import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { MealType, TableTile } from '../types';
import MenuGrid from '../components/MenuGrid';
import BillItemList, { type EditorItem } from '../components/BillItemList';
import { addToItems } from '../components/BillEditor';
import PaymentBar, { type PaymentEntry } from '../components/PaymentBar';
import ReasonModal from '../components/ReasonModal';

// Lunch before the configured cutoff hour (default 17 = 5pm), dinner after —
// so the default meal flips to dinner automatically each evening.
function mealForNow(lunchUntilHour: number): MealType {
  return new Date().getHours() < lunchUntilHour ? 'lunch' : 'dinner';
}

export default function TablesPage() {
  const { menu, settings } = useStore();
  const [tiles, setTiles] = useState<TableTile[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<number | null>(null);

  // The bill currently loaded into the right pane.
  const [activeBillId, setActiveBillId] = useState<number | null>(null);
  const [activeTableLabel, setActiveTableLabel] = useState('');
  const [items, setItems] = useState<EditorItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const lunchUntil = parseInt(settings.lunch_until_hour || '17', 10) || 17;
  const [mealType, setMealType] = useState<MealType>(mealForNow(lunchUntil));
  const [defaultMeal, setDefaultMeal] = useState<MealType>(mealForNow(lunchUntil));

  // One control drives both the meal for new bills and the price shown on tiles.
  function changeMeal(m: MealType) {
    setDefaultMeal(m);
    setMealType(m);
  }

  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Guards the debounced autosave from firing against a bill we're settling.
  const closingRef = useRef(false);

  // Bill totals + discount (capped by the discount_max_pct setting). Declared
  // before the autosave effect below because that effect's deps reference
  // appliedDiscount — a `const` referenced before declaration throws (TDZ).
  const subtotal = items.reduce((s, i) => s + i.qty * i.unit_price, 0);
  const maxPct = parseFloat(settings.discount_max_pct || '0') || 0;
  const maxDiscount = +((subtotal * maxPct) / 100).toFixed(2);
  const appliedDiscount = Math.min(Math.max(0, discount), maxDiscount);
  const total = Math.max(0, +(subtotal - appliedDiscount).toFixed(2));

  async function refresh() {
    const r = await api.tables.list();
    if (r?.ok) setTiles(r.tables);
  }

  useEffect(() => {
    refresh();
  }, []);

  // Auto-persist (park) the open bill a moment after edits, so switching bills
  // or an unexpected exit never loses items. Re-fetch tiles afterwards so the
  // overview's open-order totals reflect the just-added items.
  useEffect(() => {
    if (!activeBillId || closingRef.current) return;
    const t = setTimeout(async () => {
      await api.tables.saveOpen(activeBillId, items, undefined, appliedDiscount);
      if (!closingRef.current) await refresh();
    }, 800);
    return () => clearTimeout(t);
  }, [items, activeBillId, appliedDiscount]);

  function loadFromBill(bill: any, label: string) {
    setActiveBillId(bill.id);
    setActiveTableLabel(label);
    setMealType(bill.meal_type);
    setDiscount(bill.discount || 0);
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

  /** Persist the active bill's items immediately before navigating away from it. */
  async function flushActive() {
    if (activeBillId) await api.tables.saveOpen(activeBillId, items, undefined, appliedDiscount);
  }

  function selectTable(t: TableTile) {
    setSelectedTableId(t.id);
    // If the table already has open bill(s), jump straight into one (the first)
    // instead of making the user click again — unless we're already on one of
    // this table's bills.
    const alreadyOnThisTable = t.openBills.some((b) => b.id === activeBillId);
    if (!alreadyOnThisTable && t.openBills.length >= 1) {
      void loadBill(t.openBills[0].id, t.label);
    }
  }

  async function newBillFor(tableId: number, label: string) {
    setErrorMsg(null);
    await flushActive();
    setSelectedTableId(tableId);
    const r = await api.tables.newBill(tableId, defaultMeal);
    if (r?.ok) loadFromBill(r.bill, label);
    await refresh();
  }

  async function loadBill(billId: number, label: string) {
    setErrorMsg(null);
    await flushActive();
    const r = await api.tables.loadBill(billId);
    if (r?.ok) loadFromBill(r.bill, label);
  }

  function clearActive() {
    setActiveBillId(null);
    setItems([]);
    setDiscount(0);
    setActiveTableLabel('');
  }

  async function backToOverview() {
    await flushActive();
    clearActive();
    await refresh();
  }

  async function settle(payments: PaymentEntry[], print: boolean) {
    if (!activeBillId) return;
    closingRef.current = true;
    setBusy(true);
    setErrorMsg(null);
    const save = await api.tables.saveOpen(activeBillId, items, undefined, appliedDiscount);
    if (!save?.ok) {
      setBusy(false);
      closingRef.current = false;
      setErrorMsg(save?.error || 'Save failed');
      return;
    }
    const r = await api.tables.closeAndPrint(activeBillId, payments, print);
    setBusy(false);
    if (!r?.ok) {
      closingRef.current = false;
      setErrorMsg(r?.error || 'Save failed');
      return;
    }
    if (r.printError) setErrorMsg(`Bill saved but print failed: ${r.printError}`);
    clearActive();
    closingRef.current = false;
    await refresh();
  }

  async function cancelBill(reason: string) {
    if (!activeBillId) return;
    setCancelOpen(false);
    closingRef.current = true;
    const r = await api.tables.cancel(activeBillId, reason);
    closingRef.current = false;
    if (r?.ok) {
      clearActive();
      await refresh();
    } else {
      setErrorMsg(r?.error || 'Cancel failed');
    }
  }

  const row1 = tiles.filter((t) => t.row_no === 1);
  const row2 = tiles.filter((t) => t.row_no === 2);
  const selectedTile = tiles.find((t) => t.id === selectedTableId) || null;

  // Open bills have no token yet, so identify the active one by its position
  // among its table's open bills ("Bill 1", "Bill 2") rather than the db id.
  const activeOrdinal = (() => {
    if (!activeBillId) return null;
    const tile = tiles.find((t) => t.openBills.some((b) => b.id === activeBillId));
    const i = tile?.openBills.findIndex((b) => b.id === activeBillId) ?? -1;
    return i >= 0 ? i + 1 : null;
  })();
  const activeName = `${activeTableLabel} · Bill${activeOrdinal ? ' ' + activeOrdinal : ''}`;

  return (
    <div className="flex h-full gap-3">
      {/* LEFT — overview */}
      <div className="flex-1 space-y-5 overflow-auto">
        {errorMsg && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errorMsg}</div>
        )}
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold">Tables</h1>
          <div className="ml-auto flex items-center gap-2 text-sm">
            <span className="text-stone-500">Meal:</span>
            <div className="flex rounded-md border border-stone-300 bg-white p-0.5 text-sm">
              {(['lunch', 'dinner'] as MealType[]).map((m) => (
                <button
                  key={m}
                  className={`rounded px-3 py-1 ${
                    defaultMeal === m ? 'bg-brand-600 text-white' : 'text-stone-700'
                  }`}
                  onClick={() => changeMeal(m)}
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
                // Use the live edited subtotal for the active bill so the tile
                // total updates instantly while items are being added.
                const tileTotal = t.openBills.reduce(
                  (s, b) => s + (b.id === activeBillId ? total : b.total),
                  0
                );
                const status =
                  t.openBills.length === 0 ? 'free' : t.openBills.length === 1 ? 'open' : 'multi';
                const isSelected = selectedTableId === t.id;
                return (
                  <div
                    key={t.id}
                    onClick={() => selectTable(t)}
                    className={`relative flex h-28 w-full cursor-pointer flex-col items-start justify-between rounded-lg border p-3 text-left shadow-sm transition ${
                      status === 'free'
                        ? 'border-emerald-300 bg-emerald-50 hover:bg-emerald-100'
                        : status === 'open'
                        ? 'border-amber-300 bg-amber-50 hover:bg-amber-100'
                        : 'border-rose-300 bg-rose-50 hover:bg-rose-100'
                    } ${isSelected ? 'ring-2 ring-brand-500 ring-offset-1' : ''}`}
                  >
                    <button
                      className="absolute right-1.5 top-1.5 rounded bg-brand-600 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-brand-700"
                      onClick={(e) => {
                        e.stopPropagation();
                        newBillFor(t.id, t.label);
                      }}
                    >
                      + New
                    </button>
                    <div className="text-xl font-bold">{t.label}</div>
                    <div className="text-xs">
                      {status === 'free' ? 'free' : `${t.openBills.length} open · ₹${tileTotal.toFixed(0)}`}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {t.openBills.map((b, i) => (
                        <span
                          key={b.id}
                          className="rounded bg-white/70 px-1.5 py-0.5 text-[10px] text-stone-700"
                        >
                          Bill {i + 1} · ₹{(b.id === activeBillId ? total : b.total).toFixed(0)}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Bills strip — always rendered (with a hint when no table is selected)
            so its space is reserved and the menu below never shifts. */}
        <div className="card space-y-2 p-3">
          <div className="text-sm font-semibold">
            {selectedTile ? (
              <>
                {selectedTile.label} · bills
                <span className="ml-2 font-normal text-stone-500">
                  {selectedTile.openBills.length} open
                </span>
              </>
            ) : (
              'Bills'
            )}
          </div>
          <div className="flex min-h-[3.25rem] flex-wrap items-start gap-2">
            {!selectedTile ? (
              <div className="self-center text-sm text-stone-500">
                Tap a table above to see or start its bills.
              </div>
            ) : (
              <>
                {selectedTile.openBills.map((b, i) => (
                  <button
                    key={b.id}
                    onClick={() => loadBill(b.id, selectedTile.label)}
                    className={`rounded-md border px-3 py-2 text-left text-sm ${
                      activeBillId === b.id
                        ? 'border-brand-500 bg-brand-50'
                        : 'border-stone-300 hover:bg-stone-50'
                    }`}
                  >
                    <div className="font-medium">Bill {i + 1}</div>
                    <div className="text-xs text-stone-500">
                      ₹{(b.id === activeBillId ? total : b.total).toFixed(0)} · {b.meal_type}
                    </div>
                  </button>
                ))}
                <button
                  onClick={() => newBillFor(selectedTile.id, selectedTile.label)}
                  className="rounded-md border border-dashed border-brand-400 px-3 py-2 text-sm text-brand-700 hover:bg-brand-50"
                >
                  + New bill
                </button>
              </>
            )}
          </div>
        </div>

        {/* Menu — always visible below the table rows; buttons are greyed out
            until a bill is selected. Lays out statically (no inner scrollbar);
            the left pane scrolls as one. */}
        <div className="space-y-1">
          <div className="text-sm font-semibold">
            {activeBillId ? `Add items to ${activeName}` : 'Menu — select or start a bill to add items'}
          </div>
          <MenuGrid
            menu={menu}
            mealType={mealType}
            onAdd={(item) => setItems((cur) => addToItems(cur, item))}
            showMealToggle={false}
            disabled={!activeBillId}
            scroll={false}
            padTiles
          />
        </div>
      </div>

      {/* RIGHT — selected bill */}
      <div className="flex w-96 shrink-0 flex-col gap-3 overflow-hidden">
        {!activeBillId ? (
          <div className="card flex flex-1 items-center justify-center p-6 text-center text-sm text-stone-500">
            Select a table and start or open a bill to begin.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <button className="btn-ghost border border-stone-300" onClick={backToOverview}>
                ← Back
              </button>
              <div className="font-semibold">{activeName}</div>
              <button
                className="btn-ghost ml-auto text-xs text-red-700"
                onClick={() => setCancelOpen(true)}
                disabled={busy}
              >
                Cancel bill
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <BillItemList items={items} onChange={setItems} showSubtotal={false} />
            </div>
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
              onSettle={settle}
              primaryLabel="Save & Print"
              secondaryLabel="Save"
            />
          </>
        )}
      </div>

      {cancelOpen && activeBillId && (
        <ReasonModal
          title={`Cancel ${activeName}?`}
          message="This discards the open bill and its items."
          showReason={false}
          confirmLabel="Cancel bill"
          cancelLabel="Keep bill"
          onConfirm={cancelBill}
          onClose={() => setCancelOpen(false)}
        />
      )}
    </div>
  );
}
