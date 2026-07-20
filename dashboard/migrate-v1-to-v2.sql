-- One-time: import v1 (Girr Kathiyawadi POS, "public.bills") sales into the v2_
-- dashboard tables so the old history shows in the dashboard Analytics tab.
--
-- v1 stored only aggregate bills (token, plates, meal, total, payment mode,
-- created_at, voided) — no line items — so we import bills + one payment row
-- each. That's enough for revenue, plates, bills count, payment split, by-meal,
-- by-hour/weekday and voids. (Top items won't exist for v1 dates.)
--
-- Safe to re-run: v2 ids are derived deterministically from the v1 UUID and use
-- ON CONFLICT DO NOTHING, so a second run inserts nothing. Runs in the SQL
-- editor as a privileged role, so RLS doesn't block it.
--
-- Timestamps: v1 created_at is timestamptz; we store it as the UTC wall-clock
-- text the v2_ tables use, so the dashboard's timezone grouping stays correct.

insert into v2_bills (
  id, token_no, type, status, table_label, meal_type,
  customer_name, customer_mobile, notes,
  subtotal, discount, total, plates,
  opened_at, closed_at, cancelled_at, cancel_reason
)
select
  ('x' || substr(md5('v1bill:' || b.id::text), 1, 15))::bit(60)::bigint,
  b.token_no,
  'dine_in',
  case when b.voided_at is not null then 'cancelled' else 'closed' end,
  null,
  b.meal_type,
  null, null, null,
  b.total, 0, b.total, b.plates,
  to_char(b.created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  to_char(b.created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  case when b.voided_at is not null
       then to_char(b.voided_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') end,
  b.void_reason
from public.bills b
on conflict (id) do nothing;

insert into v2_bill_payments (id, bill_id, amount, mode, received_at)
select
  ('x' || substr(md5('v1pay:'  || b.id::text), 1, 15))::bit(60)::bigint,
  ('x' || substr(md5('v1bill:' || b.id::text), 1, 15))::bit(60)::bigint,
  b.total,
  b.payment_mode,
  to_char(b.created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS')
from public.bills b
on conflict (id) do nothing;

-- Line items (v1 synced these too) → so top/slow items show for v1 dates.
insert into v2_bill_items (id, bill_id, menu_item_id, name, qty, unit_price, plate_weight, total, is_custom, sort_order)
select
  ('x' || substr(md5('v1item:' || i.id::text), 1, 15))::bit(60)::bigint,
  ('x' || substr(md5('v1bill:' || i.bill_id::text), 1, 15))::bit(60)::bigint,
  null, i.name, i.qty, i.unit_price, coalesce(i.plate_weight, 0), i.total, 0, coalesce(i.sort_order, 0)
from public.bill_items i
where exists (select 1 from public.bills b where b.id = i.bill_id)  -- skip orphans (FK safety)
on conflict (id) do nothing;

-- Sanity check: v1 rows use huge hashed ids; native v2 ids are small integers.
select
  (select count(*) from public.bills)                          as v1_source_bills,
  (select count(*) from v2_bills where id > 1000000000000)      as v1_bills_imported,
  (select count(*) from public.bill_items)                     as v1_source_items,
  (select count(*) from v2_bill_items where id > 1000000000000) as v1_items_imported;
