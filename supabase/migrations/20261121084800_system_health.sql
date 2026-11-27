-- System health, versions and phone builds in the staff console (Salud del
-- sistema, /salud). Research: support-and-it.md, sections 4.2 D and E, 4.3.
--
-- What this migration decides, and why:
--
--   1. ONE READ FOR THE HEALTH PAGE. public.ops_system_health() answers, in
--      one call, the checks that tell staff something is wrong without
--      waiting for a customer to say so. Each check is a line with a state
--      ('ok', 'attention', 'problem' or 'unknown'), a count and the order
--      numbers or route codes it is about, never a name, phone, address,
--      e-mail or what an order holds. The words are the console's
--      (apps/ops/src/lib/health-labels.ts); the thresholds are here and come
--      back in each line (`minutes`, `parts.attention_from`), so the screen
--      never repeats a number it could get wrong.
--
--      Who sees which line (research table 4.1; admin sees every line):
--        support  messages stopped, messages late (and channels paused),
--                 events that produced no message, complaints not answered
--                 within their target;
--        finance  invoices (rejected, waiting too long, unsent, events with
--                 no document, transmission paused), the signing
--                 certificate, gateway refunds that failed, payments that
--                 failed in the last hour, payment work the worker did not
--                 pick up;
--        ops      the scheduled jobs, unpaid orders past their expiry,
--                 orders paid but never handed to the warehouse, routes
--                 that cannot finish (the same rule as Rutas detenidas,
--                 public.ops_open_routes in 084200);
--        admin    also failed sign-ins in the last hour.
--      Catalogue staff get no line. A line a role does not see is not
--      computed at all for that role.
--
--      Every read is bounded: a partial index on the few open rows of each
--      queue (several added below), or a time window on an indexed column.
--
--   2. CHECKS ADDED BEYOND THE BRIEF, each a failure nothing reported:
--        * messages late: planned messages due more than 10 minutes ago and
--          not sent, events not turned into messages after 10 minutes, and
--          a channel the provider paused. This is what a stopped
--          notification worker or a stopped notify-sweep looks like (a
--          message is only "stopped" once the worker gave up, so a worker
--          that never runs stops nothing);
--        * events that produced no message (outbox jobs of the notification
--          planner that died): an order whose shopper was never told;
--        * payment work not picked up: gateway attempts to create or cancel,
--          and gateway refunds to send, due more than 10 minutes ago. What a
--          stopped payments worker or payments-sweep looks like;
--        * unpaid orders past their expiry (reservation minutes + 15) that
--          were not cancelled: what a stopped expire-unpaid-orders looks
--          like, and their stock stays held meanwhile. It holds on a
--          database with no scheduler too (local work), where it is true.
--      The complaints line is research table 4.1's "complaint part" for
--      support: a complaint with no written answer one working day after it
--      was filed asks for attention (customer-service.md: acknowledged in 1
--      working day), and five working days after is a problem (a written
--      answer within 5). Working days are private.add_business_days, the
--      same the order deadlines use (Monday to Friday, without holidays).
--      The job history alone cannot say any of this on a database without
--      a scheduler; these symptoms can.
--
--   3. THE SCHEDULED JOBS' HISTORY. The seven pg_cron jobs (081300 ×2,
--      082600 ×2, 083300, 083400, 083500) record their runs in
--      cron.job_run_details on a hosted project. A plain PostgreSQL (local
--      work, CI) has no cron schema: there the local hosts in tools/dev-notify
--      and tools/dev-hacienda wake the workers every 2 seconds instead and
--      nothing runs the jobs. The function reads the history with dynamic
--      SQL only when the schema exists, and says `history: 'unavailable'`
--      with a reason ('not_installed', 'not_logged' when cron.log_run is
--      off, 'no_access' when the owner may not read it) rather than "all ran
--      on time" when it cannot know. Each job has a time after which its
--      last run is late; a job not scheduled, switched off, whose last run
--      failed, or that never ran (for one that runs at least hourly) is a
--      problem. The text of a failed run is never read: it may quote data.
--
--   4. health_ping(), for an outside uptime robot: the only function here a
--      visitor may call. It answers {"ok": true} and nothing else (no
--      version, count or name), from the database, so a 200 with that body
--      means the Data API and the database both answer.
--
--   5. VERSIONS. public.ops_versions() (administrators) reads the newest
--      migration the database recorded (supabase_migrations.schema_migrations,
--      the table the hosted project and supabase/scripts/remote-db.sh keep;
--      local-db.sh now keeps it too) and the phone builds administrators
--      entered by hand with public.ops_set_store_build(): app, platform,
--      version, build number, the day it went out and where it is (internal
--      test or public). Entering the same build again updates its day and
--      where it is. A build typed wrong is removed with
--      public.ops_remove_store_build(), so it never stays on the panel as
--      the current one. Each entry and removal is in the audit trail. The web apps' commits
--      are not in the database: the console asks each app (apps/*/src/app/
--      api/version).
--
-- No existing function changes; nothing the shopper app's store build calls
-- is touched.

-- ═══ 1. Indexes the checks read ═════════════════════════════════════════════

-- Messages the provider reported as not delivered (the dead ones have
-- notification_dead_idx since 082600), and sends whose lease ran out
-- (notification_due_idx is by available_at, so it cannot bound those).
create index notification_failed_idx on private.notification_deliveries (created_at desc)
  where status = 'failed';
create index notification_sending_idx on private.notification_deliveries (locked_until)
  where status = 'sending';
-- Events a consumer gave up on.
create index outbox_jobs_dead_idx on private.outbox_jobs (consumer) where status = 'dead';
-- Documents rejected and not replaced, sent and waiting, and not sent yet.
create index electronic_invoices_rejected_open_idx on public.electronic_invoices (rejected_at)
  where status = 'rejected' and replaced_by_id is null;
create index electronic_invoices_sent_idx on public.electronic_invoices (submitted_at)
  where status = 'sent';
create index electronic_invoices_pending_idx on public.electronic_invoices (issued_at)
  where status = 'pending';
-- Gateway refunds that failed and nobody paid another way yet.
create index gateway_refunds_failed_idx on private.gateway_refunds (failed_at)
  where channel = 'gateway' and status = 'failed';
-- Declines and attempts that could not be created, by time.
create index payment_attempts_declined_idx on private.payment_attempts (declined_at)
  where declined_at is not null;
create index payment_attempts_error_idx on private.payment_attempts (updated_at)
  where status = 'error';
-- Attempts only the worker can move on. payment_attempts_work_idx also holds
-- the declined ones, which pile up, so it would be read through them.
create index payment_attempts_worker_due_idx on private.payment_attempts (work_after)
  where status in ('creating', 'cancel_requested');
-- Routes not finished yet (few: a day's routes and the stuck ones).
create index routes_unfinished_idx on public.routes (service_date)
  where status in ('draft', 'assigned', 'in_progress');

-- ═══ 2. Phone builds ════════════════════════════════════════════════════════

create table private.store_builds (
  id uuid primary key default gen_random_uuid(),
  app text not null check (app in ('shop', 'seller', 'driver', 'warehouse')),
  platform text not null check (platform in ('ios', 'android')),
  version text not null check (version ~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$'),
  build_number integer not null check (build_number between 1 and 999999999),
  released_on date not null,
  -- internal: testers only (TestFlight, Play internal testing); public: in the store.
  track text not null check (track in ('internal', 'public')),
  recorded_by uuid,
  recorded_at timestamptz not null default now(),
  unique (app, platform, version, build_number)
);

alter table private.store_builds enable row level security;
revoke all on private.store_builds from public, anon, authenticated;

-- ═══ 3. Helpers ═════════════════════════════════════════════════════════════

-- One line of the health page.
create or replace function private.health_line(
  p_key text,
  p_state text,
  p_count bigint,
  p_since timestamptz default null,
  p_until timestamptz default null,
  p_refs text[] default '{}',
  p_parts jsonb default '{}',
  p_minutes integer default null
) returns jsonb
language sql immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'key', p_key, 'state', p_state, 'count', coalesce(p_count, 0), 'since', p_since,
    'until', p_until, 'refs', to_jsonb(coalesce(p_refs, '{}'::text[])),
    'parts', coalesce(p_parts, '{}'::jsonb), 'minutes', p_minutes);
$$;

-- The scheduled jobs the migrations create, in the order the page lists
-- them: how often each runs and after how long without a run it is late.
create or replace function private.health_jobs() returns jsonb
language sql immutable
set search_path = ''
as $$
  select jsonb_build_array(
    jsonb_build_object('name', 'notify-sweep', 'every_seconds', 30, 'late_after_seconds', 300),
    jsonb_build_object('name', 'invoice-sweep', 'every_seconds', 30, 'late_after_seconds', 300),
    jsonb_build_object('name', 'payments-sweep', 'every_seconds', 60, 'late_after_seconds', 300),
    jsonb_build_object('name', 'expire-unpaid-orders', 'every_seconds', 300, 'late_after_seconds', 1200),
    jsonb_build_object('name', 'auth-attempts-cleanup', 'every_seconds', 3600, 'late_after_seconds', 7800),
    jsonb_build_object('name', 'refresh-product-signals', 'every_seconds', 86400, 'late_after_seconds', 93600),
    jsonb_build_object('name', 'cron-history-cleanup', 'every_seconds', 604800, 'late_after_seconds', 691200));
$$;

-- What the scheduler recorded about each job, or why there is no record.
-- Called only by ops_system_health, as the owner.
create or replace function private.health_job_runs() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_jobs jsonb := private.health_jobs();
  v_runs jsonb;
  v_reason text;
begin
  if to_regclass('cron.job') is null or to_regclass('cron.job_run_details') is null then
    v_reason := 'not_installed';
  elsif coalesce(current_setting('cron.log_run', true), 'on') in ('off', 'false') then
    v_reason := 'not_logged';
  else
    begin
      -- The newest run of each job: the run id only grows, and is the
      -- history's primary key, so this walks back from the newest row and
      -- stops at the first of that job (the history keeps 7 days).
      execute $q$
        select jsonb_agg(jsonb_build_object(
                 'name', e.name, 'scheduled', j.jobid is not null, 'active', coalesce(j.active, false),
                 'last_run_at', r.start_time, 'last_status', r.status) order by e.ord)
        from rows from (jsonb_to_recordset($1) as (name text)) with ordinality as e (name, ord)
        left join lateral (select c.jobid, c.active from cron.job c
                           where c.jobname = e.name order by c.jobid desc limit 1) j on true
        left join lateral (select d.start_time, d.status from cron.job_run_details d
                           where d.jobid = j.jobid order by d.runid desc limit 1) r on true
      $q$ into v_runs using v_jobs;
    exception when insufficient_privilege or undefined_table or undefined_column then
      v_reason := 'no_access';
    end;
  end if;

  return jsonb_build_object(
    'history', case when v_reason is null then 'available' else 'unavailable' end,
    'reason', v_reason,
    'items', (
      select jsonb_agg(
               jsonb_build_object(
                 'name', e.name, 'every_seconds', e.every_seconds,
                 'late_after_seconds', e.late_after_seconds,
                 'last_run_at', r ->> 'last_run_at',
                 'last_status', case when r ->> 'last_status' in ('succeeded', 'failed')
                                     then r ->> 'last_status'
                                     when r ->> 'last_status' is not null then 'running' end)
               || (select jsonb_build_object('state', s.state, 'reason', s.reason)
                   from (select case
                     when v_reason is not null then 'unknown'
                     when not (r ->> 'scheduled')::boolean then 'problem'
                     when not (r ->> 'active')::boolean then 'problem'
                     when r ->> 'last_status' = 'failed' then 'problem'
                     when r ->> 'last_run_at' is null and e.every_seconds <= 3600 then 'problem'
                     when r ->> 'last_run_at' is null then 'unknown'
                     when (r ->> 'last_run_at')::timestamptz
                          < now() - make_interval(secs => e.late_after_seconds) then 'problem'
                     else 'ok' end as state,
                   case
                     when v_reason is not null then 'no_history'
                     when not (r ->> 'scheduled')::boolean then 'not_scheduled'
                     when not (r ->> 'active')::boolean then 'inactive'
                     when r ->> 'last_status' = 'failed' then 'failed'
                     when r ->> 'last_run_at' is null then 'never_ran'
                     when (r ->> 'last_run_at')::timestamptz
                          < now() - make_interval(secs => e.late_after_seconds) then 'late'
                     else 'on_time' end as reason) s)
               order by e.ord)
      from rows from (jsonb_to_recordset(v_jobs)
                      as (name text, every_seconds integer, late_after_seconds integer))
           with ordinality as e (name, every_seconds, late_after_seconds, ord)
      left join lateral (select x from jsonb_array_elements(coalesce(v_runs, '[]')) x
                         where x ->> 'name' = e.name limit 1) rr (r) on true));
end;
$$;

-- ═══ 4. The health page ═════════════════════════════════════════════════════

create or replace function public.ops_system_health() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_support boolean;
  v_finance boolean;
  v_ops boolean;
  v_admin boolean;
  v_lines jsonb := '[]';
  v_jobs jsonb;
  v_late interval := interval '10 minutes';
  n1 bigint;
  n2 bigint;
  n3 bigint;
  n4 bigint;
  t1 timestamptz;
  t2 timestamptz;
  v_refs text[];
  v_window interval;
  v_minutes integer;
  v_today date := private.cr_today();
  h private.invoice_worker_health%rowtype;
begin
  if not private.is_staff() then
    perform private.fail('forbidden');
  end if;
  v_admin := private.has_staff_role('admin');
  v_support := private.has_staff_role('support');
  v_finance := private.has_staff_role('finance');
  v_ops := private.has_staff_role('ops');

  -- ── Messages (support) ───────────────────────────────────────────────────
  if v_support then
    -- Stopped: the worker gave up, or the provider reported it undelivered
    -- (what /mensajes lists, and resends).
    select count(*) into n1 from private.notification_deliveries where status = 'dead';
    select count(*) into n2 from private.notification_deliveries where status = 'failed';
    v_lines := v_lines || private.health_line('messages_stopped',
      case when n1 + n2 > 0 then 'problem' else 'ok' end, n1 + n2,
      p_parts => jsonb_build_object('dead', n1, 'failed', n2));

    -- Late: due and not sent, a send whose lease ran out long ago, events
    -- not planned yet, and channels the provider paused.
    -- Two reads, each a range of its own partial index: one OR across
    -- both made the planner read every planned message.
    select count(*), min(d.available_at) into n1, t1
    from private.notification_deliveries d
    where d.status = 'pending' and d.available_at < now() - v_late;
    select count(*), min(d.available_at) into n3, t2
    from private.notification_deliveries d
    where d.status = 'sending' and d.locked_until < now() - v_late;
    n1 := n1 + n3;
    t1 := least(t1, t2);
    -- Pending planner jobs are few (outbox_jobs_pending_idx holds only them).
    select count(*), min(j.created_at) into n2, t2 from private.outbox_jobs j
    where j.consumer = 'notify' and j.status = 'pending' and j.created_at < now() - v_late;
    t1 := least(t1, t2);
    select coalesce(array_agg(p.channel order by p.channel), '{}'), max(p.paused_until)
    into v_refs, t2
    from private.notify_channel_pauses p where p.paused_until > now();
    v_lines := v_lines || private.health_line('messages_late',
      case when n1 + n2 > 0 or cardinality(v_refs) > 0 then 'problem' else 'ok' end, n1 + n2,
      p_since => t1, p_until => t2, p_refs => v_refs,
      p_parts => jsonb_build_object('waiting', n1, 'unplanned', n2),
      p_minutes => 10);

    -- Events the planner gave up on: nobody was told.
    select count(*) into n1 from private.outbox_jobs where consumer = 'notify' and status = 'dead';
    v_lines := v_lines || private.health_line('events_failed',
      case when n1 > 0 then 'problem' else 'ok' end, n1);

    -- Complaints with no written answer yet (status 'open': answering sets
    -- 'in_progress' or 'resolved'), against their targets in working days.
    -- complaints_open_idx holds only the unresolved ones.
    select count(*) filter (where x.ack_by < v_today),
           count(*) filter (where x.answer_by < v_today),
           min(x.created_at) filter (where x.ack_by < v_today),
           coalesce((array_agg(x.order_number order by x.created_at)
                       filter (where x.ack_by < v_today and x.order_number is not null))[1:10], '{}')
    into n1, n2, t1, v_refs
    from (select c.created_at, o.order_number,
                 private.add_business_days(private.cr_local(c.created_at)::date, 1) as ack_by,
                 private.add_business_days(private.cr_local(c.created_at)::date, 5) as answer_by
          from public.complaints c
          left join public.orders o on o.id = c.order_id
          -- The first condition is complaints_open_idx's own, so its few rows are read.
          where c.status <> 'resolved' and c.status = 'open') x;
    v_lines := v_lines || private.health_line('complaints_late',
      case when n2 > 0 then 'problem' when n1 > 0 then 'attention' else 'ok' end, n1,
      p_since => t1, p_refs => v_refs,
      p_parts => jsonb_build_object('past_answer', n2, 'acknowledge_days', 1, 'answer_days', 5));
  end if;

  -- ── Money and documents (finance) ────────────────────────────────────────
  if v_finance then
    -- The same counts /comprobantes shows (ops_invoices, 083500).
    v_window := make_interval(hours => coalesce((private.invoice_policy() ->> 'answer_window_hours')::integer, 3));
    select count(*) into n1 from public.electronic_invoices
    where status = 'rejected' and replaced_by_id is null;
    select count(*) into n2 from public.electronic_invoices
    where status = 'sent' and submitted_at < now() - v_window;
    select count(*) into n3 from public.electronic_invoices
    where status = 'pending' and (held_reason is not null or issued_at < now() - interval '15 minutes');
    select count(*) into n4 from private.outbox_jobs j
    where j.consumer = 'invoice' and (j.status = 'dead' or (j.status = 'pending' and j.attempts > 0));
    select p.paused_until into t2 from private.invoice_transmission_pause p where p.paused_until > now();
    v_lines := v_lines || private.health_line('invoices',
      case when n1 + n2 + n3 + n4 > 0 or t2 is not null then 'problem' else 'ok' end, n1 + n2 + n3 + n4,
      p_until => t2,
      p_parts => jsonb_build_object('rejected', n1, 'waiting', n2, 'unsent', n3, 'failed_events', n4),
      p_minutes => (extract(epoch from v_window) / 60)::integer);

    -- The signing certificate, as the invoice worker last reported it (on
    -- every run). The worker's error text is not shown: only that there is one.
    select * into h from private.invoice_worker_health;
    v_lines := v_lines || private.health_line('invoice_certificate',
      case when h.id is null then 'unknown'
           when h.error is not null or h.certificate_not_after is null then 'problem'
           when h.certificate_not_after < now() then 'problem'
           when h.certificate_not_after < now() + interval '30 days' then 'attention'
           else 'ok' end,
      null, p_since => h.reported_at, p_until => h.certificate_not_after,
      p_parts => jsonb_build_object('worker_error', case when h.error is not null then 1 else 0 end,
                                    'attention_days', 30));

    -- Refunds the gateway refused; finance retries or pays them by transfer.
    select count(*), min(failed_at) into n1, t1 from private.gateway_refunds
    where channel = 'gateway' and status = 'failed';
    v_lines := v_lines || private.health_line('refunds_failed',
      case when n1 > 0 then 'problem' else 'ok' end, n1, p_since => t1);

    -- Payments in the last hour: declines are often the card's, so they ask
    -- for attention from 5; an attempt that could not be created is ours or
    -- the gateway's.
    select count(*) into n1 from private.payment_attempts where declined_at > now() - interval '1 hour';
    select count(*) into n2 from private.payment_attempts
    where status = 'error' and updated_at > now() - interval '1 hour';
    v_lines := v_lines || private.health_line('payments_failed',
      case when n2 > 0 then 'problem' when n1 >= 5 then 'attention' else 'ok' end, n1 + n2,
      p_parts => jsonb_build_object('declined', n1, 'errors', n2, 'attention_from', 5),
      p_minutes => 60);

    -- Work the payments worker should have picked up.
    select count(*), min(work_after) into n1, t1 from private.payment_attempts
    where status in ('creating', 'cancel_requested') and work_after < now() - v_late;
    select count(*), min(work_after) into n2, t2 from private.gateway_refunds
    where status in ('requested', 'sending') and work_after < now() - v_late;
    v_lines := v_lines || private.health_line('payments_worker',
      case when n1 + n2 > 0 then 'problem' else 'ok' end, n1 + n2, p_since => least(t1, t2),
      p_parts => jsonb_build_object('attempts', n1, 'refunds', n2), p_minutes => 10);
  end if;

  -- ── Jobs, orders and routes (operations) ─────────────────────────────────
  if v_ops then
    v_jobs := private.health_job_runs();
    select count(*) filter (where x ->> 'state' = 'problem'),
           count(*) filter (where x ->> 'state' = 'unknown'),
           coalesce(array_agg(x ->> 'name' order by o) filter (where x ->> 'state' = 'problem'), '{}')
    into n1, n2, v_refs
    from jsonb_array_elements(v_jobs -> 'items') with ordinality as a (x, o);
    v_lines := v_lines || private.health_line('jobs',
      case when n1 > 0 then 'problem' when n2 > 0 then 'unknown' else 'ok' end, n1, p_refs => v_refs,
      p_parts => jsonb_build_object('unknown', n2));

    -- Unpaid orders the expiry job should have cancelled.
    v_minutes := coalesce((private.setting('reservation_minutes'))::integer, 30) + 15;
    select count(*), min(placed_at) into n1, t1 from public.orders
    where status = 'pending_payment' and placed_at < now() - make_interval(mins => v_minutes);
    select coalesce(array_agg(x.order_number order by x.placed_at), '{}') into v_refs
    from (select o.order_number, o.placed_at from public.orders o
          where o.status = 'pending_payment' and o.placed_at < now() - make_interval(mins => v_minutes)
          order by o.placed_at limit 10) x;
    v_lines := v_lines || private.health_line('orders_unpaid_overdue',
      case when n1 > 0 then 'problem' else 'ok' end, n1, p_since => t1, p_refs => v_refs,
      p_minutes => v_minutes);

    -- Paid (or cash) orders whose warehouse parcels never got a pick list:
    -- private.release_order_to_fulfillment did not run for them. Placed in
    -- the last 30 days and more than 30 minutes ago.
    select count(*), min(x.placed_at),
           coalesce((array_agg(x.order_number order by x.placed_at))[1:10], '{}')
    into n1, t1, v_refs
    from (select o.order_number, o.placed_at from public.orders o
          where o.status in ('confirmed', 'processing', 'partially_shipped')
            and o.placed_at > now() - interval '30 days'
            and o.placed_at < now() - interval '30 minutes'
            and exists (select 1 from public.shipments s
                        join public.warehouses w on w.id = s.origin_warehouse_id and w.kind = 'platform'
                        where s.order_id = o.id and s.status = 'pending'
                          and not exists (select 1 from public.pick_tasks t where t.shipment_id = s.id))) x;
    v_lines := v_lines || private.health_line('orders_not_released',
      case when n1 > 0 then 'problem' else 'ok' end, n1, p_since => t1, p_refs => v_refs,
      p_minutes => 30);

    -- Routes that cannot finish: exactly what Rutas detenidas
    -- (public.ops_open_routes, 084200) lists as stuck, so the two pages
    -- agree. An unfinished route whose day has passed, that carries a parcel
    -- cancelled or sent back, or that has no stop left to visit.
    select count(*), count(*) filter (where x.past), count(*) filter (where x.cancelled),
           count(*) filter (where x.no_open), min(x.started_at),
           coalesce((array_agg(x.code order by x.service_date, x.code))[1:10], '{}')
    into n1, n2, n3, n4, t1, v_refs
    from (select r.code, r.service_date, r.started_at,
                 r.service_date < v_today as past,
                 exists (select 1 from public.route_stops rs
                         join public.shipments sh on sh.id = rs.shipment_id
                         where rs.route_id = r.id and rs.status in ('pending', 'arrived')
                           and sh.status in ('cancelled', 'returning', 'returned')) as cancelled,
                 not exists (select 1 from public.route_stops rs
                             where rs.route_id = r.id and rs.status in ('pending', 'arrived')) as no_open
          from public.routes r
          where r.status in ('draft', 'assigned', 'in_progress')) x
    where x.past or x.cancelled or x.no_open;
    v_lines := v_lines || private.health_line('routes_open',
      case when n1 > 0 then 'problem' else 'ok' end, n1, p_since => t1, p_refs => v_refs,
      p_parts => jsonb_build_object('past_date', n2, 'cancelled_parcel', n3, 'no_open_stops', n4));
  end if;

  -- ── Sign-in (administrators) ─────────────────────────────────────────────
  if v_admin then
    -- Wrong passwords: a successful sign-in gives its attempt back
    -- (auth_limit_release), so what is left failed.
    select count(*) into n1 from private.auth_attempts
    where action = 'sign_in' and attempted_at > now() - interval '1 hour';
    v_lines := v_lines || private.health_line('sign_ins_failed',
      case when n1 >= 30 then 'attention' else 'ok' end, n1,
      p_parts => jsonb_build_object('attention_from', 30), p_minutes => 60);
  end if;

  return jsonb_build_object('checked_at', now(), 'lines', v_lines, 'jobs', v_jobs);
end;
$$;

-- ═══ 5. For an outside uptime robot ═════════════════════════════════════════

-- Whether the database answers. Nothing else: no version, count or name.
-- Anyone may call it; there is nothing to check about the caller.
create or replace function public.health_ping() returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object('ok', true);
$$;

-- ═══ 6. Versions and phone builds (administrators) ══════════════════════════

create or replace function private.store_build_json(b private.store_builds) returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', b.id, 'app', b.app, 'platform', b.platform, 'version', b.version,
    'build_number', b.build_number, 'released_on', b.released_on, 'track', b.track,
    'recorded_at', b.recorded_at);
$$;

create or replace function public.ops_versions() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_migration jsonb;
  v_source text := 'available';
begin
  if not private.has_staff_role('admin') then
    perform private.fail('forbidden');
  end if;
  if to_regclass('supabase_migrations.schema_migrations') is null then
    v_source := 'unavailable';
  else
    begin
      execute $q$
        select jsonb_build_object('version', m.version, 'name', m.name,
                                  'count', (select count(*) from supabase_migrations.schema_migrations))
        from supabase_migrations.schema_migrations m order by m.version desc limit 1
      $q$ into v_migration;
    exception when insufficient_privilege or undefined_column then
      v_source := 'unavailable';
    end;
  end if;
  return jsonb_build_object(
    'migration_history', v_source,
    'migration', v_migration,
    'store_builds', coalesce((
      select jsonb_agg(private.store_build_json(b)
                       order by b.app, b.platform, b.released_on desc, b.build_number desc)
      from (select * from private.store_builds x
            order by x.released_on desc, x.build_number desc limit 100) b), '[]'));
end;
$$;

-- Records a phone build in a store, or updates the day and where it is of
-- one already recorded.
create or replace function public.ops_set_store_build(
  p_app text,
  p_platform text,
  p_version text,
  p_build_number integer,
  p_released_on date,
  p_track text
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  b private.store_builds;
  v_old private.store_builds;
begin
  if not private.has_staff_role('admin') then
    perform private.fail('forbidden');
  end if;
  if p_app is null or p_app not in ('shop', 'seller', 'driver', 'warehouse')
     or p_platform is null or p_platform not in ('ios', 'android')
     or p_version is null or p_version !~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$'
     or p_build_number is null or p_build_number not between 1 and 999999999
     or p_released_on is null or p_released_on < date '2026-01-01'
     or p_released_on > (now() at time zone 'America/Costa_Rica')::date
     or p_track is null or p_track not in ('internal', 'public') then
    perform private.fail('store_build_invalid');
  end if;

  select * into v_old from private.store_builds
  where app = p_app and platform = p_platform and version = p_version and build_number = p_build_number
  for update;
  insert into private.store_builds (app, platform, version, build_number, released_on, track, recorded_by)
  values (p_app, p_platform, p_version, p_build_number, p_released_on, p_track, (select auth.uid()))
  on conflict (app, platform, version, build_number) do update
    set released_on = excluded.released_on, track = excluded.track,
        recorded_by = excluded.recorded_by, recorded_at = now()
  returning * into b;

  insert into private.audit_log (actor_id, action, table_name, row_key, old_row, new_row)
  values ((select auth.uid()), case when v_old.id is null then 'INSERT' else 'UPDATE' end,
          'store_builds', b.id::text,
          case when v_old.id is not null then private.store_build_json(v_old) end,
          private.store_build_json(b));
  return private.store_build_json(b);
end;
$$;

-- Removes a build recorded by mistake (a typo in its version or number), so
-- it no longer shows as an app's current build. The audit trail keeps it.
create or replace function public.ops_remove_store_build(p_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  b private.store_builds;
begin
  if not private.has_staff_role('admin') then
    perform private.fail('forbidden');
  end if;
  delete from private.store_builds where id = p_id returning * into b;
  if b.id is null then
    perform private.fail('store_build_not_found');
  end if;
  insert into private.audit_log (actor_id, action, table_name, row_key, old_row, new_row)
  values ((select auth.uid()), 'DELETE', 'store_builds', b.id::text, private.store_build_json(b), null);
  return private.store_build_json(b);
end;
$$;

-- ═══ 7. Grants ══════════════════════════════════════════════════════════════

revoke all on function private.health_line(text, text, bigint, timestamptz, timestamptz, text[], jsonb, integer),
  private.health_jobs(), private.health_job_runs(), private.store_build_json(private.store_builds)
from public, anon, authenticated;

revoke all on function public.ops_system_health(), public.health_ping(), public.ops_versions(),
  public.ops_set_store_build(text, text, text, integer, date, text), public.ops_remove_store_build(uuid)
from public, anon, authenticated;
grant execute on function public.ops_system_health(), public.ops_versions(),
  public.ops_set_store_build(text, text, text, integer, date, text), public.ops_remove_store_build(uuid)
  to authenticated;
-- The uptime robot has only the publishable key: a visitor.
grant execute on function public.health_ping() to anon, authenticated;
