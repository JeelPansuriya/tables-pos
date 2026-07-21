import { ipcMain, dialog, BrowserWindow } from 'electron';
import type { Database } from 'better-sqlite3';
import { getDb, backupDatabase } from './db';
import {
  forgetSession,
  getSession,
  hashPassword,
  login,
  logAudit,
  requireAdmin,
  requireSession,
  verifyPassword,
} from './auth';
import {
  printBill,
  printDaySummary,
  printPreorderReceipt,
  printTestSlip,
  type SlipShop,
} from './printer';
import { cloudStatus, scheduleSoon, syncPending, pullAndOverride, pullAndMerge, pendingCount } from './sync';

type MealType = 'lunch' | 'dinner';
type PaymentMode = 'cash' | 'upi' | 'card' | 'other';

function shopFromSettings(db: Database): SlipShop {
  const get = (k: string, fb = '') =>
    (db.prepare(`SELECT value FROM settings WHERE key=?`).get(k) as { value?: string } | undefined)?.value || fb;
  return {
    name: get('restaurant_name', 'Restaurant'),
    address: get('restaurant_address'),
    phone: get('restaurant_phone'),
    gst: get('gst_no'),
  };
}

function defaultMealForNow(db: Database): MealType {
  const lunchUntil = parseInt(
    ((db.prepare(`SELECT value FROM settings WHERE key='lunch_until_hour'`).get() as
      | { value?: string }
      | undefined)?.value) || '16',
    10
  );
  const hour = new Date().getHours();
  return hour < lunchUntil ? 'lunch' : 'dinner';
}

function nextTokenForToday(db: Database): number {
  // Tokens are assigned at close and must be unique within the day they're
  // issued, so we key off the close day (date('now')). Keying off opened_at
  // caused collisions around midnight: two bills opened on different calendar
  // days but closed the same day each restarted the sequence at 1. Counting
  // bills already closed today (this bill isn't closed yet) keeps it gap-free.
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(token_no), 0) AS m
       FROM bills
       WHERE date(closed_at, 'localtime') = date('now', 'localtime')
         AND token_no IS NOT NULL`
    )
    .get() as { m: number };
  return (row?.m ?? 0) + 1;
}

function nextOrderNo(db: Database): number {
  const r = db
    .prepare(`SELECT COALESCE(MAX(order_no), 0) AS m FROM preorders`)
    .get() as { m: number };
  return r.m + 1;
}

function recomputeBillTotals(db: Database, billId: number) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(total), 0) AS subtotal,
              COALESCE(SUM(qty * plate_weight), 0) AS plates
       FROM bill_items WHERE bill_id = ?`
    )
    .get(billId) as { subtotal: number; plates: number };
  const cur = db.prepare(`SELECT discount FROM bills WHERE id=?`).get(billId) as
    | { discount: number }
    | undefined;
  const discount = cur?.discount ?? 0;
  const total = Math.max(0, row.subtotal - discount);
  db.prepare(
    `UPDATE bills SET subtotal = ?, plates = ?, total = ?, sync_status='pending' WHERE id = ?`
  ).run(row.subtotal, row.plates, total, billId);
  return { subtotal: row.subtotal, plates: row.plates, total };
}

function recomputePreorderTotals(db: Database, preorderId: number) {
  const items = db
    .prepare(`SELECT COALESCE(SUM(total), 0) AS t FROM preorder_items WHERE preorder_id=?`)
    .get(preorderId) as { t: number };
  const pays = db
    .prepare(`SELECT COALESCE(SUM(amount), 0) AS a FROM preorder_payments WHERE preorder_id=?`)
    .get(preorderId) as { a: number };
  const disc = (db.prepare(`SELECT discount FROM preorders WHERE id=?`).get(preorderId) as
    | { discount: number }
    | undefined)?.discount ?? 0;
  const total = items.t;
  const advance = pays.a;
  // Net payable = items total − discount; balance is what's left after advances.
  const net = Math.max(0, total - disc);
  const balance = Math.max(0, +(net - advance).toFixed(2));
  let status = 'pending';
  if (advance >= net && net > 0) status = 'paid';
  else if (advance > 0) status = 'partial';
  db.prepare(
    `UPDATE preorders SET total=?, advance_paid=?, balance_due=?,
            status = CASE WHEN status IN ('fulfilled','cancelled') THEN status ELSE ? END,
            sync_status='pending'
     WHERE id=?`
  ).run(total, advance, balance, status, preorderId);
  return { total, advance, balance };
}

function getBillForSlip(db: Database, billId: number) {
  const bill = db
    .prepare(
      `SELECT b.*, t.label AS table_label
       FROM bills b LEFT JOIN tables t ON t.id = b.table_id
       WHERE b.id = ?`
    )
    .get(billId) as any;
  if (!bill) throw new Error('Bill not found');
  // Include menu_item_id / plate_weight / is_custom so a reloaded bill keeps each
  // line's identity — otherwise re-adding the same item appends a duplicate line
  // instead of bumping qty, and re-saving would reset plate weights to 1.
  const items = db
    .prepare(
      `SELECT menu_item_id, name, qty, unit_price, plate_weight, total, is_custom
       FROM bill_items WHERE bill_id=? ORDER BY sort_order, id`
    )
    .all(billId) as Array<{
    menu_item_id: number | null;
    name: string;
    qty: number;
    unit_price: number;
    plate_weight: number;
    total: number;
    is_custom: number;
  }>;
  const payments = db
    .prepare(
      `SELECT amount, mode, cash_received, change_given FROM bill_payments WHERE bill_id=? ORDER BY id`
    )
    .all(billId) as Array<{ amount: number; mode: string; cash_received?: number; change_given?: number }>;
  return { ...bill, items, payments };
}

export function registerIpc() {
  const db = getDb();

  // -------- AUTH --------
  ipcMain.handle('auth:login', (_e, { username, password }) => {
    const s = login(db, username, password);
    if (!s) return { ok: false, error: 'Invalid credentials' };
    return { ok: true, session: s };
  });

  ipcMain.handle('auth:logout', () => {
    forgetSession(db);
    return { ok: true };
  });

  ipcMain.handle('auth:me', () => ({ session: getSession() }));

  ipcMain.handle('auth:changePassword', (_e, { oldPassword, newPassword }) => {
    const s = requireSession();
    const row = db
      .prepare(`SELECT password_hash FROM users WHERE id=?`)
      .get(s.userId) as { password_hash: string } | undefined;
    if (!row) return { ok: false, error: 'User missing' };
    if (!verifyPassword(oldPassword, row.password_hash))
      return { ok: false, error: 'Old password wrong' };
    db.prepare(`UPDATE users SET password_hash=? WHERE id=?`).run(
      hashPassword(newPassword),
      s.userId
    );
    logAudit(db, 'auth.changePassword', { entity_type: 'user', entity_id: s.userId });
    return { ok: true };
  });

  ipcMain.handle('auth:listUsers', () => {
    requireAdmin();
    const rows = db
      .prepare(`SELECT id, username, role, active, created_at FROM users ORDER BY id`)
      .all();
    return { ok: true, users: rows };
  });

  ipcMain.handle('auth:createUser', (_e, { username, password, role }) => {
    requireAdmin();
    if (!username || !password) return { ok: false, error: 'Missing fields' };
    if (role !== 'admin' && role !== 'manager') return { ok: false, error: 'Bad role' };
    try {
      const r = db
        .prepare(
          `INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)`
        )
        .run(username, hashPassword(password), role);
      logAudit(db, 'auth.createUser', {
        entity_type: 'user',
        entity_id: Number(r.lastInsertRowid),
        details: { username, role },
      });
      return { ok: true, id: Number(r.lastInsertRowid) };
    } catch (e: any) {
      return { ok: false, error: e.message || 'Create failed' };
    }
  });

  ipcMain.handle('auth:setActive', (_e, { userId, active }) => {
    requireAdmin();
    db.prepare(`UPDATE users SET active=? WHERE id=?`).run(active ? 1 : 0, userId);
    logAudit(db, 'auth.setActive', { entity_type: 'user', entity_id: userId, details: { active } });
    return { ok: true };
  });

  // -------- SETTINGS --------
  ipcMain.handle('settings:getAll', () => {
    const rows = db.prepare(`SELECT key, value FROM settings`).all() as Array<{
      key: string;
      value: string;
    }>;
    const out: Record<string, string> = {};
    for (const r of rows) out[r.key] = r.value;
    return { ok: true, settings: out };
  });

  // Cloud/Supabase connection keys are admin-only — a manager can't change
  // where (or whether) data is backed up, even via a crafted call.
  const ADMIN_ONLY_SETTINGS = new Set([
    'supabase_url',
    'supabase_anon_key',
    'supabase_table_prefix',
    'cloud_sync_enabled',
  ]);

  ipcMain.handle('settings:set', (_e, entries: Record<string, string>) => {
    const session = requireSession();
    const touchesAdminKeys = Object.keys(entries).some((k) => ADMIN_ONLY_SETTINGS.has(k));
    if (touchesAdminKeys && session.role !== 'admin') {
      return { ok: false, error: 'Only an admin can change cloud/Supabase settings.' };
    }
    const stmt = db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    );
    const tx = db.transaction(() => {
      for (const [k, v] of Object.entries(entries)) stmt.run(k, v);
    });
    tx();
    logAudit(db, 'settings.set', { details: { keys: Object.keys(entries) } });
    return { ok: true };
  });

  // -------- MENU --------
  ipcMain.handle('menu:list', () => {
    const rows = db
      .prepare(
        `SELECT id, name, category, lunch_price, dinner_price, plate_weight,
                shortcut_key, in_stock, active, sort_order
         FROM menu_items
         WHERE active = 1
         ORDER BY sort_order, name`
      )
      .all();
    return { ok: true, items: rows };
  });

  ipcMain.handle('menu:upsert', (_e, item) => {
    requireSession();
    if (item.id) {
      const prev = db
        .prepare(`SELECT name, lunch_price, dinner_price FROM menu_items WHERE id=?`)
        .get(item.id) as { name: string; lunch_price: number; dinner_price: number } | undefined;
      db.prepare(
        `UPDATE menu_items SET name=?, category=?, lunch_price=?, dinner_price=?,
                plate_weight=?, shortcut_key=?, in_stock=?, active=?, sort_order=?,
                updated_at=datetime('now')
         WHERE id=?`
      ).run(
        item.name,
        item.category ?? null,
        item.lunch_price,
        item.dinner_price,
        item.plate_weight,
        item.shortcut_key ?? null,
        item.in_stock ? 1 : 0,
        item.active ? 1 : 0,
        item.sort_order,
        item.id
      );
      // Audit only price changes — that's the change the owner cares to trace.
      const priceChange: Record<string, [number, number]> = {};
      if (prev && prev.lunch_price !== item.lunch_price)
        priceChange.lunch = [prev.lunch_price, item.lunch_price];
      if (prev && prev.dinner_price !== item.dinner_price)
        priceChange.dinner = [prev.dinner_price, item.dinner_price];
      if (Object.keys(priceChange).length > 0) {
        logAudit(db, 'menu.priceChange', {
          entity_type: 'menu_item',
          entity_id: item.id,
          details: { name: item.name, priceChange },
        });
      }
      return { ok: true, id: item.id };
    } else {
      const r = db
        .prepare(
          `INSERT INTO menu_items
            (name, category, lunch_price, dinner_price, plate_weight,
             shortcut_key, in_stock, active, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          item.name,
          item.category ?? null,
          item.lunch_price,
          item.dinner_price,
          item.plate_weight,
          item.shortcut_key ?? null,
          item.in_stock ? 1 : 0,
          item.active ? 1 : 0,
          item.sort_order
        );
      const id = Number(r.lastInsertRowid);
      logAudit(db, 'menu.create', { entity_type: 'menu_item', entity_id: id, details: item });
      return { ok: true, id };
    }
  });

  ipcMain.handle('menu:setStock', (_e, { id, in_stock }) => {
    requireSession();
    db.prepare(`UPDATE menu_items SET in_stock=?, updated_at=datetime('now') WHERE id=?`).run(
      in_stock ? 1 : 0,
      id
    );
    logAudit(db, 'menu.setStock', { entity_type: 'menu_item', entity_id: id, details: { in_stock } });
    return { ok: true };
  });

  ipcMain.handle('menu:delete', (_e, id: number) => {
    requireAdmin();
    db.prepare(`UPDATE menu_items SET active=0 WHERE id=?`).run(id);
    logAudit(db, 'menu.delete', { entity_type: 'menu_item', entity_id: id });
    return { ok: true };
  });

  // -------- TABLES --------
  ipcMain.handle('tables:list', () => {
    const tables = db
      .prepare(
        `SELECT id, label, row_no, sort_order FROM tables WHERE active=1 ORDER BY row_no, sort_order`
      )
      .all() as Array<{ id: number; label: string; row_no: number; sort_order: number }>;
    const openBills = db
      .prepare(
        `SELECT id, table_id, token_no, total, plates, opened_at, meal_type
         FROM bills WHERE status='open' AND table_id IS NOT NULL
         ORDER BY id`
      )
      .all() as Array<{
      id: number;
      table_id: number;
      token_no: number | null;
      total: number;
      plates: number;
      opened_at: string;
      meal_type: string;
    }>;
    const byTable = new Map<number, typeof openBills>();
    for (const b of openBills) {
      const arr = byTable.get(b.table_id) ?? [];
      arr.push(b);
      byTable.set(b.table_id, arr);
    }
    return {
      ok: true,
      tables: tables.map((t) => ({ ...t, openBills: byTable.get(t.id) ?? [] })),
    };
  });

  ipcMain.handle('tables:newBill', (_e, { tableId, mealType }) => {
    requireSession();
    const meal: MealType = mealType ?? defaultMealForNow(db);
    // The Counter is a walk-in station, so its sales are takeaway — this keeps
    // them out of dine-in timing analytics (we don't track time for it).
    const label = (db.prepare(`SELECT label FROM tables WHERE id=?`).get(tableId) as
      | { label?: string }
      | undefined)?.label;
    const type = label === 'Counter' ? 'takeaway' : 'dine_in';
    const r = db
      .prepare(
        `INSERT INTO bills (type, status, table_id, meal_type, created_by_user_id)
         VALUES (?, 'open', ?, ?, ?)`
      )
      .run(type, tableId, meal, getSession()?.userId ?? null);
    const billId = Number(r.lastInsertRowid);
    return { ok: true, bill: getBillForSlip(db, billId) };
  });

  ipcMain.handle('tables:loadBill', (_e, billId: number) => {
    requireSession();
    return { ok: true, bill: getBillForSlip(db, billId) };
  });

  ipcMain.handle('tables:saveOpen', (_e, { billId, items, customer, discount }) => {
    requireSession();
    const tx = db.transaction(() => {
      if (discount !== undefined) {
        db.prepare(`UPDATE bills SET discount=? WHERE id=?`).run(Math.max(0, discount || 0), billId);
      }
      db.prepare(`DELETE FROM bill_items WHERE bill_id=?`).run(billId);
      const insert = db.prepare(
        `INSERT INTO bill_items
          (bill_id, menu_item_id, name, qty, unit_price, plate_weight, total, is_custom, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      items.forEach((it: any, idx: number) => {
        const total = +(it.qty * it.unit_price).toFixed(2);
        insert.run(
          billId,
          it.menu_item_id ?? null,
          it.name,
          it.qty,
          it.unit_price,
          it.plate_weight ?? 1,
          total,
          it.is_custom ? 1 : 0,
          idx
        );
      });
      if (customer) {
        db.prepare(
          `UPDATE bills SET customer_name=?, customer_mobile=?, notes=? WHERE id=?`
        ).run(
          customer.name ?? null,
          customer.mobile ?? null,
          customer.notes ?? null,
          billId
        );
      }
      recomputeBillTotals(db, billId);
    });
    tx();
    return { ok: true, bill: getBillForSlip(db, billId) };
  });

  ipcMain.handle('tables:closeAndPrint', async (_e, { billId, payments, print = true }) => {
    requireSession();
    if (!Array.isArray(payments) || payments.length === 0)
      return { ok: false, error: 'No payments provided' };

    const totalsRow = db.prepare(`SELECT total FROM bills WHERE id=?`).get(billId) as
      | { total: number }
      | undefined;
    if (!totalsRow) return { ok: false, error: 'Bill missing' };
    const paySum = payments.reduce((s: number, p: any) => s + (p.amount || 0), 0);
    if (Math.abs(paySum - totalsRow.total) > 0.01)
      return { ok: false, error: `Payments ${paySum} ≠ total ${totalsRow.total}` };

    const tx = db.transaction(() => {
      // assign token at close time, so cancelled-before-close bills don't burn numbers
      const token = nextTokenForToday(db);
      const insertPay = db.prepare(
        `INSERT INTO bill_payments (bill_id, amount, mode, cash_received, change_given)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const p of payments) {
        insertPay.run(
          billId,
          p.amount,
          p.mode,
          p.cash_received ?? null,
          p.change_given ?? null
        );
      }
      db.prepare(
        `UPDATE bills SET status='closed', closed_at=datetime('now'),
                closed_by_user_id=?, token_no=?, sync_status='pending'
         WHERE id=?`
      ).run(getSession()?.userId ?? null, token, billId);
    });
    tx();

    const slip = getBillForSlip(db, billId);
    const printerName =
      ((db.prepare(`SELECT value FROM settings WHERE key='printer_name'`).get() as
        | { value?: string }
        | undefined)?.value) || '';
    const copies = parseInt(
      ((db.prepare(`SELECT value FROM settings WHERE key='printer_copies'`).get() as
        | { value?: string }
        | undefined)?.value) || '1',
      10
    );

    let printError: string | null = null;
    if (print) {
      try {
        await printBill(shopFromSettings(db), slip, printerName, copies);
      } catch (e: any) {
        printError = e?.message ?? String(e);
      }
    }

    scheduleSoon();
    return { ok: true, bill: slip, printError };
  });

  ipcMain.handle('tables:cancel', (_e, { billId, reason }) => {
    requireSession();
    const r = db
      .prepare(
        `UPDATE bills SET status='cancelled', cancelled_at=datetime('now'),
                cancel_reason=?, sync_status='pending'
         WHERE id=? AND status='open'`
      )
      .run(reason || null, billId);
    if (r.changes === 0) return { ok: false, error: 'Bill not open' };
    scheduleSoon();
    return { ok: true };
  });

  // -------- BILLS / QUICK BILL / LISTS --------
  ipcMain.handle('bills:quickBill', async (_e, payload) => {
    requireSession();
    const meal: MealType = payload.meal_type ?? defaultMealForNow(db);
    const session = requireSession();

    let billId = 0;
    let printerErr: string | null = null;
    const tx = db.transaction(() => {
      const r = db
        .prepare(
          `INSERT INTO bills (type, status, meal_type, customer_name, customer_mobile, notes, created_by_user_id, opened_at)
           VALUES (?, 'open', ?, ?, ?, ?, ?, datetime('now'))`
        )
        .run(
          payload.type,
          meal,
          payload.customer?.name ?? null,
          payload.customer?.mobile ?? null,
          payload.customer?.notes ?? null,
          session.userId
        );
      billId = Number(r.lastInsertRowid);
      const insert = db.prepare(
        `INSERT INTO bill_items
          (bill_id, menu_item_id, name, qty, unit_price, plate_weight, total, is_custom, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      payload.items.forEach((it: any, idx: number) => {
        const total = +(it.qty * it.unit_price).toFixed(2);
        insert.run(
          billId,
          it.menu_item_id ?? null,
          it.name,
          it.qty,
          it.unit_price,
          it.plate_weight ?? 1,
          total,
          it.is_custom ? 1 : 0,
          idx
        );
      });
      if (payload.discount) {
        db.prepare(`UPDATE bills SET discount=? WHERE id=?`).run(
          Math.max(0, payload.discount),
          billId
        );
      }
      recomputeBillTotals(db, billId);

      const totalsRow = db.prepare(`SELECT total FROM bills WHERE id=?`).get(billId) as { total: number };
      const paySum = (payload.payments || []).reduce((s: number, p: any) => s + (p.amount || 0), 0);
      if (Math.abs(paySum - totalsRow.total) > 0.01) throw new Error(`Payments ${paySum} ≠ total ${totalsRow.total}`);

      const insertPay = db.prepare(
        `INSERT INTO bill_payments (bill_id, amount, mode, cash_received, change_given) VALUES (?, ?, ?, ?, ?)`
      );
      for (const p of payload.payments) {
        insertPay.run(billId, p.amount, p.mode, p.cash_received ?? null, p.change_given ?? null);
      }
      const token = nextTokenForToday(db);
      db.prepare(
        `UPDATE bills SET status='closed', closed_at=datetime('now'),
                closed_by_user_id=?, token_no=?, sync_status='pending' WHERE id=?`
      ).run(session.userId, token, billId);
    });

    try {
      tx();
    } catch (e: any) {
      return { ok: false, error: e.message };
    }

    const slip = getBillForSlip(db, billId);
    if (payload.print) {
      const printerName =
        ((db.prepare(`SELECT value FROM settings WHERE key='printer_name'`).get() as
          | { value?: string }
          | undefined)?.value) || '';
      const copies = parseInt(
        ((db.prepare(`SELECT value FROM settings WHERE key='printer_copies'`).get() as
          | { value?: string }
          | undefined)?.value) || '1',
        10
      );
      try {
        await printBill(shopFromSettings(db), slip, printerName, copies);
      } catch (e: any) {
        printerErr = e?.message ?? String(e);
      }
    }
    scheduleSoon();
    return { ok: true, bill: slip, printError: printerErr };
  });

  ipcMain.handle('bills:list', (_e, params) => {
    requireSession();
    // The Bills register only ever shows finalized sales: closed bills and
    // voided ones (a closed bill later cancelled — it still carries a token).
    // Open bills and auto-cancelled never-settled bills (no token) are excluded.
    const where: string[] = [
      `(b.status='closed' OR (b.status='cancelled' AND b.token_no IS NOT NULL))`,
    ];
    const args: any[] = [];
    // Date filters key off the day the sale settled (closed_at), falling back to
    // opened_at, so a bill shows under the day it was billed.
    const dayExpr = `date(COALESCE(b.closed_at, b.opened_at), 'localtime')`;
    if (params?.from) {
      where.push(`${dayExpr} >= date(?)`);
      args.push(params.from);
    }
    if (params?.to) {
      where.push(`${dayExpr} <= date(?)`);
      args.push(params.to);
    }
    if (params?.status === 'closed') where.push(`b.status='closed'`);
    if (params?.status === 'voided') where.push(`b.status='cancelled'`);
    if (params?.type) {
      where.push(`b.type = ?`);
      args.push(params.type);
    }
    if (params?.meal_type) {
      where.push(`b.meal_type = ?`);
      args.push(params.meal_type);
    }
    if (params?.table_label) {
      where.push(`t.label = ?`);
      args.push(params.table_label);
    }
    if (params?.mode) {
      where.push(`EXISTS (SELECT 1 FROM bill_payments bp WHERE bp.bill_id = b.id AND bp.mode = ?)`);
      args.push(params.mode);
    }
    if (params?.q) {
      where.push(`(b.token_no = ? OR b.customer_name LIKE ? OR b.customer_mobile LIKE ?)`);
      const q = params.q;
      const num = parseInt(q, 10);
      args.push(Number.isFinite(num) ? num : -1, `%${q}%`, `%${q}%`);
    }
    // Combined payment mode(s) per bill, e.g. "cash" or "cash+upi".
    const modeExpr = `(SELECT GROUP_CONCAT(DISTINCT bp.mode) FROM bill_payments bp WHERE bp.bill_id = b.id)`;
    const sql = `SELECT b.id, b.token_no, b.type, b.status, b.meal_type, b.total, b.plates,
                        b.opened_at, b.closed_at, b.cancel_reason, b.customer_name, b.customer_mobile,
                        t.label AS table_label, ${modeExpr} AS modes
                 FROM bills b LEFT JOIN tables t ON t.id=b.table_id
                 WHERE ${where.join(' AND ')}
                 ORDER BY ${dayExpr} DESC, b.token_no DESC, b.id DESC LIMIT 500`;
    const rows = db.prepare(sql).all(...args);
    return { ok: true, bills: rows };
  });

  ipcMain.handle('bills:get', (_e, id: number) => {
    requireSession();
    return { ok: true, bill: getBillForSlip(db, id) };
  });

  ipcMain.handle('bills:reprint', async (_e, id: number) => {
    requireSession();
    const slip = getBillForSlip(db, id);
    const printerName =
      ((db.prepare(`SELECT value FROM settings WHERE key='printer_name'`).get() as
        | { value?: string }
        | undefined)?.value) || '';
    const copies = parseInt(
      ((db.prepare(`SELECT value FROM settings WHERE key='printer_copies'`).get() as
        | { value?: string }
        | undefined)?.value) || '1',
      10
    );
    try {
      await printBill(shopFromSettings(db), slip, printerName, copies);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? String(e) };
    }
  });

  ipcMain.handle('bills:testPrint', async () => {
    const printerName =
      ((db.prepare(`SELECT value FROM settings WHERE key='printer_name'`).get() as
        | { value?: string }
        | undefined)?.value) || '';
    try {
      await printTestSlip(printerName);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? String(e) };
    }
  });

  // Void a finalized (closed) bill: keep the row for the record but flip it to
  // 'cancelled' with a reason. Day-summary / Bills queries key off status, so a
  // voided bill drops out of revenue, plate counts, payment-mode totals, etc.
  ipcMain.handle('bills:void', (_e, { billId, reason }) => {
    requireSession();
    if (!reason || !String(reason).trim())
      return { ok: false, error: 'A reason is required to void a bill.' };
    const r = db
      .prepare(
        `UPDATE bills SET status='cancelled', cancelled_at=datetime('now'),
                cancel_reason=?, sync_status='pending'
         WHERE id=? AND status='closed'`
      )
      .run(String(reason).trim(), billId);
    if (r.changes === 0) return { ok: false, error: 'Only a closed bill can be voided.' };
    scheduleSoon();
    return { ok: true };
  });

  // Admin maintenance: rewrite every bill's plate count using the CURRENT menu
  // plate weights (bills store the weight as it was at sale time, so changing a
  // menu item's plate weight doesn't retroactively fix past bills until this runs).
  // Custom/deleted items fall back to their stored weight (custom = 0).
  ipcMain.handle('bills:recomputePlates', () => {
    requireAdmin();
    // Resolve the current weight by NAME first (menu_items.name is unique and
    // survives an item being re-created with a new id), then by id, then the
    // stored snapshot, then 0. Matching by id alone missed bills that pointed at
    // re-created menu items and wrongly kept the old snapshot weight.
    const r = db
      .prepare(
        `UPDATE bills SET
           plates = (
             SELECT COALESCE(SUM(bi.qty * COALESCE(
                      (SELECT m.plate_weight FROM menu_items m WHERE m.name = bi.name),
                      (SELECT m2.plate_weight FROM menu_items m2 WHERE m2.id = bi.menu_item_id),
                      bi.plate_weight, 0)), 0)
             FROM bill_items bi
             WHERE bi.bill_id = bills.id
           ),
           sync_status = 'pending'`
      )
      .run();
    logAudit(db, 'bills.recomputePlates', { details: { bills: r.changes } });
    scheduleSoon();
    return { ok: true, updated: r.changes };
  });

  // -------- PRE-ORDERS --------
  ipcMain.handle('preorders:list', (_e, params) => {
    requireSession();
    const where: string[] = [];
    const args: any[] = [];
    if (params?.from) { where.push(`for_date >= ?`); args.push(params.from); }
    if (params?.to)   { where.push(`for_date <= ?`); args.push(params.to); }
    if (params?.status) { where.push(`status = ?`); args.push(params.status); }
    const rows = db
      .prepare(
        `SELECT id, order_no, customer_name, customer_mobile, for_date, for_time,
                meal_type, total, advance_paid, balance_due, status, fulfilled_bill_id, created_at
         FROM preorders ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY for_date ASC, for_time ASC, id ASC`
      )
      .all(...args);
    return { ok: true, preorders: rows };
  });

  ipcMain.handle('preorders:get', (_e, id: number) => {
    requireSession();
    const p = db.prepare(`SELECT * FROM preorders WHERE id=?`).get(id);
    if (!p) return { ok: false, error: 'Not found' };
    const items = db
      .prepare(`SELECT * FROM preorder_items WHERE preorder_id=? ORDER BY sort_order, id`)
      .all(id);
    const payments = db
      .prepare(`SELECT * FROM preorder_payments WHERE preorder_id=? ORDER BY id`)
      .all(id);
    return { ok: true, preorder: p, items, payments };
  });

  ipcMain.handle('preorders:create', (_e, payload) => {
    const session = requireSession();
    let id = 0;
    const tx = db.transaction(() => {
      const orderNo = nextOrderNo(db);
      const r = db
        .prepare(
          `INSERT INTO preorders
            (order_no, customer_name, customer_mobile, for_date, for_time, meal_type, notes,
             created_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          orderNo,
          payload.customer_name,
          payload.customer_mobile ?? null,
          payload.for_date,
          payload.for_time ?? null,
          payload.meal_type ?? null,
          payload.notes ?? null,
          session.userId
        );
      id = Number(r.lastInsertRowid);
      const ins = db.prepare(
        `INSERT INTO preorder_items
            (preorder_id, menu_item_id, name, qty, unit_price, total, is_custom, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      payload.items.forEach((it: any, idx: number) => {
        const total = +(it.qty * it.unit_price).toFixed(2);
        ins.run(
          id,
          it.menu_item_id ?? null,
          it.name,
          it.qty,
          it.unit_price,
          total,
          it.is_custom ? 1 : 0,
          idx
        );
      });
      if (payload.advance && payload.advance.amount > 0) {
        db.prepare(
          `INSERT INTO preorder_payments (preorder_id, amount, mode) VALUES (?, ?, ?)`
        ).run(id, payload.advance.amount, payload.advance.mode);
      }
      recomputePreorderTotals(db, id);
    });
    tx();
    scheduleSoon();
    return { ok: true, id };
  });

  ipcMain.handle('preorders:addPayment', (_e, { id, payment }) => {
    requireSession();
    db.prepare(
      `INSERT INTO preorder_payments (preorder_id, amount, mode, notes) VALUES (?, ?, ?, ?)`
    ).run(id, payment.amount, payment.mode, payment.notes ?? null);
    recomputePreorderTotals(db, id);
    scheduleSoon();
    return { ok: true };
  });

  // Discount on a pre-order (typically applied at fulfillment, before the final
  // payment). Reduces the net payable and the balance due. Clamped to the items
  // total; can't change a fulfilled/cancelled order.
  ipcMain.handle('preorders:setDiscount', (_e, { id, amount }) => {
    requireSession();
    const pre = db.prepare(`SELECT status, total FROM preorders WHERE id=?`).get(id) as
      | { status: string; total: number }
      | undefined;
    if (!pre) return { ok: false, error: 'Not found' };
    if (pre.status === 'cancelled' || pre.status === 'fulfilled')
      return { ok: false, error: `Cannot change a ${pre.status} order` };
    const disc = Math.max(0, Math.min(+amount || 0, pre.total));
    db.prepare(`UPDATE preorders SET discount=?, sync_status='pending' WHERE id=?`).run(disc, id);
    recomputePreorderTotals(db, id);
    scheduleSoon();
    return { ok: true };
  });

  // Add extra items to an existing (not yet fulfilled/cancelled) pre-order —
  // e.g. extras requested on the fulfillment day. Raises the total/balance_due;
  // the balance is then settled with a payment dated that day.
  ipcMain.handle('preorders:addItems', (_e, { id, items }) => {
    requireSession();
    const pre = db.prepare(`SELECT status FROM preorders WHERE id=?`).get(id) as
      | { status: string }
      | undefined;
    if (!pre) return { ok: false, error: 'Not found' };
    if (pre.status === 'cancelled' || pre.status === 'fulfilled')
      return { ok: false, error: `Cannot add items to a ${pre.status} order` };
    if (!Array.isArray(items) || items.length === 0)
      return { ok: false, error: 'No items to add' };
    const maxSort = (db
      .prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM preorder_items WHERE preorder_id=?`)
      .get(id) as { m: number }).m;
    const ins = db.prepare(
      `INSERT INTO preorder_items
        (preorder_id, menu_item_id, name, qty, unit_price, total, is_custom, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const tx = db.transaction(() => {
      items.forEach((it: any, idx: number) => {
        const total = +(it.qty * it.unit_price).toFixed(2);
        ins.run(
          id,
          it.menu_item_id ?? null,
          it.name,
          it.qty,
          it.unit_price,
          total,
          it.is_custom ? 1 : 0,
          maxSort + 1 + idx
        );
      });
      recomputePreorderTotals(db, id);
    });
    tx();
    scheduleSoon();
    return { ok: true };
  });

  // Replace a (not yet fulfilled/cancelled) pre-order's full item list — used by
  // the Edit tab to add, change qty/price, or remove existing lines.
  ipcMain.handle('preorders:setItems', (_e, { id, items }) => {
    requireSession();
    const pre = db.prepare(`SELECT status FROM preorders WHERE id=?`).get(id) as
      | { status: string }
      | undefined;
    if (!pre) return { ok: false, error: 'Not found' };
    if (pre.status === 'cancelled' || pre.status === 'fulfilled')
      return { ok: false, error: `Cannot edit a ${pre.status} order` };
    if (!Array.isArray(items) || items.length === 0)
      return { ok: false, error: 'A pre-order needs at least one item' };
    const ins = db.prepare(
      `INSERT INTO preorder_items
        (preorder_id, menu_item_id, name, qty, unit_price, total, is_custom, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM preorder_items WHERE preorder_id=?`).run(id);
      items.forEach((it: any, idx: number) => {
        const total = +(it.qty * it.unit_price).toFixed(2);
        ins.run(id, it.menu_item_id ?? null, it.name, it.qty, it.unit_price, total, it.is_custom ? 1 : 0, idx);
      });
      recomputePreorderTotals(db, id);
    });
    tx();
    scheduleSoon();
    return { ok: true };
  });

  // Set/correct the advance on a not-yet-fulfilled order. Replaces the advance
  // payment(s) with a single payment dated the order's creation day, so it stays
  // counted on the placement day in reports.
  ipcMain.handle('preorders:setAdvance', (_e, { id, amount, mode }) => {
    requireSession();
    const pre = db.prepare(`SELECT status, created_at FROM preorders WHERE id=?`).get(id) as
      | { status: string; created_at: string }
      | undefined;
    if (!pre) return { ok: false, error: 'Not found' };
    if (pre.status === 'cancelled' || pre.status === 'fulfilled')
      return { ok: false, error: `Cannot edit a ${pre.status} order` };
    const amt = Math.max(0, amount || 0);
    const m = mode === 'upi' ? 'upi' : 'cash';
    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM preorder_payments WHERE preorder_id=?`).run(id);
      if (amt > 0) {
        db.prepare(
          `INSERT INTO preorder_payments (preorder_id, amount, mode, received_at) VALUES (?, ?, ?, ?)`
        ).run(id, amt, m, pre.created_at);
      }
      recomputePreorderTotals(db, id);
    });
    tx();
    scheduleSoon();
    return { ok: true };
  });

  // Edit a (not yet fulfilled/cancelled) pre-order's header details.
  ipcMain.handle('preorders:update', (_e, { id, fields }) => {
    requireSession();
    const pre = db.prepare(`SELECT status FROM preorders WHERE id=?`).get(id) as
      | { status: string }
      | undefined;
    if (!pre) return { ok: false, error: 'Not found' };
    if (pre.status === 'cancelled' || pre.status === 'fulfilled')
      return { ok: false, error: `Cannot edit a ${pre.status} order` };
    if (!fields?.customer_name || !fields?.for_date)
      return { ok: false, error: 'Customer name and date are required' };
    const meal = fields.meal_type === 'lunch' || fields.meal_type === 'dinner' ? fields.meal_type : null;
    db.prepare(
      `UPDATE preorders SET customer_name=?, customer_mobile=?, for_date=?, for_time=?,
              meal_type=?, notes=?, sync_status='pending' WHERE id=?`
    ).run(
      fields.customer_name,
      fields.customer_mobile || null,
      fields.for_date,
      fields.for_time || null,
      meal,
      fields.notes || null,
      id
    );
    scheduleSoon();
    return { ok: true };
  });

  ipcMain.handle('preorders:fulfill', (_e, { id, billId }) => {
    requireSession();
    const pre = db
      .prepare(`SELECT status, balance_due FROM preorders WHERE id=?`)
      .get(id) as { status: string; balance_due: number } | undefined;
    if (!pre) return { ok: false, error: 'Not found' };
    if (pre.status === 'cancelled') return { ok: false, error: 'Order is cancelled' };
    // A pre-order cannot be fulfilled while any amount is still due — the
    // balance must be collected at fulfillment.
    if (pre.balance_due > 0.001)
      return { ok: false, error: 'Collect the full balance before marking fulfilled.' };
    db.prepare(
      `UPDATE preorders SET status='fulfilled', fulfilled_at=datetime('now'),
              fulfilled_bill_id=?, sync_status='pending' WHERE id=?`
    ).run(billId ?? null, id);
    scheduleSoon();
    return { ok: true };
  });

  // Cancel/void a pre-order in any state (pending → fulfilled). If it was already
  // fulfilled, also void its linked bill so the sale reverses out of revenue and
  // the day summary. Payment history (advances) is kept as a record of what was
  // actually taken.
  ipcMain.handle('preorders:cancel', (_e, { id, reason }) => {
    requireSession();
    const pre = db.prepare(`SELECT status, fulfilled_bill_id FROM preorders WHERE id=?`).get(id) as
      | { status: string; fulfilled_bill_id: number | null }
      | undefined;
    if (!pre) return { ok: false, error: 'Not found' };
    if (pre.status === 'cancelled') return { ok: false, error: 'Already cancelled' };
    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE preorders SET status='cancelled', cancelled_at=datetime('now'),
                cancel_reason=?, sync_status='pending' WHERE id=?`
      ).run(reason || null, id);
      if (pre.fulfilled_bill_id) {
        db.prepare(
          `UPDATE bills SET status='cancelled', cancelled_at=datetime('now'),
                  cancel_reason=?, sync_status='pending' WHERE id=? AND status='closed'`
        ).run(reason ? `Pre-order voided: ${reason}` : 'Pre-order voided', pre.fulfilled_bill_id);
      }
    });
    tx();
    scheduleSoon();
    return { ok: true };
  });

  ipcMain.handle('preorders:printReceipt', async (_e, id: number) => {
    requireSession();
    const p = db.prepare(`SELECT * FROM preorders WHERE id=?`).get(id) as any;
    if (!p) return { ok: false, error: 'Not found' };
    const items = db
      .prepare(`SELECT name, qty, unit_price, total FROM preorder_items WHERE preorder_id=? ORDER BY sort_order, id`)
      .all(id) as any[];
    const printerName =
      ((db.prepare(`SELECT value FROM settings WHERE key='printer_name'`).get() as
        | { value?: string }
        | undefined)?.value) || '';
    try {
      await printPreorderReceipt(shopFromSettings(db), { ...p, items }, printerName);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? String(e) };
    }
  });

  // -------- DAY SUMMARY --------
  function computeDaySummary(d: string) {
    const totals = db
      .prepare(
        `SELECT COUNT(*) AS bills,
                COALESCE(SUM(total), 0) AS revenue,
                COALESCE(SUM(plates), 0) AS plates
         FROM bills WHERE status='closed' AND date(opened_at,'localtime') = ?`
      )
      .get(d) as { bills: number; revenue: number; plates: number };
    // Money collected today by mode = closed-bill payments + pre-order advances
    // taken today, so it reconciles with the cash/UPI in hand at end of day.
    const byMode = db
      .prepare(
        `SELECT mode, COALESCE(SUM(amt), 0) AS amt FROM (
           SELECT bp.mode AS mode, bp.amount AS amt
             FROM bill_payments bp JOIN bills b ON b.id = bp.bill_id
             WHERE b.status='closed' AND date(b.opened_at,'localtime') = ?
           UNION ALL
           SELECT pp.mode AS mode, pp.amount AS amt
             FROM preorder_payments pp
             WHERE date(pp.received_at,'localtime') = ?
         ) GROUP BY mode`
      )
      .all(d, d) as Array<{ mode: string; amt: number }>;
    const byMeal = db
      .prepare(
        `SELECT meal_type, COUNT(*) AS bills, COALESCE(SUM(plates),0) AS plates,
                COALESCE(SUM(total),0) AS revenue
         FROM bills WHERE status='closed' AND date(opened_at,'localtime') = ?
         GROUP BY meal_type`
      )
      .all(d) as Array<{ meal_type: string; bills: number; plates: number; revenue: number }>;
    const items = db
      .prepare(
        `SELECT bi.name, SUM(bi.qty) AS qty, SUM(bi.total) AS revenue
         FROM bill_items bi
         JOIN bills b ON b.id = bi.bill_id
         WHERE b.status='closed' AND date(b.opened_at,'localtime') = ?
         GROUP BY bi.name ORDER BY qty DESC`
      )
      .all(d) as Array<{ name: string; qty: number; revenue: number }>;
    // All pre-order money collected this day (advance on the placement day,
    // balance + extras on the fulfillment day) — each payment counts on its own
    // received_at date.
    const preorderPaid = (db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS amt FROM preorder_payments
         WHERE date(received_at,'localtime') = ?`
      )
      .get(d) as { amt: number }).amt;
    // Voided bills = once-closed bills (they carry a token) later cancelled.
    const cancelled = db
      .prepare(
        `SELECT id, token_no, total, cancel_reason, cancelled_at
         FROM bills
         WHERE status='cancelled' AND token_no IS NOT NULL
           AND date(opened_at,'localtime') = ?
         ORDER BY cancelled_at DESC`
      )
      .all(d) as Array<{
      id: number;
      token_no: number | null;
      total: number;
      cancel_reason: string | null;
      cancelled_at: string | null;
    }>;
    const cancelledTotal = cancelled.reduce((s, b) => s + b.total, 0);
    const totalCollected = totals.revenue + preorderPaid;
    return {
      date: d,
      totals,
      byMode,
      byMeal,
      items,
      preorderPaid,
      totalCollected,
      cancelled,
      cancelledTotal,
    };
  }

  ipcMain.handle('day:summary', (_e, date?: string) => {
    requireSession();
    const d = date || new Date().toISOString().slice(0, 10);
    return { ok: true, ...computeDaySummary(d) };
  });

  ipcMain.handle('day:printSummary', async (_e, date?: string) => {
    requireSession();
    const d = date || new Date().toISOString().slice(0, 10);
    const summary = computeDaySummary(d);
    const printerName =
      ((db.prepare(`SELECT value FROM settings WHERE key='printer_name'`).get() as
        | { value?: string }
        | undefined)?.value) || '';
    try {
      await printDaySummary(shopFromSettings(db), summary, printerName);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? String(e) };
    }
  });

  // -------- CASH RECONCILIATION --------
  // Previous calendar day as YYYY-MM-DD.
  function prevDayStr(d: string): string {
    const x = new Date(d + 'T00:00:00');
    x.setDate(x.getDate() - 1);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(
      x.getDate()
    ).padStart(2, '0')}`;
  }
  // Cash physically taken in on day `d`: cash-mode bill payments (by close day)
  // plus cash-mode pre-order payments (by received day).
  function cashCollectedFor(d: string): number {
    const bill = (db
      .prepare(
        `SELECT COALESCE(SUM(bp.amount),0) AS a FROM bill_payments bp
         JOIN bills b ON b.id=bp.bill_id
         WHERE b.status='closed' AND bp.mode='cash' AND date(b.closed_at,'localtime')=?`
      )
      .get(d) as { a: number }).a;
    const pre = (db
      .prepare(
        `SELECT COALESCE(SUM(amount),0) AS a FROM preorder_payments
         WHERE mode='cash' AND date(received_at,'localtime')=?`
      )
      .get(d) as { a: number }).a;
    return +(bill + pre).toFixed(2);
  }
  function countedFor(d: string): number | null {
    const r = db.prepare(`SELECT counted_cash FROM cash_counts WHERE date=?`).get(d) as
      | { counted_cash: number }
      | undefined;
    return r ? r.counted_cash : null;
  }

  // Reconcile a day's cash: expected drawer = yesterday's counted close + today's
  // cash taken in; expense = expected − today's counted close (cash paid out).
  ipcMain.handle('cash:get', (_e, date?: string) => {
    requireSession();
    const d = date || new Date().toISOString().slice(0, 10);
    const row = db
      .prepare(`SELECT counted_cash, note, counted_at FROM cash_counts WHERE date=?`)
      .get(d) as { counted_cash: number; note: string | null; counted_at: string } | undefined;
    const prevDate = prevDayStr(d);
    const prevCounted = countedFor(prevDate);
    const todayCash = cashCollectedFor(d);
    const counted = row ? row.counted_cash : null;
    const expected = +((prevCounted ?? 0) + todayCash).toFixed(2);
    // The first day ever counted is just the OPENING BASELINE — the drawer may
    // already hold cash from before the system existed, so it has no expense.
    // The daily expense begins from the next counted day (which has a real
    // previous-day close to compare against).
    const hasEarlier = !!db.prepare(`SELECT 1 FROM cash_counts WHERE date < ? LIMIT 1`).get(d);
    const openingBaseline = prevCounted == null && !hasEarlier;
    const expense =
      counted != null && prevCounted != null ? +(expected - counted).toFixed(2) : null;
    return {
      ok: true,
      date: d,
      counted,
      openingBaseline,
      note: row?.note ?? '',
      countedAt: row?.counted_at ?? null,
      prevDate,
      prevCounted,
      todayCash,
      expected,
      expense,
    };
  });

  ipcMain.handle('cash:set', (_e, { date, counted_cash, note }) => {
    const session = requireSession();
    const d = date || new Date().toISOString().slice(0, 10);
    const amt = Math.max(0, parseFloat(counted_cash) || 0);
    db.prepare(
      `INSERT INTO cash_counts (date, counted_cash, note, counted_by_user_id, counted_at, sync_status)
       VALUES (?, ?, ?, ?, datetime('now'), 'pending')
       ON CONFLICT(date) DO UPDATE SET counted_cash=excluded.counted_cash, note=excluded.note,
         counted_by_user_id=excluded.counted_by_user_id, counted_at=excluded.counted_at,
         sync_status='pending'`
    ).run(d, amt, note || null, session.userId);
    logAudit(db, 'cash.set', { details: { date: d, counted_cash: amt } });
    scheduleSoon();
    return { ok: true };
  });

  // -------- MONEY TRACKER --------
  // Money collected on day `d` for a payment mode: closed bills (by close day) +
  // pre-order payments (by received day).
  function collectedByMode(d: string, mode: PaymentMode): number {
    const bill = (db
      .prepare(
        `SELECT COALESCE(SUM(bp.amount),0) AS a FROM bill_payments bp
         JOIN bills b ON b.id=bp.bill_id
         WHERE b.status='closed' AND bp.mode=? AND date(b.closed_at,'localtime')=?`
      )
      .get(mode, d) as { a: number }).a;
    const pre = (db
      .prepare(
        `SELECT COALESCE(SUM(amount),0) AS a FROM preorder_payments
         WHERE mode=? AND date(received_at,'localtime')=?`
      )
      .get(mode, d) as { a: number }).a;
    return +(bill + pre).toFixed(2);
  }

  // Same, but cumulative up to and including day `d` — used for the running
  // expected balance (carry-forward) of a mode.
  function collectedByModeUpto(d: string, mode: PaymentMode): number {
    const bill = (db
      .prepare(
        `SELECT COALESCE(SUM(bp.amount),0) AS a FROM bill_payments bp
         JOIN bills b ON b.id=bp.bill_id
         WHERE b.status='closed' AND bp.mode=? AND date(b.closed_at,'localtime') <= ?`
      )
      .get(mode, d) as { a: number }).a;
    const pre = (db
      .prepare(
        `SELECT COALESCE(SUM(amount),0) AS a FROM preorder_payments
         WHERE mode=? AND date(received_at,'localtime') <= ?`
      )
      .get(mode, d) as { a: number }).a;
    return +(bill + pre).toFixed(2);
  }

  // Cumulative day_expenses column up to and including day `d`.
  function dayExpenseSumUpto(
    d: string,
    col: 'cash_expense' | 'upi_expense' | 'cash_extra' | 'upi_extra' | 'cash_deposit'
  ): number {
    return +(
      db.prepare(`SELECT COALESCE(SUM(${col}),0) AS a FROM day_expenses WHERE date <= ?`).get(d) as {
        a: number;
      }
    ).a.toFixed(2);
  }

  // Opening cash float — the drawer balance carried over when cash counting
  // began (set from the first counted-cash row on import). It only applies from
  // that opening date onward; earlier dates (the v1 era) have no drawer balance
  // in this app. UPI has no opening float.
  function openingFloat(mode: 'cash' | 'upi', d: string): number {
    if (mode !== 'cash') return 0;
    const get = (k: string) =>
      (db.prepare(`SELECT value FROM settings WHERE key=?`).get(k) as { value?: string } | undefined)
        ?.value;
    const openDate = get('cash_opening_date');
    if (openDate && d < openDate) return 0;
    return parseFloat(get('cash_opening_float') || '0') || 0;
  }

  // Running expected balance of a mode as of end-of-day `d`: opening float +
  // everything taken in (bill/pre-order collections + manual extras) minus
  // everything spent, from the start through `d`. Equivalent to "previous day's
  // expected + today's collected − today's expense".
  function expectedBalance(d: string, mode: 'cash' | 'upi'): number {
    const collected = collectedByModeUpto(d, mode);
    const extra = dayExpenseSumUpto(d, mode === 'cash' ? 'cash_extra' : 'upi_extra');
    const expense = dayExpenseSumUpto(d, mode === 'cash' ? 'cash_expense' : 'upi_expense');
    // Cash deposited / taken out of the drawer also lowers the cash on hand.
    const deposit = mode === 'cash' ? dayExpenseSumUpto(d, 'cash_deposit') : 0;
    return +(openingFloat(mode, d) + collected + extra - expense - deposit).toFixed(2);
  }

  // Per-day money view: what was collected (from sales) vs the expenses the
  // manager entered, plus the derived cash-in-hand and net.
  ipcMain.handle('money:get', (_e, date?: string) => {
    requireSession();
    const d = date || new Date().toISOString().slice(0, 10);
    const cashCollected = collectedByMode(d, 'cash');
    const upiCollected = collectedByMode(d, 'upi');
    const cardCollected = collectedByMode(d, 'card');
    const otherCollected = collectedByMode(d, 'other');
    const row = db
      .prepare(`SELECT cash_expense, upi_expense, cash_extra, upi_extra, cash_deposit, note, updated_at FROM day_expenses WHERE date=?`)
      .get(d) as
      | { cash_expense: number; upi_expense: number; cash_extra: number; upi_extra: number; cash_deposit: number; note: string | null; updated_at: string }
      | undefined;
    const cashExpense = row?.cash_expense ?? 0;
    const upiExpense = row?.upi_expense ?? 0;
    const cashExtra = row?.cash_extra ?? 0; // extra cash in, outside a bill
    const upiExtra = row?.upi_extra ?? 0;
    const cashDeposit = row?.cash_deposit ?? 0; // cash moved to bank / taken out
    // Total money in = sales collected (all modes) + the manual extras.
    const totalCollected = +(cashCollected + upiCollected + cardCollected + otherCollected + cashExtra + upiExtra).toFixed(2);
    // Running expected balances (carry-forward): what should be on hand as of
    // this day, and what was carried in from the previous day.
    const prevD = prevDayStr(d);
    const expectedCash = expectedBalance(d, 'cash');
    const expectedUpi = expectedBalance(d, 'upi');
    const prevExpectedCash = expectedBalance(prevD, 'cash');
    const prevExpectedUpi = expectedBalance(prevD, 'upi');
    return {
      ok: true,
      date: d,
      saved: !!row,
      cashCollected,
      upiCollected,
      cardCollected,
      otherCollected,
      cashExtra,
      upiExtra,
      totalCollected,
      cashExpense,
      upiExpense,
      cashDeposit,
      note: row?.note ?? '',
      updatedAt: row?.updated_at ?? null,
      // Cash physically in hand today: sales cash + extra cash − cash spending − deposits.
      cashInHand: +(cashCollected + cashExtra - cashExpense - cashDeposit).toFixed(2),
      // Overall net after all expenses (extras already fold into totalCollected).
      net: +(totalCollected - cashExpense - upiExpense).toFixed(2),
      // Running carry-forward balances per mode (prev day + today's flow).
      expectedCash,
      expectedUpi,
      prevExpectedCash,
      prevExpectedUpi,
    };
  });

  ipcMain.handle('money:set', (_e, { date, cash_expense, upi_expense, cash_extra, upi_extra, cash_deposit, note }) => {
    const session = requireSession();
    const d = date || new Date().toISOString().slice(0, 10);
    const cash = Math.max(0, parseFloat(cash_expense) || 0);
    const upi = Math.max(0, parseFloat(upi_expense) || 0);
    const cashIn = Math.max(0, parseFloat(cash_extra) || 0);
    const upiIn = Math.max(0, parseFloat(upi_extra) || 0);
    const cashOut = Math.max(0, parseFloat(cash_deposit) || 0);
    db.prepare(
      `INSERT INTO day_expenses (date, cash_expense, upi_expense, cash_extra, upi_extra, cash_deposit, note, updated_by_user_id, updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 'pending')
       ON CONFLICT(date) DO UPDATE SET cash_expense=excluded.cash_expense, upi_expense=excluded.upi_expense,
         cash_extra=excluded.cash_extra, upi_extra=excluded.upi_extra, cash_deposit=excluded.cash_deposit,
         note=excluded.note, updated_by_user_id=excluded.updated_by_user_id, updated_at=excluded.updated_at,
         sync_status='pending'`
    ).run(d, cash, upi, cashIn, upiIn, cashOut, note || null, session.userId);
    logAudit(db, 'money.set', { details: { date: d, cash_expense: cash, upi_expense: upi, cash_extra: cashIn, upi_extra: upiIn, cash_deposit: cashOut } });
    return { ok: true };
  });

  // One-time import: turn the historical end-of-day cash counts (cash_counts,
  // the actual drawer amounts) into the Money model. The first count is the
  // opening float; for each later day the cash flow that isn't explained by
  // sales is booked as a cash expense (money out) or, if the drawer grew beyond
  // sales, as extra cash in. After this, the running Expected-cash reproduces
  // the real counted values and the daily cash expense is filled in.
  ipcMain.handle('money:integrateCashCounts', () => {
    requireAdmin();
    const counts = db
      .prepare(`SELECT date, counted_cash FROM cash_counts ORDER BY date ASC`)
      .all() as Array<{ date: string; counted_cash: number }>;
    if (counts.length === 0) return { ok: true, updated: 0, opening: 0 };

    const opening = counts[0].counted_cash;
    const upsert = db.prepare(
      `INSERT INTO day_expenses (date, cash_expense, cash_extra, updated_at, sync_status)
       VALUES (@date, @cash_expense, @cash_extra, datetime('now'), 'pending')
       ON CONFLICT(date) DO UPDATE SET cash_expense=excluded.cash_expense,
         cash_extra=excluded.cash_extra, updated_at=excluded.updated_at, sync_status='pending'`
    );
    let updated = 0;
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO settings (key, value) VALUES ('cash_opening_float', ?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value`
      ).run(String(opening));
      db.prepare(
        `INSERT INTO settings (key, value) VALUES ('cash_opening_date', ?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value`
      ).run(counts[0].date);
      let prev = opening;
      for (let i = 1; i < counts.length; i++) {
        const { date, counted_cash } = counts[i];
        const cashSales = collectedByMode(date, 'cash');
        // Cash that left the drawer beyond sales = expense; if the drawer grew
        // beyond sales, that surplus is extra cash in.
        const netOut = +(prev + cashSales - counted_cash).toFixed(2);
        const cash_expense = netOut > 0 ? netOut : 0;
        const cash_extra = netOut < 0 ? -netOut : 0;
        upsert.run({ date, cash_expense, cash_extra });
        prev = counted_cash;
        updated++;
      }
    });
    tx();
    logAudit(db, 'money.integrateCashCounts', { details: { days: counts.length, opening } });
    scheduleSoon();
    return { ok: true, updated, opening, from: counts[0].date, to: counts[counts.length - 1].date };
  });

  // History table: collected vs expenses per day over a range (newest first).
  ipcMain.handle('money:range', (_e, params) => {
    requireSession();
    const to = params?.to || new Date().toISOString().slice(0, 10);
    const from =
      params?.from ||
      (() => {
        const d = new Date(to + 'T00:00:00');
        d.setDate(d.getDate() - 29);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      })();

    type Agg = {
      date: string;
      cashCollected: number;
      upiCollected: number;
      otherCollected: number;
      cashExpense: number;
      upiExpense: number;
      note: string;
    };
    const map = new Map<string, Agg>();
    const ensure = (d: string): Agg => {
      let r = map.get(d);
      if (!r) {
        r = { date: d, cashCollected: 0, upiCollected: 0, otherCollected: 0, cashExpense: 0, upiExpense: 0, note: '' };
        map.set(d, r);
      }
      return r;
    };

    const billRows = db
      .prepare(
        `SELECT date(b.closed_at,'localtime') AS d, bp.mode AS mode, COALESCE(SUM(bp.amount),0) AS a
         FROM bill_payments bp JOIN bills b ON b.id=bp.bill_id
         WHERE b.status='closed' AND date(b.closed_at,'localtime')>=date(?) AND date(b.closed_at,'localtime')<=date(?)
         GROUP BY d, mode`
      )
      .all(from, to) as Array<{ d: string; mode: string; a: number }>;
    const preRows = db
      .prepare(
        `SELECT date(received_at,'localtime') AS d, mode, COALESCE(SUM(amount),0) AS a
         FROM preorder_payments
         WHERE date(received_at,'localtime')>=date(?) AND date(received_at,'localtime')<=date(?)
         GROUP BY d, mode`
      )
      .all(from, to) as Array<{ d: string; mode: string; a: number }>;
    for (const r of [...billRows, ...preRows]) {
      const row = ensure(r.d);
      if (r.mode === 'cash') row.cashCollected += r.a;
      else if (r.mode === 'upi') row.upiCollected += r.a;
      else row.otherCollected += r.a;
    }
    const expRows = db
      .prepare(`SELECT date, cash_expense, upi_expense, cash_extra, upi_extra, note FROM day_expenses WHERE date>=? AND date<=?`)
      .all(from, to) as Array<{ date: string; cash_expense: number; upi_expense: number; cash_extra: number; upi_extra: number; note: string | null }>;
    for (const r of expRows) {
      const row = ensure(r.date);
      row.cashExpense = r.cash_expense;
      row.upiExpense = r.upi_expense;
      // Fold the manual extras into that day's cash/UPI "in" so totals & net balance.
      row.cashCollected += r.cash_extra ?? 0;
      row.upiCollected += r.upi_extra ?? 0;
      row.note = r.note ?? '';
    }
    const days = Array.from(map.values())
      .map((r) => {
        const totalCollected = +(r.cashCollected + r.upiCollected + r.otherCollected).toFixed(2);
        return {
          date: r.date,
          cashCollected: +r.cashCollected.toFixed(2),
          upiCollected: +r.upiCollected.toFixed(2),
          otherCollected: +r.otherCollected.toFixed(2),
          totalCollected,
          cashExpense: r.cashExpense,
          upiExpense: r.upiExpense,
          note: r.note,
          net: +(totalCollected - r.cashExpense - r.upiExpense).toFixed(2),
          // Running carry-forward balance as of end of this day.
          expectedCash: expectedBalance(r.date, 'cash'),
          expectedUpi: expectedBalance(r.date, 'upi'),
        };
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    return { ok: true, from, to, days };
  });

  // -------- ANALYTICS --------
  // Aggregates over a date range (keyed off the close day) for the Analytics
  // tab: daily series, by-hour (peak hours), weekday, payment modes, top items,
  // and headline averages. Closed bills only; pre-order payments fold into the
  // collected/mode totals on their received day.
  ipcMain.handle('analytics:overview', (_e, params) => {
    requireSession();
    const to = params?.to || new Date().toISOString().slice(0, 10);
    const from =
      params?.from ||
      (() => {
        const d = new Date(to + 'T00:00:00');
        d.setDate(d.getDate() - 29);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      })();
    const day = `date(b.closed_at, 'localtime')`;
    const closedRange = `b.status='closed' AND ${day} >= date(?) AND ${day} <= date(?)`;

    const daily = db
      .prepare(
        `SELECT ${day} AS date, COUNT(*) AS bills, COALESCE(SUM(b.total),0) AS revenue,
                COALESCE(SUM(b.plates),0) AS plates
         FROM bills b WHERE ${closedRange} GROUP BY date ORDER BY date ASC`
      )
      .all(from, to) as Array<{ date: string; bills: number; revenue: number; plates: number }>;

    const byHour = db
      .prepare(
        `SELECT CAST(strftime('%H', b.closed_at, 'localtime') AS INTEGER) AS hour,
                COUNT(*) AS bills, COALESCE(SUM(b.total),0) AS revenue
         FROM bills b WHERE ${closedRange} GROUP BY hour ORDER BY hour ASC`
      )
      .all(from, to) as Array<{ hour: number; bills: number; revenue: number }>;

    const byWeekday = db
      .prepare(
        `SELECT CAST(strftime('%w', b.closed_at, 'localtime') AS INTEGER) AS dow,
                COUNT(*) AS bills, COALESCE(SUM(b.total),0) AS revenue
         FROM bills b WHERE ${closedRange} GROUP BY dow ORDER BY dow ASC`
      )
      .all(from, to) as Array<{ dow: number; bills: number; revenue: number }>;

    const byMode = db
      .prepare(
        `SELECT mode, COALESCE(SUM(amt),0) AS amt FROM (
           SELECT bp.mode AS mode, bp.amount AS amt
             FROM bill_payments bp JOIN bills b ON b.id=bp.bill_id
             WHERE ${closedRange}
           UNION ALL
           SELECT pp.mode AS mode, pp.amount AS amt FROM preorder_payments pp
             WHERE date(pp.received_at,'localtime') >= date(?) AND date(pp.received_at,'localtime') <= date(?)
         ) GROUP BY mode`
      )
      .all(from, to, from, to) as Array<{ mode: string; amt: number }>;

    const topItems = db
      .prepare(
        `SELECT bi.name, SUM(bi.qty) AS qty, COALESCE(SUM(bi.total),0) AS revenue
         FROM bill_items bi JOIN bills b ON b.id=bi.bill_id
         WHERE ${closedRange} GROUP BY bi.name ORDER BY qty DESC LIMIT 15`
      )
      .all(from, to) as Array<{ name: string; qty: number; revenue: number }>;

    // Pre-order money collected in range (by received day) — folded into total
    // collected but kept distinct from bill revenue.
    const preDaily = db
      .prepare(
        `SELECT date(received_at,'localtime') AS date, COALESCE(SUM(amount),0) AS amt
         FROM preorder_payments
         WHERE date(received_at,'localtime') >= date(?) AND date(received_at,'localtime') <= date(?)
         GROUP BY date`
      )
      .all(from, to) as Array<{ date: string; amt: number }>;
    const preByDate = new Map(preDaily.map((r) => [r.date, r.amt]));
    const preorderCollected = +preDaily.reduce((s, r) => s + r.amt, 0).toFixed(2);

    // Cash taken in per day (cash mode, bills by close day + pre-orders by
    // received day), and the manager's end-of-day counted close per day.
    const cashColl = db
      .prepare(
        `SELECT date, COALESCE(SUM(amt),0) AS amt FROM (
           SELECT date(b.closed_at,'localtime') AS date, bp.amount AS amt
             FROM bill_payments bp JOIN bills b ON b.id=bp.bill_id
             WHERE b.status='closed' AND bp.mode='cash'
               AND date(b.closed_at,'localtime') >= date(?) AND date(b.closed_at,'localtime') <= date(?)
           UNION ALL
           SELECT date(pp.received_at,'localtime') AS date, pp.amount AS amt
             FROM preorder_payments pp WHERE pp.mode='cash'
               AND date(pp.received_at,'localtime') >= date(?) AND date(pp.received_at,'localtime') <= date(?)
         ) GROUP BY date`
      )
      .all(from, to, from, to) as Array<{ date: string; amt: number }>;
    const cashByDate = new Map(cashColl.map((r) => [r.date, r.amt]));
    // Counts in range plus the day before `from` (needed to expense the first day).
    const counts = db
      .prepare(`SELECT date, counted_cash FROM cash_counts WHERE date >= date(?) AND date <= date(?)`)
      .all(prevDayStr(from), to) as Array<{ date: string; counted_cash: number }>;
    const countByDate = new Map(counts.map((r) => [r.date, r.counted_cash]));

    const dateSet = new Set<string>();
    daily.forEach((d) => dateSet.add(d.date));
    cashColl.forEach((r) => dateSet.add(r.date));
    counts.forEach((r) => {
      if (r.date >= from) dateSet.add(r.date);
    });
    // The first counted day is just the opening baseline (no previous close to
    // compare), so it has no expense — daily expense starts from the next count.
    const cash = [...dateSet].sort().map((date) => {
      const collected = +(cashByDate.get(date) ?? 0).toFixed(2);
      const counted = countByDate.has(date) ? countByDate.get(date)! : null;
      const prevCounted = countByDate.has(prevDayStr(date)) ? countByDate.get(prevDayStr(date))! : null;
      const expense =
        counted != null && prevCounted != null
          ? +((prevCounted + collected) - counted).toFixed(2)
          : null;
      return { date, collected, counted, expense };
    });
    const totalCashExpense = +cash.reduce((s, c) => s + (c.expense ?? 0), 0).toFixed(2);

    const dailyOut = daily.map((d) => ({ ...d, preorder: +(preByDate.get(d.date) ?? 0).toFixed(2) }));

    const revenue = daily.reduce((s, d) => s + d.revenue, 0);
    const bills = daily.reduce((s, d) => s + d.bills, 0);
    const plates = daily.reduce((s, d) => s + d.plates, 0);
    const activeDays = daily.length;
    const best = daily.reduce<{ date: string; revenue: number } | null>(
      (m, d) => (!m || d.revenue > m.revenue ? { date: d.date, revenue: d.revenue } : m),
      null
    );
    const peak = byHour.reduce<{ hour: number; revenue: number } | null>(
      (m, h) => (!m || h.revenue > m.revenue ? { hour: h.hour, revenue: h.revenue } : m),
      null
    );

    // Average time to complete a dine-in table = minutes from opened_at to
    // closed_at, over closed dine-in bills in the range.
    const avgRow = db
      .prepare(
        `SELECT AVG((julianday(b.closed_at) - julianday(b.opened_at)) * 1440) AS mins
         FROM bills b
         WHERE b.status='closed' AND b.type='dine_in'
           AND b.closed_at IS NOT NULL AND b.closed_at > b.opened_at
           AND ${day} >= date(?) AND ${day} <= date(?)`
      )
      .get(from, to) as { mins: number | null };
    const avgDineMins = avgRow.mins != null ? Math.round(avgRow.mins) : null;

    return {
      ok: true,
      from,
      to,
      daily: dailyOut,
      byHour,
      byWeekday,
      byMode,
      topItems,
      cash,
      totals: {
        revenue: +revenue.toFixed(2),
        billRevenue: +revenue.toFixed(2),
        preorderCollected,
        totalCollected: +(revenue + preorderCollected).toFixed(2),
        bills,
        plates,
        activeDays,
        avgPerDay: activeDays ? +(revenue / activeDays).toFixed(2) : 0,
        avgPerPlate: plates ? +(revenue / plates).toFixed(2) : 0,
        avgPlatesPerDay: activeDays ? +(plates / activeDays).toFixed(1) : 0,
        avgDineMins,
        totalCashExpense,
        bestDay: best,
        peakHour: peak,
      },
    };
  });

  // -------- AUDIT --------
  ipcMain.handle('audit:list', (_e, params) => {
    requireAdmin();
    const where: string[] = [];
    const args: any[] = [];
    if (params?.from) { where.push(`date(at,'localtime') >= ?`); args.push(params.from); }
    if (params?.to)   { where.push(`date(at,'localtime') <= ?`); args.push(params.to); }
    if (params?.q)    { where.push(`(action LIKE ? OR actor_username LIKE ? OR details LIKE ?)`); args.push(`%${params.q}%`, `%${params.q}%`, `%${params.q}%`); }
    const rows = db
      .prepare(
        `SELECT id, at, actor_username, action, entity_type, entity_id, details
         FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY id DESC LIMIT 500`
      )
      .all(...args);
    return { ok: true, entries: rows };
  });

  // -------- CLOUD (phase 2 — push-only backup to Supabase) --------
  ipcMain.handle('cloud:status', () => {
    return { ok: true, ...cloudStatus() };
  });

  ipcMain.handle('cloud:pushPending', async () => {
    requireAdmin();
    const cfg = cloudStatus();
    if (!cfg.configured)
      return { ok: false, error: 'Supabase URL/key not set. Add them in Settings, then enable cloud sync.' };
    const r = await syncPending();
    if (!r.ok) {
      logAudit(db, 'cloud.pushFailed', { details: { reason: r.reason } });
      return { ok: false, error: r.reason || 'Sync failed' };
    }
    return { ok: true, syncedBills: r.syncedBills, syncedPreorders: r.syncedPreorders };
  });

  // -------- LOCAL BACKUPS --------
  ipcMain.handle('backup:status', () => {
    requireSession();
    const get = (k: string) =>
      (db.prepare(`SELECT value FROM settings WHERE key=?`).get(k) as { value?: string } | undefined)
        ?.value || '';
    return { ok: true, extraDir: get('backup_extra_dir'), lastBackupAt: get('last_backup_at') || null };
  });

  ipcMain.handle('backup:now', async () => {
    requireSession();
    try {
      await backupDatabase();
      const lastBackupAt = (db.prepare(`SELECT value FROM settings WHERE key='last_backup_at'`).get() as
        | { value?: string }
        | undefined)?.value;
      return { ok: true, lastBackupAt };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? String(e) };
    }
  });

  // Pick (or clear) the off-PC backup folder via a native folder dialog.
  ipcMain.handle('backup:chooseDir', async () => {
    requireSession();
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const r = await dialog.showOpenDialog(win!, {
      title: 'Choose a folder for off-PC backups (e.g. OneDrive / Google Drive / USB)',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths[0]) return { ok: true, dir: null };
    const dir = r.filePaths[0];
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('backup_extra_dir', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(dir);
    return { ok: true, dir };
  });

  ipcMain.handle('backup:clearDir', () => {
    requireSession();
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('backup_extra_dir', '')
       ON CONFLICT(key) DO UPDATE SET value = ''`
    ).run();
    return { ok: true };
  });

  // Admin restore: pull all backed-up data from the cloud and OVERWRITE local
  // bills/pre-orders/cash. A local DB backup is taken first as a safety net.
  ipcMain.handle('cloud:pullSnapshot', async () => {
    requireAdmin();
    const cfg = cloudStatus();
    if (!cfg.configured)
      return { ok: false, error: 'Supabase URL/key not set. Add them and enable cloud sync first.' };
    try {
      await backupDatabase();
    } catch {
      // backup is best-effort; continue with the restore
    }
    const r = await pullAndOverride();
    if (r.ok) logAudit(db, 'cloud.restore', { details: { counts: r.counts } });
    return r;
  });

  // Pull down any cloud rows this PC is missing and ADD them (never deletes) —
  // brings in imported/old history and data created on other devices. Safe for
  // any signed-in user and safe to run repeatedly. Returns how many rows were
  // newly added.
  ipcMain.handle('cloud:pullMerge', async () => {
    requireSession();
    const cfg = cloudStatus();
    if (!cfg.configured)
      return { ok: false, error: 'Supabase URL/key not set. Add them and enable cloud sync first.' };
    const r = await pullAndMerge();
    if (r.ok) logAudit(db, 'cloud.pullMerge', { details: { counts: r.counts } });
    return r;
  });

  // Admin: re-upload the ENTIRE local history to the cloud (e.g. to backfill
  // sales from before cloud sync was set up, so the dashboard/analytics show
  // them). Marks all terminal bills, pre-orders and cash counts pending, then
  // drains the sync queue in batches. Uploads only — doesn't affect read egress.
  ipcMain.handle('cloud:resyncAll', async () => {
    requireAdmin();
    const cfg = cloudStatus();
    if (!cfg.configured)
      return { ok: false, error: 'Supabase URL/key not set. Add them and enable cloud sync first.' };
    // Don't re-queue rows pulled from the cloud (imported/other-device history):
    // their ids are above the JS safe-integer range and already exist remotely.
    db.exec(
      `UPDATE bills SET sync_status='pending' WHERE status IN ('closed','cancelled') AND id <= 9007199254740991;
       UPDATE preorders SET sync_status='pending' WHERE id <= 9007199254740991;
       UPDATE cash_counts SET sync_status='pending';`
    );
    const target = pendingCount();
    let iterations = 0;
    while (pendingCount() > 0 && iterations < 500) {
      const r = await syncPending();
      if (!r.ok) return { ok: false, error: r.reason || 'Sync failed', remaining: pendingCount() };
      iterations++;
    }
    const remaining = pendingCount();
    logAudit(db, 'cloud.resyncAll', { details: { queued: target, remaining } });
    return { ok: true, uploaded: target - remaining, remaining };
  });
}
