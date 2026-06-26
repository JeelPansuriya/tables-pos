import React from 'react';
import type { MenuItem, MealType } from '../types';
import MenuGrid from './MenuGrid';
import BillItemList, { type EditorItem } from './BillItemList';

export type { EditorItem };

type Props = {
  menu: MenuItem[];
  mealType: MealType;
  onMealChange?: (m: MealType) => void;
  items: EditorItem[];
  onChange: (items: EditorItem[]) => void;
  showMealToggle?: boolean;
};

/**
 * Merge a qty-1 item into the list: bump qty for an existing identical menu
 * item, otherwise append. Custom items always append.
 */
export function addToItems(items: EditorItem[], add: EditorItem): EditorItem[] {
  if (!add.is_custom && add.menu_item_id != null) {
    const idx = items.findIndex((i) => i.menu_item_id === add.menu_item_id && !i.is_custom);
    if (idx >= 0) {
      const next = items.slice();
      next[idx] = { ...next[idx], qty: next[idx].qty + add.qty };
      return next;
    }
  }
  return [...items, add];
}

/** Combined menu picker + items list (used by Quick / Takeaway). */
export default function BillEditor({
  menu,
  mealType,
  onMealChange,
  items,
  onChange,
  showMealToggle = true,
}: Props) {
  return (
    <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[1fr_22rem]">
      <MenuGrid
        menu={menu}
        mealType={mealType}
        onMealChange={onMealChange}
        showMealToggle={showMealToggle}
        onAdd={(item) => onChange(addToItems(items, item))}
      />
      <BillItemList items={items} onChange={onChange} />
    </div>
  );
}
