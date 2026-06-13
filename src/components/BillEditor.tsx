import React, { useMemo, useState } from 'react';
import type { MenuItem, MealType } from '../types';

export type EditorItem = {
  menu_item_id: number | null;
  name: string;
  qty: number;
  unit_price: number;
  plate_weight: number;
  is_custom: boolean;
};

type Props = {
  menu: MenuItem[];
  mealType: MealType;
  onMealChange?: (m: MealType) => void;
  items: EditorItem[];
  onChange: (items: EditorItem[]) => void;
  showMealToggle?: boolean;
};

export default function BillEditor({
  menu,
  mealType,
  onMealChange,
  items,
  onChange,
  showMealToggle = true,
}: Props) {
  const [filter, setFilter] = useState('');
  const [customName, setCustomName] = useState('');
  const [customPrice, setCustomPrice] = useState<number>(0);

  const visibleMenu = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return menu
      .filter((m) => m.in_stock && m.active)
      .filter((m) => !q || m.name.toLowerCase().includes(q));
  }, [menu, filter]);

  function priceOf(m: MenuItem): number {
    return mealType === 'lunch' ? m.lunch_price : m.dinner_price;
  }

  function addMenuItem(m: MenuItem) {
    const idx = items.findIndex((i) => i.menu_item_id === m.id && !i.is_custom);
    if (idx >= 0) {
      const next = items.slice();
      next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
      onChange(next);
    } else {
      onChange([
        ...items,
        {
          menu_item_id: m.id,
          name: m.name,
          qty: 1,
          unit_price: priceOf(m),
          plate_weight: m.plate_weight,
          is_custom: false,
        },
      ]);
    }
  }

  function addCustom() {
    if (!customName || customPrice <= 0) return;
    onChange([
      ...items,
      {
        menu_item_id: null,
        name: customName,
        qty: 1,
        unit_price: customPrice,
        plate_weight: 0,
        is_custom: true,
      },
    ]);
    setCustomName('');
    setCustomPrice(0);
  }

  function setQty(idx: number, qty: number) {
    if (qty <= 0) {
      onChange(items.filter((_, i) => i !== idx));
      return;
    }
    const next = items.slice();
    next[idx] = { ...next[idx], qty };
    onChange(next);
  }

  function setPrice(idx: number, p: number) {
    const next = items.slice();
    next[idx] = { ...next[idx], unit_price: p };
    onChange(next);
  }

  const subtotal = items.reduce((s, i) => s + i.qty * i.unit_price, 0);

  return (
    <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="card flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b border-stone-200 p-2">
          <input
            className="input"
            placeholder="Search menu (or shortcut key)"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {showMealToggle && (
            <div className="flex rounded-md border border-stone-300 bg-white p-0.5 text-sm">
              {(['lunch', 'dinner'] as MealType[]).map((m) => (
                <button
                  key={m}
                  className={`rounded px-3 py-1 ${
                    mealType === m ? 'bg-brand-600 text-white' : 'text-stone-700'
                  }`}
                  onClick={() => onMealChange?.(m)}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="grid flex-1 grid-cols-2 gap-2 overflow-auto p-2 sm:grid-cols-3 xl:grid-cols-4">
          {visibleMenu.map((m) => (
            <button
              key={m.id}
              className="rounded-md border border-stone-200 bg-white p-2 text-left text-sm shadow-sm hover:border-brand-400 hover:bg-brand-50"
              onClick={() => addMenuItem(m)}
            >
              <div className="font-medium text-stone-800">{m.name}</div>
              <div className="text-xs text-stone-500">
                ₹{priceOf(m)} {m.shortcut_key ? `· [${m.shortcut_key}]` : ''}
              </div>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-[1fr_8rem_auto] gap-2 border-t border-stone-200 p-2">
          <input
            className="input"
            placeholder="Custom item (e.g. extra sweet)"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
          />
          <input
            className="input"
            type="number"
            placeholder="Price"
            value={customPrice || ''}
            onChange={(e) => setCustomPrice(parseFloat(e.target.value) || 0)}
          />
          <button className="btn-ghost border border-stone-300" onClick={addCustom}>
            + Add custom
          </button>
        </div>
      </div>

      <div className="card flex flex-col overflow-hidden">
        <div className="border-b border-stone-200 p-2 text-sm font-semibold">
          Bill items ({items.length})
        </div>
        <div className="flex-1 overflow-auto">
          {items.length === 0 ? (
            <div className="p-4 text-sm text-stone-500">No items yet — tap menu tiles to add.</div>
          ) : (
            <ul className="divide-y divide-stone-100">
              {items.map((it, idx) => (
                <li key={idx} className="flex items-center gap-2 p-2 text-sm">
                  <div className="flex-1">
                    <div className="font-medium text-stone-800">
                      {it.name} {it.is_custom && <span className="text-xs text-amber-700">·custom</span>}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-stone-500">
                      <span>₹</span>
                      <input
                        type="number"
                        className="w-20 rounded border border-stone-200 px-1 py-0.5 text-xs"
                        value={it.unit_price}
                        onChange={(e) => setPrice(idx, parseFloat(e.target.value) || 0)}
                      />
                      <span>× {it.qty} = ₹{(it.unit_price * it.qty).toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      className="rounded-md border border-stone-300 px-2 text-lg leading-none hover:bg-stone-100"
                      onClick={() => setQty(idx, it.qty - 1)}
                    >
                      −
                    </button>
                    <span className="w-8 text-center font-semibold">{it.qty}</span>
                    <button
                      className="rounded-md border border-stone-300 px-2 text-lg leading-none hover:bg-stone-100"
                      onClick={() => setQty(idx, it.qty + 1)}
                    >
                      +
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t border-stone-200 p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-stone-600">Subtotal</span>
            <span className="text-2xl font-bold text-brand-700">₹{subtotal.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
