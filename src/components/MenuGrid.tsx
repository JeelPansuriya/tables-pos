import React, { useMemo, useState } from 'react';
import type { MenuItem, MealType } from '../types';
import type { EditorItem } from './BillItemList';

type Props = {
  menu: MenuItem[];
  mealType: MealType;
  onMealChange?: (m: MealType) => void;
  /** Called with a qty-1 item to add; the parent decides whether to merge or append. */
  onAdd: (item: EditorItem) => void;
  showMealToggle?: boolean;
  /** Grey out and disable the tiles / add controls (e.g. no bill selected yet). */
  disabled?: boolean;
  /**
   * Layout. `true` (default): fill the parent height with an internal scroll
   * (used by the Quick-bill split view). `false`: lay every tile out statically
   * and grow with content, letting the page scroll — no inner scrollbar.
   */
  scroll?: boolean;
  /** Bigger, more square touch tiles packed ~8 per row (billing page). */
  padTiles?: boolean;
};

/** Menu picker: search, optional meal toggle, tappable item tiles, custom-item add row. */
export default function MenuGrid({
  menu,
  mealType,
  onMealChange,
  onAdd,
  showMealToggle = true,
  disabled = false,
  scroll = true,
  padTiles = false,
}: Props) {
  const [filter, setFilter] = useState('');
  const [customName, setCustomName] = useState('');
  const [customPrice, setCustomPrice] = useState<number>(0);
  // Multiplier: set a quantity, then tap an item to add that many at once.
  const [qty, setQty] = useState<number>(1);

  const visibleMenu = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return menu
      .filter((m) => m.in_stock && m.active)
      .filter(
        (m) =>
          !q ||
          m.name.toLowerCase().includes(q) ||
          (m.shortcut_key ?? '').toLowerCase() === q
      );
  }, [menu, filter]);

  function priceOf(m: MenuItem): number {
    return mealType === 'lunch' ? m.lunch_price : m.dinner_price;
  }

  function addMenuItem(m: MenuItem) {
    onAdd({
      menu_item_id: m.id,
      name: m.name,
      qty: Math.max(1, qty),
      unit_price: priceOf(m),
      plate_weight: m.plate_weight,
      is_custom: false,
    });
    setQty(1);
  }

  function addCustom() {
    if (!customName || customPrice <= 0) return;
    onAdd({
      menu_item_id: null,
      name: customName,
      qty: Math.max(1, qty),
      unit_price: customPrice,
      plate_weight: 0,
      is_custom: true,
    });
    setCustomName('');
    setCustomPrice(0);
    setQty(1);
  }

  // Enter in the search box: add the exact shortcut match, or the only result.
  function onSearchKey(e: React.KeyboardEvent) {
    if (e.key !== 'Enter' || disabled) return;
    const q = filter.trim().toLowerCase();
    if (!q) return;
    const byKey = visibleMenu.find((m) => (m.shortcut_key ?? '').toLowerCase() === q);
    const target = byKey || (visibleMenu.length === 1 ? visibleMenu[0] : null);
    if (target) {
      e.preventDefault();
      addMenuItem(target);
      setFilter('');
    }
  }

  return (
    <div className={`card flex flex-col ${scroll ? 'h-full overflow-hidden' : ''}`}>
      <div className="flex items-center gap-2 border-b border-stone-200 p-2">
        <input
          className="input"
          placeholder="Search menu (or shortcut key)"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={onSearchKey}
          disabled={disabled}
          autoFocus={!disabled}
        />
        <div className="flex shrink-0 items-center gap-1 text-sm" title="Quantity to add per tap">
          <span className="text-stone-500">Qty</span>
          <button
            type="button"
            className="rounded border border-stone-300 px-2 leading-none disabled:opacity-40"
            disabled={disabled}
            onClick={() => setQty((q) => Math.max(1, q - 1))}
          >
            −
          </button>
          <input
            className="w-10 rounded border border-stone-300 px-1 py-0.5 text-center"
            type="number"
            min={1}
            value={qty}
            disabled={disabled}
            onChange={(e) => setQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
          />
          <button
            type="button"
            className="rounded border border-stone-300 px-2 leading-none disabled:opacity-40"
            disabled={disabled}
            onClick={() => setQty((q) => q + 1)}
          >
            +
          </button>
        </div>
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
      <div
        className={`grid gap-2 p-2 ${
          padTiles
            ? 'grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8'
            : 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-4'
        } ${scroll ? 'flex-1 overflow-auto' : ''}`}
      >
        {visibleMenu.map((m) => (
          <button
            key={m.id}
            disabled={disabled}
            className={`rounded-md border border-stone-200 bg-white shadow-sm ${
              padTiles
                ? 'flex min-h-[5rem] flex-col justify-center p-2 text-center'
                : 'p-2 text-left text-sm'
            } ${
              disabled
                ? 'cursor-not-allowed opacity-40'
                : 'hover:border-brand-400 hover:bg-brand-50'
            }`}
            onClick={() => addMenuItem(m)}
          >
            <div className={`font-medium text-stone-800 ${padTiles ? 'text-sm leading-tight' : ''}`}>
              {m.name}
            </div>
            <div className={`text-stone-500 ${padTiles ? 'mt-1 text-xs' : 'text-xs'}`}>
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
          disabled={disabled}
          onChange={(e) => setCustomName(e.target.value)}
        />
        <input
          className="input"
          type="number"
          placeholder="Price"
          value={customPrice || ''}
          disabled={disabled}
          onChange={(e) => setCustomPrice(parseFloat(e.target.value) || 0)}
        />
        <button
          className="btn-ghost border border-stone-300 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={disabled}
          onClick={addCustom}
        >
          + Add custom
        </button>
      </div>
    </div>
  );
}
