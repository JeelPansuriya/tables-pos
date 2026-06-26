# Tables POS — Sales Dashboard

A phone-friendly web dashboard that shows day summaries and sales analytics for the
Tables POS. It reads the data the desktop app already pushes to Supabase (the `v2_`
tables) and is gated behind a **Supabase Auth** login, so it can be opened safely from
any phone, anywhere.

> Read-only. This dashboard never writes to the POS data — it only `SELECT`s.

## What it shows

- **Day summary** for any date: collected total, bill sales, bill count, plates, payment-mode
  split (cash/UPI), pre-order advances, and cancelled bills.
- **14-day revenue trend** line chart.
- **Top items** for the selected day and **open pre-orders** with balances due.

Sales are grouped by *business day* in the restaurant's timezone (`VITE_TIMEZONE`,
default `Asia/Kolkata`), so a late-night sale lands on the right day regardless of where
the dashboard is opened.

## One-time Supabase setup

The POS only grants the `anon` key INSERT/UPDATE. The dashboard signs in as a real user,
so add **SELECT policies for the `authenticated` role** and create a viewer account.

1. In the Supabase SQL editor, run:

   ```sql
   -- Let signed-in (authenticated) users read the sales tables.
   create policy v2_sel_auth on v2_bills            for select to authenticated using (true);
   create policy v2_sel_auth on v2_bill_items       for select to authenticated using (true);
   create policy v2_sel_auth on v2_bill_payments    for select to authenticated using (true);
   create policy v2_sel_auth on v2_preorders        for select to authenticated using (true);
   create policy v2_sel_auth on v2_preorder_items   for select to authenticated using (true);
   create policy v2_sel_auth on v2_preorder_payments for select to authenticated using (true);
   ```

2. **Create the login**: Supabase dashboard → **Authentication → Users → Add user** →
   set an email + password (this is what you'll type into the dashboard). Optionally turn
   off public sign-ups under Authentication → Providers so only you can add viewers.

## Local development

```sh
cd dashboard
npm install
cp .env.example .env.local   # fill in your Supabase URL + anon key
npm run dev
```

## Deploy to Vercel

1. Push this repo to GitHub (the dashboard lives in the `dashboard/` subfolder).
2. In Vercel → **New Project** → import the repo.
3. Set **Root Directory** to `dashboard`.
4. Framework preset: **Vite** (Build `npm run build`, Output `dist`).
5. Add **Environment Variables** (from `.env.example`):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_TABLE_PREFIX` (optional, default `v2_`)
   - `VITE_TIMEZONE` (optional, default `Asia/Kolkata`)
6. Deploy. Open the resulting `https://…vercel.app` URL on your phone and sign in.

The anon key is safe to expose to the browser — it's public by design, and RLS + the
login decide what a signed-in user can read.
