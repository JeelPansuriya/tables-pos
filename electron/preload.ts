import { contextBridge, ipcRenderer } from 'electron';

const invoke = (ch: string, payload?: unknown) => ipcRenderer.invoke(ch, payload);

const api = {
  auth: {
    login: (username: string, password: string) => invoke('auth:login', { username, password }),
    changePassword: (oldPassword: string, newPassword: string) =>
      invoke('auth:changePassword', { oldPassword, newPassword }),
    listUsers: () => invoke('auth:listUsers'),
    createUser: (username: string, password: string, role: 'manager' | 'admin') =>
      invoke('auth:createUser', { username, password, role }),
    setActive: (userId: number, active: boolean) =>
      invoke('auth:setActive', { userId, active }),
    me: () => invoke('auth:me'),
    logout: () => invoke('auth:logout'),
  },
  settings: {
    getAll: () => invoke('settings:getAll'),
    set: (entries: Record<string, string>) => invoke('settings:set', entries),
  },
  menu: {
    list: () => invoke('menu:list'),
    upsert: (
      item: {
        id?: number;
        name: string;
        category?: string | null;
        lunch_price: number;
        dinner_price: number;
        plate_weight: number;
        shortcut_key?: string | null;
        in_stock: boolean;
        active: boolean;
        sort_order: number;
      }
    ) => invoke('menu:upsert', item),
    setStock: (id: number, in_stock: boolean) =>
      invoke('menu:setStock', { id, in_stock }),
    delete: (id: number) => invoke('menu:delete', id),
  },
  tables: {
    list: () => invoke('tables:list'),
    newBill: (tableId: number, mealType: 'lunch' | 'dinner') =>
      invoke('tables:newBill', { tableId, mealType }),
    loadBill: (billId: number) => invoke('tables:loadBill', billId),
    saveOpen: (
      billId: number,
      items: Array<{
        menu_item_id: number | null;
        name: string;
        qty: number;
        unit_price: number;
        plate_weight: number;
        is_custom: boolean;
      }>,
      customer?: { name?: string; mobile?: string; notes?: string }
    ) => invoke('tables:saveOpen', { billId, items, customer }),
    closeAndPrint: (
      billId: number,
      payments: Array<{
        amount: number;
        mode: 'cash' | 'upi' | 'card' | 'other';
        cash_received?: number;
        change_given?: number;
      }>
    ) => invoke('tables:closeAndPrint', { billId, payments }),
    cancel: (billId: number, reason: string) =>
      invoke('tables:cancel', { billId, reason }),
  },
  bills: {
    quickBill: (
      payload: {
        type: 'takeaway' | 'dine_in';
        meal_type: 'lunch' | 'dinner';
        items: Array<{
          menu_item_id: number | null;
          name: string;
          qty: number;
          unit_price: number;
          plate_weight: number;
          is_custom: boolean;
        }>;
        payments: Array<{
          amount: number;
          mode: 'cash' | 'upi' | 'card' | 'other';
          cash_received?: number;
          change_given?: number;
        }>;
        customer?: { name?: string; mobile?: string; notes?: string };
        print: boolean;
      }
    ) => invoke('bills:quickBill', payload),
    list: (params: { from?: string; to?: string; status?: string; q?: string }) =>
      invoke('bills:list', params),
    get: (id: number) => invoke('bills:get', id),
    reprint: (id: number) => invoke('bills:reprint', id),
    testPrint: () => invoke('bills:testPrint'),
  },
  preorders: {
    list: (params: { from?: string; to?: string; status?: string }) =>
      invoke('preorders:list', params),
    get: (id: number) => invoke('preorders:get', id),
    create: (payload: {
      customer_name: string;
      customer_mobile?: string;
      for_date: string;
      for_time?: string;
      meal_type?: 'lunch' | 'dinner';
      notes?: string;
      items: Array<{
        menu_item_id: number | null;
        name: string;
        qty: number;
        unit_price: number;
        is_custom: boolean;
      }>;
      advance: { amount: number; mode: 'cash' | 'upi' | 'card' | 'other' } | null;
    }) => invoke('preorders:create', payload),
    addPayment: (
      id: number,
      payment: { amount: number; mode: 'cash' | 'upi' | 'card' | 'other'; notes?: string }
    ) => invoke('preorders:addPayment', { id, payment }),
    fulfill: (id: number, billId: number | null) =>
      invoke('preorders:fulfill', { id, billId }),
    cancel: (id: number, reason: string) =>
      invoke('preorders:cancel', { id, reason }),
    printReceipt: (id: number) => invoke('preorders:printReceipt', id),
  },
  daySummary: (date?: string) => invoke('day:summary', date),
  audit: {
    list: (params: { from?: string; to?: string; q?: string }) =>
      invoke('audit:list', params),
  },
  cloud: {
    pushPending: () => invoke('cloud:pushPending'),
    pullSnapshot: () => invoke('cloud:pullSnapshot'),
    status: () => invoke('cloud:status'),
  },
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
