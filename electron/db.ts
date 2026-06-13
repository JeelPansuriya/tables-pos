import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import Database from 'better-sqlite3';

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;
  const userData = app.getPath('userData');
  if (!fs.existsSync(userData)) fs.mkdirSync(userData, { recursive: true });
  const file = path.join(userData, 'tables-pos.sqlite');
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  initSchema(db);
  dbInstance = db;
  return db;
}

function tableHasColumn(db: Database.Database, table: string, col: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === col);
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('manager','admin')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS tables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL UNIQUE,
      row_no INTEGER NOT NULL,
      sort_order INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      category TEXT,
      lunch_price REAL NOT NULL DEFAULT 0,
      dinner_price REAL NOT NULL DEFAULT 0,
      plate_weight REAL NOT NULL DEFAULT 1,
      shortcut_key TEXT,
      in_stock INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_no INTEGER,
      type TEXT NOT NULL CHECK (type IN ('dine_in','takeaway','preorder_fulfillment')) DEFAULT 'dine_in',
      status TEXT NOT NULL CHECK (status IN ('open','closed','cancelled')) DEFAULT 'open',
      table_id INTEGER REFERENCES tables(id),
      meal_type TEXT NOT NULL CHECK (meal_type IN ('lunch','dinner')) DEFAULT 'dinner',
      customer_name TEXT,
      customer_mobile TEXT,
      notes TEXT,
      subtotal REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      plates REAL NOT NULL DEFAULT 0,
      opened_at TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at TEXT,
      cancelled_at TEXT,
      cancel_reason TEXT,
      created_by_user_id INTEGER REFERENCES users(id),
      closed_by_user_id INTEGER REFERENCES users(id),
      sync_status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE INDEX IF NOT EXISTS idx_bills_status ON bills(status);
    CREATE INDEX IF NOT EXISTS idx_bills_table_status ON bills(table_id, status);
    CREATE INDEX IF NOT EXISTS idx_bills_opened_at ON bills(opened_at);

    CREATE TABLE IF NOT EXISTS bill_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
      menu_item_id INTEGER REFERENCES menu_items(id),
      name TEXT NOT NULL,
      qty REAL NOT NULL,
      unit_price REAL NOT NULL,
      plate_weight REAL NOT NULL DEFAULT 1,
      total REAL NOT NULL,
      is_custom INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bill_items_bill ON bill_items(bill_id);

    CREATE TABLE IF NOT EXISTS bill_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
      amount REAL NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('cash','upi','card','other')),
      received_at TEXT NOT NULL DEFAULT (datetime('now')),
      cash_received REAL,
      change_given REAL,
      notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bill_payments_bill ON bill_payments(bill_id);

    CREATE TABLE IF NOT EXISTS preorders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no INTEGER,
      customer_name TEXT NOT NULL,
      customer_mobile TEXT,
      for_date TEXT NOT NULL,
      for_time TEXT,
      meal_type TEXT CHECK (meal_type IN ('lunch','dinner')),
      notes TEXT,
      total REAL NOT NULL DEFAULT 0,
      advance_paid REAL NOT NULL DEFAULT 0,
      balance_due REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK (status IN ('pending','partial','paid','fulfilled','cancelled')) DEFAULT 'pending',
      fulfilled_bill_id INTEGER REFERENCES bills(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      fulfilled_at TEXT,
      cancelled_at TEXT,
      cancel_reason TEXT,
      created_by_user_id INTEGER REFERENCES users(id),
      sync_status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE INDEX IF NOT EXISTS idx_preorders_status ON preorders(status);
    CREATE INDEX IF NOT EXISTS idx_preorders_for_date ON preorders(for_date);

    CREATE TABLE IF NOT EXISTS preorder_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      preorder_id INTEGER NOT NULL REFERENCES preorders(id) ON DELETE CASCADE,
      menu_item_id INTEGER REFERENCES menu_items(id),
      name TEXT NOT NULL,
      qty REAL NOT NULL,
      unit_price REAL NOT NULL,
      total REAL NOT NULL,
      is_custom INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_preorder_items_preorder ON preorder_items(preorder_id);

    CREATE TABLE IF NOT EXISTS preorder_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      preorder_id INTEGER NOT NULL REFERENCES preorders(id) ON DELETE CASCADE,
      amount REAL NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('cash','upi','card','other')),
      received_at TEXT NOT NULL DEFAULT (datetime('now')),
      notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_preorder_payments_preorder ON preorder_payments(preorder_id);

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL DEFAULT (datetime('now')),
      actor_user_id INTEGER REFERENCES users(id),
      actor_username TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      details TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
  `);

  seedTables(db);
  seedDefaults(db);
  seedAdminUser(db);
}

function seedTables(db: Database.Database) {
  const seeded = (db.prepare(`SELECT value FROM settings WHERE key='tables_seeded'`).get() as { value?: string } | undefined)?.value;
  if (seeded === '1') return;
  const insert = db.prepare(`INSERT OR IGNORE INTO tables (label, row_no, sort_order) VALUES (?, ?, ?)`);
  const tx = db.transaction(() => {
    for (let i = 1; i <= 6; i++) insert.run(`T${i}`, 1, i);
    for (let i = 7; i <= 11; i++) insert.run(`T${i}`, 2, i);
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('tables_seeded', '1')`).run();
  });
  tx();
}

function seedDefaults(db: Database.Database) {
  const defaults: Array<[string, string]> = [
    ['restaurant_name', 'Girr Kathiyawadi'],
    ['restaurant_address', ''],
    ['restaurant_phone', ''],
    ['gst_no', ''],
    ['default_meal_type', 'dinner'],
    ['lunch_until_hour', '16'],
    ['printer_name', ''],
    ['printer_copies', '1'],
    ['supabase_url', ''],
    ['supabase_anon_key', ''],
    ['supabase_table_prefix', 'v2_'],
    ['cloud_sync_enabled', '0'],
    ['discount_max_pct', '20'],
  ];
  const stmt = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
  for (const [k, v] of defaults) stmt.run(k, v);
}

function seedAdminUser(db: Database.Database) {
  const has = (db.prepare(`SELECT COUNT(*) AS c FROM users`).get() as { c: number }).c > 0;
  if (has) return;
  // Bootstrap: a single admin user "owner" / "owner". The first thing the
  // user must do on a fresh install is log in and change the password.
  // We use bcryptjs lazily here to keep db.ts decoupled — actual hashing
  // happens in auth.ts which seeds via this same path. To avoid a circular
  // require, seed a sentinel row that auth.ts will rewrite on first run.
  const sentinelHash = '$2a$10$NnrnP3UM5tbg9YcptVyNK.8TDU2cHnmxxhSkOtL.hKdNNIULZF1pi'; // bcrypt('owner')
  db.prepare(
    `INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')`
  ).run('owner', sentinelHash);
}

// helper exported so IPC layer can use it for ad-hoc migrations
export const dbHelpers = { tableHasColumn };
