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
      customer?: { name?: string; mobile?: string; notes?: string },
      discount?: number
    ) => invoke('tables:saveOpen', { billId, items, customer, discount }),
    closeAndPrint: (
      billId: number,
      payments: Array<{
        amount: number;
        mode: 'cash' | 'upi' | 'card' | 'other';
        cash_received?: number;
        change_given?: number;
      }>,
      print = true
    ) => invoke('tables:closeAndPrint', { billId, payments, print }),
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
        discount?: number;
        print: boolean;
      }
    ) => invoke('bills:quickBill', payload),
    list: (params: {
      from?: string;
      to?: string;
      status?: string;
      q?: string;
      type?: string;
      meal_type?: string;
      table_label?: string;
      mode?: string;
    }) => invoke('bills:list', params),
    get: (id: number) => invoke('bills:get', id),
    reprint: (id: number) => invoke('bills:reprint', id),
    void: (id: number, reason: string) => invoke('bills:void', { billId: id, reason }),
    testPrint: () => invoke('bills:testPrint'),
    recomputePlates: () => invoke('bills:recomputePlates'),
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
    addItems: (
      id: number,
      items: Array<{
        menu_item_id: number | null;
        name: string;
        qty: number;
        unit_price: number;
        is_custom: boolean;
      }>
    ) => invoke('preorders:addItems', { id, items }),
    update: (
      id: number,
      fields: {
        customer_name: string;
        customer_mobile?: string;
        for_date: string;
        for_time?: string;
        meal_type?: 'lunch' | 'dinner' | '';
        notes?: string;
      }
    ) => invoke('preorders:update', { id, fields }),
    setItems: (
      id: number,
      items: Array<{
        menu_item_id: number | null;
        name: string;
        qty: number;
        unit_price: number;
        is_custom: boolean;
      }>
    ) => invoke('preorders:setItems', { id, items }),
    setAdvance: (id: number, amount: number, mode: 'cash' | 'upi') =>
      invoke('preorders:setAdvance', { id, amount, mode }),
    setDiscount: (id: number, amount: number) => invoke('preorders:setDiscount', { id, amount }),
    fulfill: (id: number, billId: number | null) =>
      invoke('preorders:fulfill', { id, billId }),
    cancel: (id: number, reason: string) =>
      invoke('preorders:cancel', { id, reason }),
    printReceipt: (id: number) => invoke('preorders:printReceipt', id),
  },
  daySummary: (date?: string) => invoke('day:summary', date),
  daySummaryPrint: (date?: string) => invoke('day:printSummary', date),
  analytics: {
    overview: (params: { from?: string; to?: string }) => invoke('analytics:overview', params),
  },
  cash: {
    get: (date?: string) => invoke('cash:get', date),
    set: (payload: { date: string; counted_cash: number; note?: string }) =>
      invoke('cash:set', payload),
  },
  audit: {
    list: (params: { from?: string; to?: string; q?: string }) =>
      invoke('audit:list', params),
  },
  cloud: {
    pushPending: () => invoke('cloud:pushPending'),
    pullSnapshot: () => invoke('cloud:pullSnapshot'),
    status: () => invoke('cloud:status'),
  },
  backup: {
    status: () => invoke('backup:status'),
    now: () => invoke('backup:now'),
    chooseDir: () => invoke('backup:chooseDir'),
    clearDir: () => invoke('backup:clearDir'),
  },
  update: {
    status: () => invoke('update:status'),
    check: () => invoke('update:check'),
    install: () => invoke('update:install'),
    /** Subscribe to update lifecycle frames. Returns an unsubscribe fn. */
    onEvent: (cb: (payload: any) => void) => {
      const listener = (_e: unknown, payload: any) => cb(payload);
      ipcRenderer.on('update:event', listener);
      return () => ipcRenderer.removeListener('update:event', listener);
    },
  },
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
