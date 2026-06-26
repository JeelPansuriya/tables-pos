# Girr Kathiyawadi · Tables POS

A clean-rebuild Electron POS for the dinner counter — table-based ordering, custom pre-orders with advance payments, multi-bill per table, cash change calculator, and split payments.

> **Separate from the v1 app** (`POS-Billing-App`). New SQLite database, new app userData directory, new Supabase table prefix (`v2_`). The v1 dinner counter keeps running untouched.

## First run

```sh
npm install
npm run rebuild      # rebuild better-sqlite3 against Electron's ABI (required once after install)
npm run dev          # opens the Electron window with hot reload
```

> If the window crashes on launch with a `NODE_MODULE_VERSION` mismatch, re-run `npm run rebuild` — the native `better-sqlite3` binary must match Electron's Node version, not the system Node.

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

## Cloud sync (push-only backup)

Local SQLite is the source of truth. When enabled, the app pushes **closed/cancelled bills and pre-orders** (with their items + payments) up to Supabase in the background — on a 3-minute heartbeat, a few seconds after each bill closes, and via **Sync now** in Settings or the header pill. There is no pull/restore: this is a one-way backup.

Implementation note: we upsert through the PostgREST REST endpoint with a plain `fetch`, not `@supabase/supabase-js` — the JS client needs a global `WebSocket` that Electron's main process doesn't expose. Bills upsert with `ignore-duplicates` (immutable once closed); pre-orders upsert with `merge-duplicates` (they change as payments come in).

### Enabling it

1. In **Settings**, fill in `Supabase URL`, `Supabase anon key`, keep the prefix as `v2_`, and set `Cloud sync enabled` to `1`. Save.
2. Create the `v2_`-prefixed tables on your Supabase project (SQL below). They're isolated from the v1 dataset on the same project.
3. The header shows a **☁ Backed up / N to sync / Sync error** pill; admins can click it to sync immediately.

### Supabase schema

```sql
-- Tables (prefix v2_ matches supabase_table_prefix). Local SQLite uses integer
-- autoincrement ids; this is a single-counter deployment so ids don't collide.
create table if not exists v2_bills (
  id bigint primary key,
  token_no integer, type text, status text, table_label text, meal_type text,
  customer_name text, customer_mobile text, notes text,
  subtotal numeric, discount numeric, total numeric, plates numeric,
  opened_at text, closed_at text, cancelled_at text, cancel_reason text
);
create table if not exists v2_bill_items (
  id bigint primary key, bill_id bigint references v2_bills(id) on delete cascade,
  menu_item_id bigint, name text, qty numeric, unit_price numeric,
  plate_weight numeric, total numeric, is_custom integer, sort_order integer
);
create table if not exists v2_bill_payments (
  id bigint primary key, bill_id bigint references v2_bills(id) on delete cascade,
  amount numeric, mode text, received_at text, cash_received numeric,
  change_given numeric, notes text
);
create table if not exists v2_preorders (
  id bigint primary key,
  order_no integer, customer_name text, customer_mobile text,
  for_date text, for_time text, meal_type text, notes text,
  total numeric, advance_paid numeric, balance_due numeric, status text,
  fulfilled_bill_id bigint, created_at text, fulfilled_at text,
  cancelled_at text, cancel_reason text
);
create table if not exists v2_preorder_items (
  id bigint primary key, preorder_id bigint references v2_preorders(id) on delete cascade,
  menu_item_id bigint, name text, qty numeric, unit_price numeric,
  total numeric, is_custom integer, sort_order integer
);
create table if not exists v2_preorder_payments (
  id bigint primary key, preorder_id bigint references v2_preorders(id) on delete cascade,
  amount numeric, mode text, received_at text, notes text
);

-- RLS: allow the anon key to insert and (for pre-orders) update. Tighten as needed.
alter table v2_bills enable row level security;
alter table v2_bill_items enable row level security;
alter table v2_bill_payments enable row level security;
alter table v2_preorders enable row level security;
alter table v2_preorder_items enable row level security;
alter table v2_preorder_payments enable row level security;

create policy v2_ins on v2_bills            for insert to anon with check (true);
create policy v2_upd on v2_bills            for update to anon using (true) with check (true);
create policy v2_ins on v2_bill_items       for insert to anon with check (true);
create policy v2_ins on v2_bill_payments    for insert to anon with check (true);
create policy v2_ins on v2_preorders        for insert to anon with check (true);
create policy v2_upd on v2_preorders        for update to anon using (true) with check (true);
create policy v2_ins on v2_preorder_items   for insert to anon with check (true);
create policy v2_upd on v2_preorder_items   for update to anon using (true) with check (true);
create policy v2_ins on v2_preorder_payments for insert to anon with check (true);
```

## In-app updates

Builds are published to **GitHub Releases** (public repo). The app uses
`electron-updater`: on launch it checks the latest release, downloads a newer installer in
the background, and the header **update pill** (visible to both managers and admins) shows
progress and a **Restart to update** action. Click the pill any time to check manually.

Releasing a new version (maintainer):

```sh
npm version patch          # bumps version + creates a git tag
git push && git push --tags
```

Pushing a `v*` tag triggers `.github/workflows/release.yml`, which builds the Windows
installer on CI and publishes it — together with the `latest.yml` feed the updater reads —
to the GitHub Release. Installed apps pick it up automatically. The download link for new
users is the latest release's `*.exe` asset.

## Web dashboard (phone-accessible analytics)

`dashboard/` is a standalone Vite + React app (deployed to Vercel) that reads the synced
`v2_` data and shows day summaries and sales trends, gated behind a Supabase Auth login so
it can be opened from any phone. See [dashboard/README.md](dashboard/README.md) for setup
and deployment. It needs SELECT policies for the `authenticated` role:

```sql
create policy v2_sel_auth on v2_bills             for select to authenticated using (true);
create policy v2_sel_auth on v2_bill_items        for select to authenticated using (true);
create policy v2_sel_auth on v2_bill_payments     for select to authenticated using (true);
create policy v2_sel_auth on v2_preorders         for select to authenticated using (true);
create policy v2_sel_auth on v2_preorder_items    for select to authenticated using (true);
create policy v2_sel_auth on v2_preorder_payments for select to authenticated using (true);
```

## Differences vs. v1 (POS-Billing-App)

- New SQLite schema designed from scratch (no migrations from v1)
- `bill_payments` is a child table, not columns on `bills` — split payments first-class
- `preorders` exists from day 1
- Per-table multi-bill support from day 1
- Audit log
- User accounts beyond a single PIN
- No autoupdate from v1's main branch — this is a separate repo
