-- Server-side analytics aggregate for the dashboard.
-- Run this once in the Supabase SQL editor. Re-runnable (create or replace).
--
-- Why: the dashboard used to pull raw rows and aggregate in the browser, which
-- hit PostgREST's ~1000-row cap and grew with volume. This function does all the
-- aggregation in Postgres and returns a small JSON blob, so ANY date range — a
-- week or five years — is a tiny, fast payload and free-tier egress stays flat.
--
-- Timezone: timestamps are stored as UTC text; we convert to the restaurant's
-- business day with ((ts::timestamp at time zone 'UTC') at time zone p_tz).

create or replace function v2_analytics(p_from date, p_to date, p_tz text default 'Asia/Kolkata')
returns jsonb
language sql
security definer
set search_path = public
as $func$
  with b as (
    select id, total, plates, discount,
           ((closed_at::timestamp at time zone 'UTC') at time zone p_tz) as lts,
           ((closed_at::timestamp at time zone 'UTC') at time zone p_tz)::date as d
    from v2_bills
    where status = 'closed' and closed_at is not null
      and ((closed_at::timestamp at time zone 'UTC') at time zone p_tz)::date between p_from and p_to
  ),
  daily_b as (
    select d, count(*)::int as bills, coalesce(sum(total),0)::numeric as revenue,
           coalesce(sum(plates),0)::numeric as plates
    from b group by d
  ),
  pre_d as (
    select ((received_at::timestamp at time zone 'UTC') at time zone p_tz)::date as d,
           coalesce(sum(amount),0)::numeric as amt
    from v2_preorder_payments
    where ((received_at::timestamp at time zone 'UTC') at time zone p_tz)::date between p_from and p_to
    group by 1
  ),
  dates as (select d from daily_b union select d from pre_d),
  daily as (
    select dt.d as date,
           coalesce(db.revenue,0) as billrevenue,
           coalesce(pd.amt,0) as preorder,
           coalesce(db.bills,0) as bills,
           coalesce(db.plates,0) as plates
    from dates dt
    left join daily_b db on db.d = dt.d
    left join pre_d pd on pd.d = dt.d
  ),
  items as (
    select bi.name, sum(bi.qty)::numeric as qty, coalesce(sum(bi.total),0)::numeric as revenue
    from v2_bill_items bi join b on b.id = bi.bill_id
    group by bi.name
  ),
  cash_in as (
    select d, coalesce(sum(amt),0)::numeric as collected from (
      select b.d, bp.amount as amt from v2_bill_payments bp join b on b.id = bp.bill_id where bp.mode = 'cash'
      union all
      select ((pp.received_at::timestamp at time zone 'UTC') at time zone p_tz)::date as d, pp.amount
      from v2_preorder_payments pp
      where pp.mode = 'cash'
        and ((pp.received_at::timestamp at time zone 'UTC') at time zone p_tz)::date between p_from and p_to
    ) x group by d
  )
  select jsonb_build_object(
    'from', to_char(p_from,'YYYY-MM-DD'),
    'to', to_char(p_to,'YYYY-MM-DD'),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object(
                'date', to_char(date,'YYYY-MM-DD'), 'billRevenue', billrevenue,
                'preorder', preorder, 'bills', bills, 'plates', plates) order by date), '[]'::jsonb) from daily),
    'byHour', (select coalesce(jsonb_agg(jsonb_build_object('hour', hr, 'bills', bills, 'revenue', revenue) order by hr), '[]')
               from (select extract(hour from lts)::int as hr, count(*)::int as bills, coalesce(sum(total),0)::numeric as revenue from b group by 1) h),
    'byWeekday', (select coalesce(jsonb_agg(jsonb_build_object('dow', dw, 'bills', bills, 'revenue', revenue) order by dw), '[]')
                  from (select extract(dow from lts)::int as dw, count(*)::int as bills, coalesce(sum(total),0)::numeric as revenue from b group by 1) w),
    'byMode', (select coalesce(jsonb_agg(jsonb_build_object('mode', mode, 'amt', amt)), '[]')
               from (select mode, coalesce(sum(amt),0)::numeric amt from (
                       select bp.mode, bp.amount amt from v2_bill_payments bp join b on b.id = bp.bill_id
                       union all
                       select pp.mode, pp.amount from v2_preorder_payments pp
                        where ((pp.received_at::timestamp at time zone 'UTC') at time zone p_tz)::date between p_from and p_to
                     ) m group by mode) mm),
    'topItems', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'qty', qty, 'revenue', revenue)), '[]')
                 from (select * from items order by qty desc limit 20) t),
    'slowItems', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'qty', qty, 'revenue', revenue)), '[]')
                  from (select * from items where qty > 0 order by qty asc limit 10) t),
    'cashDaily', (select coalesce(jsonb_agg(jsonb_build_object('date', to_char(d,'YYYY-MM-DD'), 'collected', collected) order by d), '[]') from cash_in),
    'counts', (select coalesce(jsonb_agg(jsonb_build_object('date', date, 'counted', counted_cash, 'note', note) order by date), '[]')
               from v2_cash_counts where date::date between (p_from - 1) and p_to),
    'totals', jsonb_build_object(
      'billRevenue', (select coalesce(sum(revenue),0) from daily_b),
      'plates', (select coalesce(sum(plates),0) from daily_b),
      'bills', (select coalesce(sum(bills),0) from daily_b),
      'preorderCollected', (select coalesce(sum(amt),0) from pre_d),
      'activeDays', (select count(*) from daily_b where bills > 0),
      'voidsCount', (select count(*) from v2_bills where status='cancelled' and token_no is not null
                       and ((coalesce(cancelled_at, closed_at)::timestamp at time zone 'UTC') at time zone p_tz)::date between p_from and p_to),
      'voidsTotal', (select coalesce(sum(total),0) from v2_bills where status='cancelled' and token_no is not null
                       and ((coalesce(cancelled_at, closed_at)::timestamp at time zone 'UTC') at time zone p_tz)::date between p_from and p_to),
      'discounts', (select coalesce(sum(discount),0) from b),
      'avgDineMins', (select round(avg(extract(epoch from (closed_at::timestamp - opened_at::timestamp))/60))
                        from v2_bills
                        where status='closed' and type='dine_in' and closed_at is not null and closed_at > opened_at
                          and ((closed_at::timestamp at time zone 'UTC') at time zone p_tz)::date between p_from and p_to),
      'bestDay', (select jsonb_build_object('date', to_char(d,'YYYY-MM-DD'), 'revenue', revenue) from daily_b order by revenue desc limit 1),
      'peakHour', (select jsonb_build_object('hour', hr, 'revenue', revenue)
                     from (select extract(hour from lts)::int as hr, coalesce(sum(total),0)::numeric as revenue from b group by 1 order by 2 desc limit 1) p),
      'prevTotalCollected',
        coalesce((select sum(total) from v2_bills where status='closed'
                    and ((closed_at::timestamp at time zone 'UTC') at time zone p_tz)::date
                        between (p_from - (p_to - p_from + 1)) and (p_from - 1)),0)
      + coalesce((select sum(amount) from v2_preorder_payments
                    where ((received_at::timestamp at time zone 'UTC') at time zone p_tz)::date
                        between (p_from - (p_to - p_from + 1)) and (p_from - 1)),0),
      'mtdTotalCollected',
        coalesce((select sum(total) from v2_bills where status='closed'
                    and ((closed_at::timestamp at time zone 'UTC') at time zone p_tz)::date
                        between date_trunc('month', p_to)::date and p_to),0)
      + coalesce((select sum(amount) from v2_preorder_payments
                    where ((received_at::timestamp at time zone 'UTC') at time zone p_tz)::date
                        between date_trunc('month', p_to)::date and p_to),0)
    )
  )
$func$;

-- Let the dashboard's signed-in users call it (they can't read the raw tables
-- any tighter this way — the function runs as its owner and only returns aggregates).
grant execute on function v2_analytics(date, date, text) to authenticated;
