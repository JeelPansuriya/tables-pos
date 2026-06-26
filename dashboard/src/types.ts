export type PayMode = 'cash' | 'upi' | 'card' | 'other';

export type Bill = {
  id: number;
  token_no: number | null;
  type: string;
  status: 'open' | 'closed' | 'cancelled';
  table_label: string | null;
  meal_type: 'lunch' | 'dinner' | null;
  customer_name: string | null;
  subtotal: number;
  discount: number;
  total: number;
  plates: number;
  opened_at: string | null;
  closed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
};

export type BillPayment = {
  id: number;
  bill_id: number;
  amount: number;
  mode: PayMode;
  received_at: string | null;
};

export type BillItem = {
  id: number;
  bill_id: number;
  name: string;
  qty: number;
  unit_price: number;
  total: number;
};

export type Preorder = {
  id: number;
  customer_name: string;
  for_date: string;
  total: number;
  advance_paid: number;
  balance_due: number;
  status: 'pending' | 'partial' | 'paid' | 'fulfilled' | 'cancelled';
  created_at: string | null;
};

export type PreorderPayment = {
  id: number;
  preorder_id: number;
  amount: number;
  mode: PayMode;
  received_at: string | null;
};
