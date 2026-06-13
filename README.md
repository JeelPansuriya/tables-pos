# Girr Kathiyawadi · Tables POS

A clean-rebuild Electron POS for the dinner counter — table-based ordering, custom pre-orders with advance payments, multi-bill per table, cash change calculator, and split payments.

> **Separate from the v1 app** (`POS-Billing-App`). New SQLite database, new app userData directory, new Supabase table prefix (`v2_`). The v1 dinner counter keeps running untouched.

## First run

```sh
npm install
npm run dev          # opens the Electron window with hot reload
```

Default login on a fresh database:

- Username: `owner`
- Password: `owner`

Change it immediately on the **Settings → Change my password** page.

## Build a Windows installer

```sh
npm run build        # produces an NSIS installer in release/
```

`build.appId = com.girrkathiyawadi.tables` — different from the v1 app, so they install side-by-side and keep separate userData dirs.

## Architecture

- `electron/` — main process (DB, IPC, printer)
  - `db.ts` — better-sqlite3 schema + seeds (tables T1–T11, default settings, bootstrap admin)
  - `auth.ts` — bcrypt + session + audit logging
  - `printer.ts` — `electron-pos-printer` slip templates (customer/manager/preorder)
  - `ipc.ts` — IPC handlers grouped by feature
  - `main.ts` — window + autoUpdater wiring
- `src/` — renderer (React + Tailwind)
  - `pages/` — Tables, QuickBill, CustomOrders, Bills, DaySummary, Menu, Settings, Audit
  - `components/BillEditor`, `PaymentBar`, `CashChangeModal`

## Concepts

- **Tables**: 2 rows (T1–T6, T7–T11). Click a tile → if free, opens a new bill; if 1 open bill, loads it; if multiple, shows a picker with "+ New bill" option.
- **Bill lifecycle**: `open` → (Save / Print & Close / Cancel). Token number is assigned at close so cancelled bills don't burn numbers.
- **Pre-orders**: Customer + date + items (menu or custom) + advance payment. Receipt prints on save. Status auto-tracks (pending/partial/paid/fulfilled/cancelled).
- **Split payments**: Each bill stores N rows in `bill_payments` (cash + UPI etc).
- **Cash change**: Cash button opens a calculator with denomination quick-add and Ctrl+Enter to confirm.
- **Audit**: Every mutation goes to `audit_log` with actor + entity + JSON details. Admin-only viewer.

## Cloud sync (phase 2 — not yet wired)

Settings has `supabase_url`, `supabase_anon_key`, and `supabase_table_prefix` (default `v2_`). When implemented, this app will write to `v2_bills`, `v2_bill_items`, etc. — fully isolated from the v1 dataset on the same Supabase project.

## Differences vs. v1 (POS-Billing-App)

- New SQLite schema designed from scratch (no migrations from v1)
- `bill_payments` is a child table, not columns on `bills` — split payments first-class
- `preorders` exists from day 1
- Per-table multi-bill support from day 1
- Audit log
- User accounts beyond a single PIN
- No autoupdate from v1's main branch — this is a separate repo
