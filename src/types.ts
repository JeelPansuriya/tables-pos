export type Role = 'manager' | 'admin';
export type MealType = 'lunch' | 'dinner';
export type PaymentMode = 'cash' | 'upi' | 'card' | 'other';
export type BillType = 'dine_in' | 'takeaway' | 'preorder_fulfillment';
export type BillStatus = 'open' | 'closed' | 'cancelled';

export type Session = { userId: number; username: string; role: Role };

export type MenuItem = {
  id: number;
  name: string;
  category: string | null;
  lunch_price: number;
  dinner_price: number;
  plate_weight: number;
  shortcut_key: string | null;
  in_stock: number;
  active: number;
  sort_order: number;
};

export type TableTile = {
  id: number;
  label: string;
  row_no: number;
  sort_order: number;
  openBills: Array<{
    id: number;
    table_id: number;
    token_no: number | null;
    total: number;
    opened_at: string;
    meal_type: string;
  }>;
};

export type BillItem = {
  id: number;
  bill_id: number;
  menu_item_id: number | null;
  name: string;
  qty: number;
  unit_price: number;
  plate_weight: number;
  total: number;
  is_custom: number;
  sort_order: number;
};

export type Bill = {
  id: number;
  token_no: number | null;
  type: BillType;
  status: BillStatus;
  table_id: number | null;
  table_label: string | null;
  meal_type: MealType;
  customer_name: string | null;
  customer_mobile: string | null;
  notes: string | null;
  subtotal: number;
  discount: number;
  total: number;
  plates: number;
  opened_at: string;
  closed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  items: BillItem[];
  payments: Array<{
    amount: number;
    mode: PaymentMode;
    cash_received?: number;
    change_given?: number;
  }>;
};

export type Preorder = {
  id: number;
  order_no: number | null;
  customer_name: string;
  customer_mobile: string | null;
  for_date: string;
  for_time: string | null;
  meal_type: MealType | null;
  notes: string | null;
  total: number;
  advance_paid: number;
  balance_due: number;
  status: 'pending' | 'partial' | 'paid' | 'fulfilled' | 'cancelled';
  fulfilled_bill_id: number | null;
  created_at: string;
};
