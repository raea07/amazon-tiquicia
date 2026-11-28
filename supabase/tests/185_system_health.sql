-- The console's system health page and versions panel (20261121084800):
-- public.ops_system_health, public.health_ping, public.ops_versions and
-- public.ops_set_store_build.
--
--   right caller: each staff role reads exactly its own lines (support the
--                 messages and cases, finance money and documents, ops the jobs,
--                 orders and routes, admin all of them and the sign-ins);
--                 an administrator reads the versions and records a build;
--                 a visitor's ping answers {"ok": true} and nothing else;
--   wrong caller: a visitor cannot read the health page or the versions; a
--                 shopper and a seller are refused; catalogue staff get no
--                 line; no role but admin reads versions or records a build;
--   every line:   reads "ok" when all is well, and turns when the bad state
--                 it watches is made, one at a time (savepoints put the good
--                 state back after each);
--   job history:  with no scheduler here it says "unavailable", never "on
--                 time"; with a scheduler's history (a stand-in cron schema,
--                 made and dropped inside this transaction) it reads each
--                 job's last run; history it may not read, or that is not
--                 logged, is "unavailable" too;
--   left behind:  reading the page writes nothing; recording a build writes
--                 one row and one audit entry, and the same build again
--                 updates it; removing one deletes the row and audits it;
--   privacy:      no name, e-mail, phone or address in any answer.

begin;
\ir _helpers.sql
\ir _money_helpers.sql

-- Staff of each role (new accounts, so a used database's staff are untouched).
select pg_temp.shopper('soporte185@yuntera.example', 'Prueba Soporte');
select pg_temp.shopper('finanzas185@yuntera.example', 'Prueba Finanzas');
select pg_temp.shopper('operaciones185@yuntera.example', 'Prueba Operaciones');
select pg_temp.shopper('catalogo185@yuntera.example', 'Prueba Catalogo');
insert into public.staff_members (user_id, role)
select u.id, r.role::public.staff_role
from (values ('soporte185@yuntera.example', 'support'), ('finanzas185@yuntera.example', 'finance'),
             ('operaciones185@yuntera.example', 'ops'), ('catalogo185@yuntera.example', 'catalog')) r (email, role)
join auth.users u on u.email = r.email;

-- ── Helpers ──────────────────────────────────────────────────────────────────

-- The health page as a signed-in person sees it.
create function pg_temp.health(p_email text) returns jsonb
language plpgsql as $$
declare
  v jsonb;
begin
  perform pg_temp.login(p_email);
  v := public.ops_system_health();
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$$;

create function pg_temp.line(p jsonb, p_key text) returns jsonb
language sql as $$
  select x from jsonb_array_elements(p -> 'lines') x where x ->> 'key' = p_key
$$;

create function pg_temp.state(p jsonb, p_key text) returns text
language sql as $$ select pg_temp.line(p, p_key) ->> 'state' $$;

create function pg_temp.keys(p jsonb) returns text
language sql as $$
  select coalesce(string_agg(x ->> 'key', ',' order by x ->> 'key'), '')
  from jsonb_array_elements(p -> 'lines') x
$$;

-- Every line not named reads "ok" (jobs: "unknown" without a scheduler).
create function pg_temp.others_ok(p jsonb, variadic p_except text[]) returns void
language plpgsql as $$
declare
  x jsonb;
begin
  for x in select * from jsonb_array_elements(p -> 'lines') loop
    continue when x ->> 'key' = any (p_except);
    if x ->> 'key' = 'jobs' then
      assert x ->> 'state' in ('ok', 'unknown'), format('jobs: %s', x);
    else
      assert x ->> 'state' = 'ok', format('%s should be ok, got %s', x ->> 'key', x);
    end if;
  end loop;
end;
$$;

-- Runs a statement as a person and expects it refused with a code.
create function pg_temp.refused_as(p_email text, p_sql text, p_code text) returns void
language plpgsql as $$
begin
  if p_email is null then
    perform pg_temp.login_anon();
  else
    perform pg_temp.login(p_email);
  end if;
  perform pg_temp.refused(p_sql, p_code);
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Writes with the triggers off, so the bad and good states below are made
-- without anything being sent, numbered or audited, and without the
-- lifecycle guards refusing a state a test needs. This switches off the user
-- triggers of exactly the tables those writes touch, and on its first call
-- drops the foreign keys the stand-in payment attempts and gateway refunds
-- point past (their payment, order and refund do not exist). It does not use
-- session_replication_role: on a hosted project the database owner is no
-- superuser and may not set it ("permission denied to set parameter"), while
-- it owns these tables. All of it rolls back with the suite.
create function pg_temp.triggers_off() returns void
language plpgsql as $$
declare
  t text;
  c record;
begin
  foreach t in array array['private.notification_deliveries', 'private.outbox_events', 'private.outbox_jobs',
    'private.notify_channel_pauses', 'public.electronic_invoices', 'private.invoice_transmission_pause',
    'private.invoice_worker_health', 'private.gateway_refunds', 'private.payment_attempts', 'public.orders',
    'public.shipments', 'public.routes', 'public.route_stops', 'public.complaints', 'private.cases',
    'private.auth_attempts'] loop
    execute format('alter table %s disable trigger user', t);
  end loop;
  for c in
    select k.conrelid::regclass as tbl, k.conname from pg_constraint k
    where k.contype = 'f'
      and ((k.conrelid = 'private.payment_attempts'::regclass
            and k.confrelid in ('public.payments'::regclass, 'public.orders'::regclass))
        or (k.conrelid = 'private.gateway_refunds'::regclass and k.confrelid = 'private.refunds'::regclass))
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
end;
$$;

create function pg_temp.triggers_on() returns void
language plpgsql as $$
declare
  t text;
begin
  foreach t in array array['private.notification_deliveries', 'private.outbox_events', 'private.outbox_jobs',
    'private.notify_channel_pauses', 'public.electronic_invoices', 'private.invoice_transmission_pause',
    'private.invoice_worker_health', 'private.gateway_refunds', 'private.payment_attempts', 'public.orders',
    'public.shipments', 'public.routes', 'public.route_stops', 'public.complaints', 'private.cases',
    'private.auth_attempts'] loop
    execute format('alter table %s enable trigger user', t);
  end loop;
end;
$$;

-- Brings every check into its good state, whatever the database held:
-- written with the triggers off (pg_temp.triggers_off), so nothing is
-- sent, numbered or audited by it. All of it rolls back with the suite.
create function pg_temp.all_good() returns void
language plpgsql as $$
begin
  perform pg_temp.triggers_off();
  update private.notification_deliveries set status = 'sent', sent_at = coalesce(sent_at, now())
  where status in ('dead', 'failed', 'pending', 'sending');
  update private.outbox_jobs set status = 'done', done_at = now() where status in ('pending', 'dead');
  delete from private.notify_channel_pauses;
  update public.electronic_invoices set status = 'accepted' where status in ('rejected', 'sent', 'pending');
  delete from private.invoice_transmission_pause;
  insert into private.invoice_worker_health (id, reported_at, environment, certificate_not_after, error)
  values (true, now(), 'test', now() + interval '1 year', null)
  on conflict (id) do update set reported_at = now(), certificate_not_after = now() + interval '1 year',
                                 error = null;
  update private.gateway_refunds set status = 'succeeded' where status in ('failed', 'requested', 'sending');
  update private.payment_attempts set declined_at = null where declined_at is not null;
  update private.payment_attempts set status = 'expired' where status in ('error', 'creating', 'cancel_requested');
  update public.orders set status = 'cancelled'
  where status = 'pending_payment' and placed_at < now() - interval '40 minutes';
  update public.shipments s set status = 'cancelled'
  from public.orders o, public.warehouses w
  where o.id = s.order_id and w.id = s.origin_warehouse_id and w.kind = 'platform'
    and s.status = 'pending' and o.status in ('confirmed', 'processing', 'partially_shipped')
    and o.placed_at < now() - interval '30 minutes'
    and not exists (select 1 from public.pick_tasks t where t.shipment_id = s.id);
  -- Routes the console calls stuck (ops_open_routes): set aside.
  update public.routes r set status = 'cancelled'
  where r.status in ('draft', 'assigned', 'in_progress')
    and (r.service_date < private.cr_today()
         or exists (select 1 from public.route_stops rs join public.shipments sh on sh.id = rs.shipment_id
                    where rs.route_id = r.id and rs.status in ('pending', 'arrived')
                      and sh.status in ('cancelled', 'returning', 'returned'))
         or not exists (select 1 from public.route_stops rs
                        where rs.route_id = r.id and rs.status in ('pending', 'arrived')));
  update public.complaints set status = 'resolved', resolved_at = now(), resolution = 'Prueba 185 resuelta'
  where status = 'open';
  -- Open cases (the seed's backfilled complaints, returns and reports among
  -- them) set aside, so the cases line reads good.
  update private.cases set status = 'closed', resolved_at = now() where status = 'open';
  delete from private.auth_attempts where action = 'sign_in';
  perform pg_temp.triggers_on();
end;
$$;

-- A planned message, for the message checks (the seed plans none: the
-- notification worker does that).
create function pg_temp.delivery(p_status text, p_available timestamptz) returns uuid
language sql as $$
  insert into private.notification_deliveries
    (dedupe_key, ordering_key, sequence, channel, template, recipient, audience, context, status, available_at)
  values ('test185/' || gen_random_uuid(), 'test185', 1, 'email', 'order_confirmed', 'team:test185',
          'staff', '{}', p_status, p_available)
  returning id
$$;

-- An outbox event routed to a consumer, in the given state, with no worker woken.
create function pg_temp.outbox_job(p_consumer text, p_status text, p_attempts integer,
                                   p_created timestamptz) returns void
language plpgsql as $$
declare
  v_event bigint;
begin
  perform pg_temp.triggers_off();
  insert into private.outbox_events (topic, payload) values ('test185.event', '{}') returning id into v_event;
  insert into private.outbox_jobs (event_id, consumer, status, attempts, created_at)
  values (v_event, p_consumer, p_status, p_attempts, p_created);
  perform pg_temp.triggers_on();
end;
$$;

-- A document in a state, without numbering or sending it.
create function pg_temp.invoice(p_status text, p_at timestamptz, p_held text default null) returns void
language plpgsql as $$
begin
  perform pg_temp.triggers_off();
  insert into public.electronic_invoices
    (document_type, status, total_minor, kind, rejected_at, submitted_at, issued_at, held_reason)
  values ('04', p_status::public.invoice_status, 100000, 'delivery',
          case when p_status = 'rejected' then p_at end,
          case when p_status = 'sent' then p_at end, p_at, p_held);
  perform pg_temp.triggers_on();
end;
$$;

-- A gateway attempt in a state.
create function pg_temp.attempt(p_status text, p_declined timestamptz default null,
                                p_work_after timestamptz default now()) returns void
language plpgsql as $$
begin
  perform pg_temp.triggers_off();
  insert into private.payment_attempts
    (payment_id, order_id, provider, environment, method, amount_minor, status, declined_at,
     work_after, expires_at)
  values (gen_random_uuid(), gen_random_uuid(), 'onvo', 'test', 'card', 100000, p_status, p_declined,
          p_work_after, now() + interval '30 minutes');
  perform pg_temp.triggers_on();
end;
$$;

-- A gateway refund in a state.
create function pg_temp.gateway_refund(p_status text, p_work_after timestamptz default now(),
                                       p_channel text default 'gateway') returns void
language plpgsql as $$
begin
  perform pg_temp.triggers_off();
  insert into private.gateway_refunds (refund_id, channel, amount_minor, status, failed_at, work_after)
  values (gen_random_uuid(), p_channel, 50000, p_status,
          case when p_status = 'failed' then now() - interval '2 hours' end, p_work_after);
  perform pg_temp.triggers_on();
end;
$$;

select pg_temp.all_good();

-- ═══ Who sees which lines ════════════════════════════════════════════════════

do $$
declare
  v jsonb;
begin
  v := pg_temp.health('central@yuntera.example');
  assert pg_temp.keys(v) = 'cases_late,events_failed,invoice_certificate,invoices,jobs,messages_late,'
    'messages_stopped,orders_not_released,orders_unpaid_overdue,payments_failed,payments_worker,'
    'refunds_failed,routes_open,sign_ins_failed', format('admin lines: %s', pg_temp.keys(v));
  assert v -> 'jobs' ? 'items' and jsonb_array_length(v -> 'jobs' -> 'items') = 7, 'admin: the seven jobs';
  assert v ->> 'checked_at' is not null, 'admin: checked_at';
  -- The good state reads as good.
  perform pg_temp.others_ok(v, 'invoice_certificate');
  assert pg_temp.state(v, 'invoice_certificate') = 'ok', 'certificate ok a year ahead';

  v := pg_temp.health('soporte185@yuntera.example');
  assert pg_temp.keys(v) = 'cases_late,events_failed,messages_late,messages_stopped',
    format('support lines: %s', pg_temp.keys(v));
  assert v -> 'jobs' = 'null'::jsonb, 'support: no jobs';

  v := pg_temp.health('finanzas185@yuntera.example');
  assert pg_temp.keys(v) = 'invoice_certificate,invoices,payments_failed,payments_worker,refunds_failed',
    format('finance lines: %s', pg_temp.keys(v));
  assert v -> 'jobs' = 'null'::jsonb, 'finance: no jobs';

  v := pg_temp.health('operaciones185@yuntera.example');
  assert pg_temp.keys(v) = 'jobs,orders_not_released,orders_unpaid_overdue,routes_open',
    format('ops lines: %s', pg_temp.keys(v));
  assert jsonb_array_length(v -> 'jobs' -> 'items') = 7, 'ops: the seven jobs';

  -- Wrong callers.
  v := pg_temp.health('catalogo185@yuntera.example');
  assert jsonb_array_length(v -> 'lines') = 0 and v -> 'jobs' = 'null'::jsonb,
    format('catalogue: nothing, got %s', v);
  perform pg_temp.refused_as(null, 'select public.ops_system_health()', 'forbidden');
  perform pg_temp.refused_as('comprador@yuntera.example', 'select public.ops_system_health()', 'forbidden');
  perform pg_temp.refused_as('vendedor@yuntera.example', 'select public.ops_system_health()', 'forbidden');
end $$;

-- Reading the page writes nothing.
do $$
declare
  v_audit bigint := (select count(*) from private.audit_log);
  v_jobs bigint := (select count(*) from private.outbox_jobs);
  v_events bigint := (select count(*) from private.outbox_events);
begin
  perform pg_temp.health('central@yuntera.example');
  perform pg_temp.health('operaciones185@yuntera.example');
  assert (select count(*) from private.audit_log) = v_audit, 'no audit entry';
  assert (select count(*) from private.outbox_jobs) = v_jobs
     and (select count(*) from private.outbox_events) = v_events, 'no event';
end $$;

-- ═══ Each line, bad and good ═════════════════════════════════════════════════

-- Messages stopped: a dead letter and an undelivered one.
savepoint s;
do $$
declare
  v jsonb;
begin
  perform pg_temp.delivery('dead', now() - interval '2 days');
  perform pg_temp.delivery('failed', now() - interval '1 day');
  v := pg_temp.health('soporte185@yuntera.example');
  assert pg_temp.state(v, 'messages_stopped') = 'problem', format('stopped: %s', pg_temp.line(v, 'messages_stopped'));
  assert (pg_temp.line(v, 'messages_stopped') -> 'count')::int = 2
     and pg_temp.line(v, 'messages_stopped') -> 'parts' = '{"dead": 1, "failed": 1}', 'stopped: counts';
  perform pg_temp.others_ok(v, 'messages_stopped');
  -- A message sent is not stopped.
  perform pg_temp.delivery('sent', now() - interval '1 day');
end $$;
rollback to savepoint s;

-- Each kind alone turns the line: one the provider reported undelivered, and
-- one the worker gave up on.
savepoint s;
do $$
declare
  v jsonb;
  d uuid;
begin
  d := pg_temp.delivery('failed', now() - interval '1 day');
  v := pg_temp.health('soporte185@yuntera.example');
  assert pg_temp.state(v, 'messages_stopped') = 'problem'
     and pg_temp.line(v, 'messages_stopped') -> 'parts' = '{"dead": 0, "failed": 1}', 'stopped: undelivered alone';
  update private.notification_deliveries set status = 'dead' where id = d;
  v := pg_temp.health('soporte185@yuntera.example');
  assert pg_temp.state(v, 'messages_stopped') = 'problem'
     and pg_temp.line(v, 'messages_stopped') -> 'parts' = '{"dead": 1, "failed": 0}', 'stopped: dead alone';
end $$;
rollback to savepoint s;

-- Messages late: due 20 minutes ago and not sent; a send whose lease ran out;
-- an event not planned; a channel paused. Each alone turns the line.
savepoint s;
do $$
declare
  v jsonb;
begin
  perform pg_temp.delivery('pending', now() - interval '9 minutes');
  v := pg_temp.health('soporte185@yuntera.example');
  assert pg_temp.state(v, 'messages_late') = 'ok', 'late: 9 minutes is not late';
  perform pg_temp.delivery('pending', now() - interval '20 minutes');
  v := pg_temp.health('soporte185@yuntera.example');
  assert pg_temp.state(v, 'messages_late') = 'problem', format('late: %s', pg_temp.line(v, 'messages_late'));
  assert pg_temp.line(v, 'messages_late') -> 'parts' = '{"waiting": 1, "unplanned": 0}', 'late: one waiting';
  assert (pg_temp.line(v, 'messages_late') ->> 'since')::timestamptz < now() - interval '19 minutes', 'late: since';
  perform pg_temp.others_ok(v, 'messages_late');
end $$;
rollback to savepoint s;

savepoint s;
do $$
declare
  v jsonb;
  d uuid;
begin
  d := pg_temp.delivery('sending', now() - interval '30 minutes');
  update private.notification_deliveries set locked_until = now() - interval '5 minutes' where id = d;
  v := pg_temp.health('soporte185@yuntera.example');
  assert pg_temp.state(v, 'messages_late') = 'ok', 'late: a lease out 5 minutes ago is not late yet';
  update private.notification_deliveries set locked_until = now() - interval '15 minutes' where id = d;
  v := pg_temp.health('soporte185@yuntera.example');
  assert pg_temp.state(v, 'messages_late') = 'problem', 'late: a send stuck for 15 minutes';
end $$;
rollback to savepoint s;

savepoint s;
do $$
declare
  v jsonb;
begin
  perform pg_temp.outbox_job('notify', 'pending', 0, now() - interval '2 minutes');
  v := pg_temp.health('soporte185@yuntera.example');
  assert pg_temp.state(v, 'messages_late') = 'ok', 'late: an event of 2 minutes ago';
  perform pg_temp.outbox_job('notify', 'pending', 0, now() - interval '25 minutes');
  v := pg_temp.health('soporte185@yuntera.example');
  assert pg_temp.state(v, 'messages_late') = 'problem'
     and pg_temp.line(v, 'messages_late') -> 'parts' = '{"waiting": 0, "unplanned": 1}', 'late: an event unplanned';
end $$;
rollback to savepoint s;

savepoint s;
do $$
declare
  v jsonb;
begin
  insert into private.notify_channel_pauses (channel, paused_until, reason)
  values ('whatsapp', now() + interval '1 hour', 'credentials'), ('sms', now() - interval '1 minute', 'over');
  v := pg_temp.health('soporte185@yuntera.example');
  assert pg_temp.state(v, 'messages_late') = 'problem', 'late: a channel paused';
  assert pg_temp.line(v, 'messages_late') -> 'refs' = '["whatsapp"]', 'late: only the pause still running';
  assert pg_temp.line(v, 'messages_late') ->> 'until' is not null, 'late: until when';
end $$;
rollback to savepoint s;

-- Events the planner gave up on.
savepoint s;
do $$
declare
  v jsonb;
begin
  perform pg_temp.outbox_job('notify', 'dead', 10, now() - interval '1 day');
  perform pg_temp.outbox_job('invoice', 'done', 1, now() - interval '1 day');
  v := pg_temp.health('soporte185@yuntera.example');
  assert pg_temp.state(v, 'events_failed') = 'problem'
     and (pg_temp.line(v, 'events_failed') -> 'count')::int = 1, 'events: one dead';
  perform pg_temp.others_ok(v, 'events_failed');
end $$;
rollback to savepoint s;

-- Cases against their targets (the support desk's due times, 084700): a new
-- case is ok; past its first-response time attention; past its resolution
-- time a problem; answered and closed ones never count. The line counts what
-- the desk's own "Hoy" line counts (ops_cases_due), and never the case text.
savepoint s;
do $$
declare
  v jsonb;
  c uuid;
  k uuid;
  o uuid := pg_temp.paid_order('salud-185-reclamo');
  n text := (select order_number from public.orders where id = o);
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.complaints (user_id, order_id, category, description)
  select o2.user_id, o2.id, 'delivery', 'Prueba 185: el paquete no llegó a tiempo.'
  from public.orders o2 where o2.id = o
  returning id into c;
  select id into k from private.cases where complaint_id = c;
  v := pg_temp.health('soporte185@yuntera.example');
  assert pg_temp.state(v, 'cases_late') = 'ok', format('cases: just filed, %s', pg_temp.line(v, 'cases_late'));
  perform pg_temp.others_ok(v, 'none');

  -- Past its first-response time, not its resolution time.
  update private.cases set first_response_due_at = now() - interval '1 minute' where id = k;
  v := pg_temp.health('soporte185@yuntera.example');
  assert pg_temp.state(v, 'cases_late') = 'attention'
     and (pg_temp.line(v, 'cases_late') -> 'count')::int = 1
     and (pg_temp.line(v, 'cases_late') -> 'parts' ->> 'past_resolution')::int = 0
     and (pg_temp.line(v, 'cases_late') -> 'parts' ->> 'past_first_response')::int = 1
     and pg_temp.line(v, 'cases_late') -> 'refs' = jsonb_build_array(n),
    format('cases: past the first response, %s', pg_temp.line(v, 'cases_late'));
  perform pg_temp.others_ok(v, 'cases_late');

  -- Past its resolution time too.
  update private.cases set due_at = now() - interval '1 minute' where id = k;
  v := pg_temp.health('soporte185@yuntera.example');
  assert pg_temp.state(v, 'cases_late') = 'problem'
     and (pg_temp.line(v, 'cases_late') -> 'parts' ->> 'past_resolution')::int = 1,
    format('cases: past the resolution, %s', pg_temp.line(v, 'cases_late'));

  -- Answered (the first response given) and still within its resolution time.
  update private.cases set due_at = now() + interval '1 day', first_response_at = now() where id = k;
  v := pg_temp.health('soporte185@yuntera.example');
  assert pg_temp.state(v, 'cases_late') = 'ok', 'cases: answered in time';
  -- Closed.
  update private.cases set due_at = now() - interval '1 minute', status = 'closed', resolved_at = now()
  where id = k;
  v := pg_temp.health('soporte185@yuntera.example');
  assert pg_temp.state(v, 'cases_late') = 'ok', 'cases: closed';
  assert v::text not like '%paquete no llegó%', 'cases: the complaint''s text is never shown';
end $$;
rollback to savepoint s;

-- Invoices: rejected, waiting past the answer window, not sent, an event with
-- no document, the transmission paused. Each alone.
savepoint s;
do $$
declare
  v jsonb;
begin
  perform pg_temp.invoice('rejected', now() - interval '1 hour');
  v := pg_temp.health('finanzas185@yuntera.example');
  assert pg_temp.state(v, 'invoices') = 'problem'
     and (pg_temp.line(v, 'invoices') -> 'parts' ->> 'rejected')::int = 1, 'invoices: rejected';
  perform pg_temp.others_ok(v, 'invoices');
end $$;
rollback to savepoint s;

savepoint s;
do $$
declare
  v jsonb;
begin
  perform pg_temp.invoice('sent', now() - interval '2 hours');
  v := pg_temp.health('finanzas185@yuntera.example');
  assert pg_temp.state(v, 'invoices') = 'ok', 'invoices: waiting 2 hours is within the window';
  assert (pg_temp.line(v, 'invoices') ->> 'minutes')::int = 180, 'invoices: the window, in minutes';
  perform pg_temp.invoice('sent', now() - interval '4 hours');
  v := pg_temp.health('finanzas185@yuntera.example');
  assert pg_temp.state(v, 'invoices') = 'problem'
     and (pg_temp.line(v, 'invoices') -> 'parts' ->> 'waiting')::int = 1, 'invoices: waiting too long';
end $$;
rollback to savepoint s;

savepoint s;
do $$
declare
  v jsonb;
begin
  perform pg_temp.invoice('pending', now() - interval '5 minutes');
  v := pg_temp.health('finanzas185@yuntera.example');
  assert pg_temp.state(v, 'invoices') = 'ok', 'invoices: unsent for 5 minutes';
  perform pg_temp.invoice('pending', now() - interval '1 minute', 'cabys_missing');
  v := pg_temp.health('finanzas185@yuntera.example');
  assert pg_temp.state(v, 'invoices') = 'problem'
     and (pg_temp.line(v, 'invoices') -> 'parts' ->> 'unsent')::int = 1, 'invoices: held by the checks';
end $$;
rollback to savepoint s;

savepoint s;
do $$
declare
  v jsonb;
begin
  perform pg_temp.outbox_job('invoice', 'pending', 0, now() - interval '1 hour');
  v := pg_temp.health('finanzas185@yuntera.example');
  assert pg_temp.state(v, 'invoices') = 'ok', 'invoices: a job not tried yet';
  perform pg_temp.outbox_job('invoice', 'pending', 2, now() - interval '1 hour');
  v := pg_temp.health('finanzas185@yuntera.example');
  assert (pg_temp.line(v, 'invoices') -> 'parts' ->> 'failed_events')::int = 1, 'invoices: a job that failed';
  insert into private.invoice_transmission_pause (paused_until, reason) values (now() + interval '1 hour', 'x');
  v := pg_temp.health('finanzas185@yuntera.example');
  assert pg_temp.line(v, 'invoices') ->> 'until' is not null, 'invoices: paused until';
end $$;
rollback to savepoint s;

savepoint s;
do $$
declare
  v jsonb;
begin
  insert into private.invoice_transmission_pause (paused_until, reason) values (now() + interval '1 hour', 'x');
  v := pg_temp.health('finanzas185@yuntera.example');
  assert pg_temp.state(v, 'invoices') = 'problem' and (pg_temp.line(v, 'invoices') -> 'count')::int = 0,
    'invoices: paused alone is a problem';
end $$;
rollback to savepoint s;

-- The signing certificate.
savepoint s;
do $$
declare
  v jsonb;
begin
  update private.invoice_worker_health set certificate_not_after = now() + interval '31 days';
  v := pg_temp.health('finanzas185@yuntera.example');
  assert pg_temp.state(v, 'invoice_certificate') = 'ok', 'certificate: 31 days left is fine';
  update private.invoice_worker_health set certificate_not_after = now() + interval '29 days';
  v := pg_temp.health('finanzas185@yuntera.example');
  assert pg_temp.state(v, 'invoice_certificate') = 'attention', 'certificate: 29 days left';
  update private.invoice_worker_health set certificate_not_after = now() + interval '10 days';
  v := pg_temp.health('finanzas185@yuntera.example');
  assert pg_temp.state(v, 'invoice_certificate') = 'attention', 'certificate: 10 days left';
  update private.invoice_worker_health set certificate_not_after = now() - interval '1 day';
  v := pg_temp.health('finanzas185@yuntera.example');
  assert pg_temp.state(v, 'invoice_certificate') = 'problem', 'certificate: expired';
  update private.invoice_worker_health
  set certificate_not_after = now() + interval '1 year', error = 'certificate: PIN rejected';
  v := pg_temp.health('finanzas185@yuntera.example');
  assert pg_temp.state(v, 'invoice_certificate') = 'problem'
     and (pg_temp.line(v, 'invoice_certificate') -> 'parts' ->> 'worker_error')::int = 1,
    'certificate: the worker could not read it';
  assert v::text not like '%PIN rejected%', 'certificate: the worker''s error text is not shown';
  delete from private.invoice_worker_health;
  v := pg_temp.health('finanzas185@yuntera.example');
  assert pg_temp.state(v, 'invoice_certificate') = 'unknown', 'certificate: no report yet is unknown';
  perform pg_temp.others_ok(v, 'invoice_certificate');
end $$;
rollback to savepoint s;

-- Gateway refunds that failed.
savepoint s;
do $$
declare
  v jsonb;
begin
  perform pg_temp.gateway_refund('succeeded');
  v := pg_temp.health('finanzas185@yuntera.example');
  assert pg_temp.state(v, 'refunds_failed') = 'ok', 'refunds: one that succeeded';
  -- A transfer that failed is finance's own work on /cobros/reembolsos, not the gateway's.
  perform pg_temp.gateway_refund('failed', now(), 'transfer');
  v := pg_temp.health('finanzas185@yuntera.example');
  assert pg_temp.state(v, 'refunds_failed') = 'ok', 'refunds: a failed transfer is not a gateway refund';
  perform pg_temp.gateway_refund('failed');
  v := pg_temp.health('finanzas185@yuntera.example');
  assert pg_temp.state(v, 'refunds_failed') = 'problem'
     and (pg_temp.line(v, 'refunds_failed') -> 'count')::int = 1, 'refunds: one failed';
  -- Paid by transfer instead: no longer a gateway refund that failed.
  perform pg_temp.triggers_off();
  update private.gateway_refunds set channel = 'transfer', status = 'succeeded' where status = 'failed';
  perform pg_temp.triggers_on();
  v := pg_temp.health('finanzas185@yuntera.example');
  assert pg_temp.state(v, 'refunds_failed') = 'ok', 'refunds: paid another way';
end $$;
rollback to savepoint s;

-- Payments that failed in the last hour.
savepoint s;
do $$
declare
  v jsonb;
begin
  for i in 1..4 loop
    perform pg_temp.attempt('failed', now() - interval '10 minutes');
  end loop;
  perform pg_temp.attempt('failed', now() - interval '2 hours');
  v := pg_temp.health('finanzas185@yuntera.example');
  assert pg_temp.state(v, 'payments_failed') = 'ok'
     and (pg_temp.line(v, 'payments_failed') -> 'parts' ->> 'declined')::int = 4,
    format('payments: 4 declines in the hour, got %s', pg_temp.line(v, 'payments_failed'));
  perform pg_temp.attempt('failed', now() - interval '1 minute');
  v := pg_temp.health('finanzas185@yuntera.example');
  assert pg_temp.state(v, 'payments_failed') = 'attention', 'payments: 5 declines ask for attention';
  perform pg_temp.attempt('error');
  v := pg_temp.health('finanzas185@yuntera.example');
  assert pg_temp.state(v, 'payments_failed') = 'problem'
     and (pg_temp.line(v, 'payments_failed') -> 'parts' ->> 'errors')::int = 1, 'payments: one not created';
  perform pg_temp.others_ok(v, 'payments_failed');
end $$;
rollback to savepoint s;

-- Payment work the worker did not pick up.
savepoint s;
do $$
declare
  v jsonb;
begin
  perform pg_temp.attempt('creating', null, now() - interval '5 minutes');
  perform pg_temp.gateway_refund('requested', now() - interval '5 minutes');
  v := pg_temp.health('finanzas185@yuntera.example');
  assert pg_temp.state(v, 'payments_worker') = 'ok', 'payments worker: 5 minutes is not late';
  perform pg_temp.attempt('cancel_requested', null, now() - interval '20 minutes');
  v := pg_temp.health('finanzas185@yuntera.example');
  assert pg_temp.state(v, 'payments_worker') = 'problem'
     and pg_temp.line(v, 'payments_worker') -> 'parts' = '{"attempts": 1, "refunds": 0}', 'payments worker: an attempt';
end $$;
rollback to savepoint s;

savepoint s;
do $$
declare
  v jsonb;
begin
  perform pg_temp.gateway_refund('sending', now() - interval '20 minutes');
  v := pg_temp.health('finanzas185@yuntera.example');
  assert pg_temp.state(v, 'payments_worker') = 'problem'
     and pg_temp.line(v, 'payments_worker') -> 'parts' = '{"attempts": 0, "refunds": 1}', 'payments worker: a refund';
  perform pg_temp.others_ok(v, 'payments_worker');
end $$;
rollback to savepoint s;

-- Unpaid orders past their expiry.
savepoint s;
do $$
declare
  v jsonb;
  o uuid := pg_temp.unpaid_order('salud-185-impago');
  n text := (select order_number from public.orders where id = o);
begin
  perform set_config('request.jwt.claims', '', true);
  v := pg_temp.health('operaciones185@yuntera.example');
  assert pg_temp.state(v, 'orders_unpaid_overdue') = 'ok', 'unpaid: just placed';
  update public.orders set placed_at = now() - interval '40 minutes' where id = o;
  v := pg_temp.health('operaciones185@yuntera.example');
  assert pg_temp.state(v, 'orders_unpaid_overdue') = 'ok', 'unpaid: 40 minutes is within 30 + 15';
  update public.orders set placed_at = now() - interval '50 minutes' where id = o;
  v := pg_temp.health('operaciones185@yuntera.example');
  assert pg_temp.state(v, 'orders_unpaid_overdue') = 'problem'
     and pg_temp.line(v, 'orders_unpaid_overdue') -> 'refs' = jsonb_build_array(n),
    format('unpaid: overdue, got %s', pg_temp.line(v, 'orders_unpaid_overdue'));
  assert (pg_temp.line(v, 'orders_unpaid_overdue') ->> 'minutes')::int = 45, 'unpaid: the limit in minutes';
  perform pg_temp.others_ok(v, 'orders_unpaid_overdue');
end $$;
rollback to savepoint s;

-- A paid order whose warehouse parcel never got a pick list.
savepoint s;
do $$
declare
  v jsonb;
  o uuid;
  n text;
begin
  perform pg_temp.shopper('salud185@yuntera.example', 'Prueba Salud');
  o := pg_temp.place('salud185@yuntera.example', pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'salud-185-a');
  perform pg_temp.pay(o);
  perform set_config('request.jwt.claims', '', true);
  n := (select order_number from public.orders where id = o);
  update public.orders set placed_at = now() - interval '1 hour' where id = o;
  v := pg_temp.health('operaciones185@yuntera.example');
  assert pg_temp.state(v, 'orders_not_released') = 'ok', 'not released: paid and released';
  delete from public.pick_tasks t using public.shipments s where s.id = t.shipment_id and s.order_id = o;
  v := pg_temp.health('operaciones185@yuntera.example');
  assert pg_temp.state(v, 'orders_not_released') = 'problem'
     and pg_temp.line(v, 'orders_not_released') -> 'refs' = jsonb_build_array(n),
    format('not released: %s', pg_temp.line(v, 'orders_not_released'));
  perform pg_temp.others_ok(v, 'orders_not_released');
  -- Within the first 30 minutes it is not counted yet.
  update public.orders set placed_at = now() - interval '10 minutes' where id = o;
  v := pg_temp.health('operaciones185@yuntera.example');
  assert pg_temp.state(v, 'orders_not_released') = 'ok', 'not released: too recent to say';
end $$;
rollback to savepoint s;

-- Routes that cannot finish: the same three reasons Rutas detenidas
-- (ops_open_routes) gives, each alone, and the two pages agree.
savepoint s;
do $$
declare
  v jsonb;
  r public.routes;
  v_today date := private.cr_today();
  v_depot uuid := (select id from public.warehouses where kind = 'platform' order by created_at limit 1);
  v_stuck text[];
begin
  -- An open route of today with stops to visit, started 23 hours ago, is
  -- not stuck (the old rule looked at the start time only).
  select * into r from public.routes where driver_id is not null order by created_at limit 1;
  perform pg_temp.triggers_off();
  update public.routes set status = 'in_progress', started_at = now() - interval '23 hours',
                           service_date = v_today, completed_at = null where id = r.id;
  update public.route_stops set status = 'pending' where route_id = r.id;
  update public.shipments set status = 'out_for_delivery'
  where id in (select shipment_id from public.route_stops where route_id = r.id);
  perform pg_temp.triggers_on();
  v := pg_temp.health('operaciones185@yuntera.example');
  assert pg_temp.state(v, 'routes_open') = 'ok', format('routes: today, open stops, %s', pg_temp.line(v, 'routes_open'));
  perform pg_temp.others_ok(v, 'none');

  -- Its day passed.
  perform pg_temp.triggers_off();
  update public.routes set service_date = v_today - 1 where id = r.id;
  perform pg_temp.triggers_on();
  v := pg_temp.health('operaciones185@yuntera.example');
  assert pg_temp.state(v, 'routes_open') = 'problem'
     and pg_temp.line(v, 'routes_open') -> 'refs' = jsonb_build_array(r.code)
     and pg_temp.line(v, 'routes_open') -> 'parts' = '{"past_date": 1, "cancelled_parcel": 0, "no_open_stops": 0}',
    format('routes: past date, %s', pg_temp.line(v, 'routes_open'));
  perform pg_temp.others_ok(v, 'routes_open');

  -- A parcel on it was cancelled.
  perform pg_temp.triggers_off();
  update public.routes set service_date = v_today where id = r.id;
  update public.shipments set status = 'cancelled'
  where id = (select shipment_id from public.route_stops where route_id = r.id order by sequence limit 1);
  perform pg_temp.triggers_on();
  v := pg_temp.health('operaciones185@yuntera.example');
  assert pg_temp.state(v, 'routes_open') = 'problem'
     and pg_temp.line(v, 'routes_open') -> 'parts' = '{"past_date": 0, "cancelled_parcel": 1, "no_open_stops": 0}',
    format('routes: cancelled parcel, %s', pg_temp.line(v, 'routes_open'));

  -- Every stop visited and the route still open (it should have closed by itself).
  perform pg_temp.triggers_off();
  update public.shipments set status = 'delivered'
  where id in (select shipment_id from public.route_stops where route_id = r.id);
  update public.route_stops set status = 'delivered' where route_id = r.id;
  perform pg_temp.triggers_on();
  v := pg_temp.health('operaciones185@yuntera.example');
  assert pg_temp.state(v, 'routes_open') = 'problem'
     and pg_temp.line(v, 'routes_open') -> 'parts' = '{"past_date": 0, "cancelled_parcel": 0, "no_open_stops": 1}',
    format('routes: no stop left, %s', pg_temp.line(v, 'routes_open'));

  -- A draft of today with no stop at all, and one assigned yesterday and never started.
  perform pg_temp.triggers_off();
  update public.route_stops set status = 'pending' where route_id = r.id;
  update public.shipments set status = 'out_for_delivery'
  where id in (select shipment_id from public.route_stops where route_id = r.id);
  insert into public.routes (code, service_date, depot_warehouse_id, status)
  values ('R-T185A', v_today, v_depot, 'draft');
  perform pg_temp.triggers_on();
  v := pg_temp.health('operaciones185@yuntera.example');
  assert pg_temp.state(v, 'routes_open') = 'problem'
     and pg_temp.line(v, 'routes_open') -> 'refs' = '["R-T185A"]'
     and pg_temp.line(v, 'routes_open') -> 'parts' = '{"past_date": 0, "cancelled_parcel": 0, "no_open_stops": 1}',
    format('routes: no stops, %s', pg_temp.line(v, 'routes_open'));
  perform pg_temp.triggers_off();
  delete from public.routes where code = 'R-T185A';
  update public.routes set status = 'assigned', started_at = null, service_date = v_today - 1 where id = r.id;
  perform pg_temp.triggers_on();
  v := pg_temp.health('operaciones185@yuntera.example');
  assert pg_temp.state(v, 'routes_open') = 'problem'
     and pg_temp.line(v, 'routes_open') -> 'refs' = jsonb_build_array(r.code), 'routes: assigned yesterday, never started';

  -- What the health line names is exactly what Rutas detenidas calls stuck.
  perform pg_temp.login('operaciones185@yuntera.example');
  select coalesce(array_agg(x ->> 'code' order by x ->> 'code'), '{}') into v_stuck
  from jsonb_array_elements(public.ops_open_routes()) x where (x ->> 'stuck')::boolean;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  assert v_stuck = array(select jsonb_array_elements_text(pg_temp.line(v, 'routes_open') -> 'refs') order by 1),
    format('routes: the same as Rutas detenidas, %s and %s', v_stuck, pg_temp.line(v, 'routes_open') -> 'refs');
end $$;
rollback to savepoint s;

-- Failed sign-ins in the last hour.
savepoint s;
do $$
declare
  v jsonb;
begin
  insert into private.auth_attempts (action, address_hash, attempted_at)
  select 'sign_in', repeat('a', 64), now() - interval '5 minutes' from generate_series(1, 29);
  insert into private.auth_attempts (action, address_hash, attempted_at)
  select 'sign_in', repeat('b', 64), now() - interval '90 minutes' from generate_series(1, 10);
  insert into private.auth_attempts (action, address_hash, attempted_at)
  select 'sign_up', repeat('c', 64), now() from generate_series(1, 10);
  v := pg_temp.health('central@yuntera.example');
  assert pg_temp.state(v, 'sign_ins_failed') = 'ok'
     and (pg_temp.line(v, 'sign_ins_failed') -> 'count')::int = 29, 'sign-ins: 29 in the hour';
  insert into private.auth_attempts (action, address_hash) values ('sign_in', repeat('a', 64));
  v := pg_temp.health('central@yuntera.example');
  assert pg_temp.state(v, 'sign_ins_failed') = 'attention', 'sign-ins: 30 ask for attention';
  perform pg_temp.others_ok(v, 'sign_ins_failed');
end $$;
rollback to savepoint s;

-- ═══ The scheduled jobs ══════════════════════════════════════════════════════

-- Without a scheduler (this database, unless it is a hosted one): every job
-- "unknown", the history "unavailable", never "on time".
do $$
declare
  v jsonb;
  x jsonb;
begin
  if to_regclass('cron.job') is not null then
    return;
  end if;
  v := pg_temp.health('operaciones185@yuntera.example');
  assert v -> 'jobs' ->> 'history' = 'unavailable' and v -> 'jobs' ->> 'reason' = 'not_installed',
    format('no scheduler: %s', v -> 'jobs');
  for x in select * from jsonb_array_elements(v -> 'jobs' -> 'items') loop
    assert x ->> 'state' = 'unknown' and x ->> 'reason' = 'no_history', format('no scheduler: %s', x);
  end loop;
  assert pg_temp.state(v, 'jobs') = 'unknown', 'no scheduler: the summary is unknown, not ok';
end $$;

-- With a scheduler's history: a stand-in cron schema with pg_cron's columns,
-- made inside this transaction (only where the database has none).
create temporary table cron_standin (made boolean) on commit drop;
do $$
begin
  if to_regclass('cron.job') is not null then
    insert into cron_standin values (false);
    return;
  end if;
  insert into cron_standin values (true);
  create schema cron;
  create sequence cron.runid_seq;
  create table cron.job (
    jobid bigserial primary key, schedule text not null, command text not null,
    nodename text not null default 'localhost', nodeport integer not null default 5432,
    database text not null default current_database(), username text not null default current_user,
    active boolean not null default true, jobname text);
  create table cron.job_run_details (
    jobid bigint, runid bigint primary key default nextval('cron.runid_seq'), job_pid integer,
    database text, username text, command text, status text, return_message text,
    start_time timestamptz, end_time timestamptz);
  insert into cron.job (schedule, command, jobname)
  select '* * * * *', 'select 1', j ->> 'name' from jsonb_array_elements(private.health_jobs()) j;
  -- A recent successful run of each, and older ones before it.
  insert into cron.job_run_details (jobid, status, return_message, start_time, end_time)
  select c.jobid, 'succeeded', '1 row', now() - make_interval(secs => k * (j ->> 'every_seconds')::integer),
         now() - make_interval(secs => k * (j ->> 'every_seconds')::integer) + interval '1 second'
  from jsonb_array_elements(private.health_jobs()) j
  join cron.job c on c.jobname = j ->> 'name',
  generate_series(3, 0, -1) k
  where k = 0 or (j ->> 'every_seconds')::integer < 86400
  order by k desc;  -- the newest run gets the highest run id, as in pg_cron
end $$;

savepoint s;
do $$
declare
  v jsonb;
  x jsonb;
begin
  if not (select made from cron_standin) then
    return;
  end if;
  v := pg_temp.health('operaciones185@yuntera.example');
  assert v -> 'jobs' ->> 'history' = 'available', format('history: %s', v -> 'jobs');
  for x in select * from jsonb_array_elements(v -> 'jobs' -> 'items') loop
    assert x ->> 'state' = 'ok' and x ->> 'reason' = 'on_time' and x ->> 'last_status' = 'succeeded'
       and x ->> 'last_run_at' is not null, format('history: %s', x);
  end loop;
  assert pg_temp.state(v, 'jobs') = 'ok', 'history: all on time';

  -- Late: the invoice sweep's last run 10 minutes ago (it runs every 30 s).
  update cron.job_run_details set start_time = start_time - interval '10 minutes'
  where jobid = (select jobid from cron.job where jobname = 'invoice-sweep');
  -- Failed: the payments sweep's newest run.
  insert into cron.job_run_details (jobid, status, return_message, start_time, end_time)
  select jobid, 'failed', 'ERROR: something about comprador@yuntera.example', now(), now()
  from cron.job where jobname = 'payments-sweep';
  -- Switched off, and not scheduled at all.
  update cron.job set active = false where jobname = 'expire-unpaid-orders';
  delete from cron.job where jobname = 'auth-attempts-cleanup';
  -- Never ran: an hourly-or-faster job is a problem, a weekly one unknown.
  delete from cron.job_run_details
  where jobid in (select jobid from cron.job where jobname in ('notify-sweep', 'cron-history-cleanup'));
  -- Still running is not a failure.
  insert into cron.job_run_details (jobid, status, start_time)
  select jobid, 'running', now() from cron.job where jobname = 'refresh-product-signals';

  v := pg_temp.health('operaciones185@yuntera.example');
  for x in select * from jsonb_array_elements(v -> 'jobs' -> 'items') loop
    assert (x ->> 'name', x ->> 'state', x ->> 'reason') in (
      ('notify-sweep', 'problem', 'never_ran'),
      ('invoice-sweep', 'problem', 'late'),
      ('payments-sweep', 'problem', 'failed'),
      ('expire-unpaid-orders', 'problem', 'inactive'),
      ('auth-attempts-cleanup', 'problem', 'not_scheduled'),
      ('refresh-product-signals', 'ok', 'on_time'),
      ('cron-history-cleanup', 'unknown', 'never_ran')), format('jobs: %s', x);
  end loop;
  assert (select j ->> 'last_status' from jsonb_array_elements(v -> 'jobs' -> 'items') j
          where j ->> 'name' = 'refresh-product-signals') = 'running', 'jobs: running';
  assert pg_temp.state(v, 'jobs') = 'problem' and (pg_temp.line(v, 'jobs') -> 'count')::int = 5
     and pg_temp.line(v, 'jobs') -> 'refs'
         = '["notify-sweep", "invoice-sweep", "payments-sweep", "expire-unpaid-orders", "auth-attempts-cleanup"]',
    format('jobs summary: %s', pg_temp.line(v, 'jobs'));
  assert v::text not like '%comprador%' and v::text not like '%ERROR%', 'jobs: a run''s message is never read';
  perform pg_temp.others_ok(v, 'jobs');
end $$;
rollback to savepoint s;

-- History that is not logged.
savepoint s;
do $$
declare
  v jsonb;
begin
  if not (select made from cron_standin) then
    return;
  end if;
  perform set_config('cron.log_run', 'off', true);
  v := pg_temp.health('operaciones185@yuntera.example');
  assert v -> 'jobs' ->> 'history' = 'unavailable' and v -> 'jobs' ->> 'reason' = 'not_logged'
     and pg_temp.state(v, 'jobs') = 'unknown', format('not logged: %s', v -> 'jobs');
end $$;
rollback to savepoint s;

-- History the function's owner may not read (a hosted project's grants could
-- say so): a stand-in that refuses as PostgreSQL would.
savepoint s;
do $$
declare
  v jsonb;
begin
  if not (select made from cron_standin) then
    return;
  end if;
  drop table cron.job_run_details;
  create function cron.refuse() returns setof record language plpgsql as
    $f$ begin raise exception using errcode = '42501', message = 'permission denied for table job_run_details'; end $f$;
  create view cron.job_run_details as
    select * from cron.refuse() as r (jobid bigint, runid bigint, status text, start_time timestamptz);
  v := pg_temp.health('operaciones185@yuntera.example');
  assert v -> 'jobs' ->> 'history' = 'unavailable' and v -> 'jobs' ->> 'reason' = 'no_access'
     and pg_temp.state(v, 'jobs') = 'unknown', format('no access: %s', v -> 'jobs');
end $$;
rollback to savepoint s;

-- On a database with a real scheduler (the hosted preview), the same call
-- reads its history or says why it cannot.
do $$
declare
  v jsonb;
begin
  if (select made from cron_standin) then
    return;
  end if;
  v := pg_temp.health('operaciones185@yuntera.example');
  assert v -> 'jobs' ->> 'history' = 'available' or v -> 'jobs' ->> 'reason' in ('no_access', 'not_logged'),
    format('real scheduler: %s', v -> 'jobs');
end $$;

-- ═══ Privacy ═════════════════════════════════════════════════════════════════

-- With every line in its bad state at once, nothing personal in the answer.
savepoint s;
do $$
declare
  v jsonb;
  o uuid := pg_temp.unpaid_order('salud-185-privado');
begin
  perform set_config('request.jwt.claims', '', true);
  update public.orders set placed_at = now() - interval '2 hours' where id = o;
  perform pg_temp.delivery('dead', now());
  perform pg_temp.invoice('rejected', now());
  v := pg_temp.health('central@yuntera.example');
  assert pg_temp.state(v, 'orders_unpaid_overdue') = 'problem', 'privacy: the order is listed';
  assert v::text !~ '@', 'privacy: no e-mail';
  assert v::text !~ '\+506', 'privacy: no phone';
  assert not exists (
    select 1 from public.orders x
    where x.id = o and (position(x.ship_recipient_name in v::text) > 0
                        or position(x.ship_phone in v::text) > 0
                        or position(coalesce(nullif(x.ship_senas, ''), '<none>') in v::text) > 0)),
    'privacy: no name, phone or directions';
end $$;
rollback to savepoint s;

-- ═══ health_ping ═════════════════════════════════════════════════════════════

do $$
declare
  v jsonb;
begin
  perform pg_temp.login_anon();
  v := public.health_ping();
  execute 'reset role';
  assert v = '{"ok": true}', format('visitor ping: %s', v);
  perform pg_temp.login('comprador@yuntera.example');
  v := public.health_ping();
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  assert v = '{"ok": true}', format('shopper ping: %s', v);
  assert has_function_privilege('anon', 'public.health_ping()', 'execute'), 'anon may ping';
  assert not has_function_privilege('anon', 'public.ops_system_health()', 'execute'), 'anon may not read health';
  assert not has_function_privilege('anon', 'public.ops_versions()', 'execute'), 'anon may not read versions';
  assert not has_function_privilege('public', 'public.health_ping()', 'execute'), 'nothing granted to public';
end $$;

-- ═══ Versions and phone builds ═══════════════════════════════════════════════

-- A build no store will ever hold, so a database that recorded the real ones
-- (shop 0.1.0 (4), as the release checklist asks) runs this suite the same.
-- Whatever this suite left there before is set aside first, inside the suite.
delete from private.store_builds where app = 'warehouse' and platform = 'ios' and version = '999.999.998';

do $$
declare
  v jsonb;
  b jsonb;
  v_audit bigint := (select count(*) from private.audit_log where table_name = 'store_builds');
  v_rows bigint := (select count(*) from private.store_builds);
begin
  -- Right caller: the newest migration as recorded (this one or a later one).
  perform pg_temp.login('central@yuntera.example');
  v := public.ops_versions();
  execute 'reset role';
  assert v ->> 'migration_history' = 'available', format('versions: %s', v);
  assert v -> 'migration' ->> 'version' >= '20261121084800'
     and (v -> 'migration' ->> 'count')::int >= 45, format('versions: newest migration %s', v -> 'migration');

  -- Records a build.
  perform pg_temp.login('central@yuntera.example');
  b := public.ops_set_store_build('warehouse', 'ios', '999.999.998', 999999999, date '2026-11-23', 'internal');
  execute 'reset role';
  assert b ->> 'app' = 'warehouse' and b ->> 'platform' = 'ios' and b ->> 'version' = '999.999.998'
     and (b ->> 'build_number')::int = 999999999 and b ->> 'released_on' = '2026-11-23'
     and b ->> 'track' = 'internal', format('recorded: %s', b);
  assert (select count(*) from private.store_builds) = v_rows + 1, 'one row';
  assert (select count(*) from private.audit_log where table_name = 'store_builds' and action = 'INSERT'
            and actor_id = (select id from auth.users where email = 'central@yuntera.example')) = v_audit + 1,
    'one audit entry';

  -- The same build again: updated, not doubled.
  perform pg_temp.login('central@yuntera.example');
  b := public.ops_set_store_build('warehouse', 'ios', '999.999.998', 999999999, date '2026-11-25', 'public');
  v := public.ops_versions();
  execute 'reset role';
  assert (select count(*) from private.store_builds) = v_rows + 1, 'still one row';
  assert b ->> 'track' = 'public' and b ->> 'released_on' = '2026-11-25', 'updated';
  assert (select count(*) from private.audit_log where table_name = 'store_builds' and action = 'UPDATE'
            and row_key = b ->> 'id' and old_row ->> 'track' = 'internal' and new_row ->> 'track' = 'public') = 1,
    'update audited';
  assert (select count(*) from private.audit_log where table_name = 'store_builds' and row_key = b ->> 'id') = 2,
    'one audit entry per call';
  assert exists (select 1 from jsonb_array_elements(v -> 'store_builds') x
                 where x ->> 'id' = b ->> 'id' and x ->> 'track' = 'public'), 'listed';
end $$;

-- A build typed wrong is removed, and stops showing; the audit keeps it.
do $$
declare
  v jsonb;
  wrong jsonb;
  b jsonb;
  v_rows bigint;
begin
  perform pg_temp.login('central@yuntera.example');
  b := public.ops_set_store_build('warehouse', 'ios', '999.999.998', 4, date '2026-11-23', 'internal');
  wrong := public.ops_set_store_build('warehouse', 'ios', '999.999.998', 40, date '2026-11-23', 'internal');
  execute 'reset role';
  v_rows := (select count(*) from private.store_builds);
  perform pg_temp.login('central@yuntera.example');
  b := public.ops_remove_store_build((wrong ->> 'id')::uuid);
  v := public.ops_versions();
  execute 'reset role';
  assert b = wrong, format('removed: %s, recorded %s', b, wrong);
  assert (select count(*) from private.store_builds) = v_rows - 1, 'one row less';
  assert not exists (select 1 from jsonb_array_elements(v -> 'store_builds') x where x ->> 'id' = wrong ->> 'id'),
    'no longer listed';
  assert exists (select 1 from jsonb_array_elements(v -> 'store_builds') x
                 where x ->> 'version' = '999.999.998' and (x ->> 'build_number')::int = 4), 'the right one stays';
  assert (select count(*) from private.audit_log where table_name = 'store_builds' and action = 'DELETE'
            and row_key = wrong ->> 'id' and old_row ->> 'build_number' = '40' and new_row is null
            and actor_id = (select id from auth.users where email = 'central@yuntera.example')) = 1,
    'removal audited, with what was removed';
  -- Twice: it is gone.
  perform pg_temp.refused_as('central@yuntera.example',
    format('select public.ops_remove_store_build(%L)', wrong ->> 'id'), 'store_build_not_found');
  perform pg_temp.refused_as('central@yuntera.example',
    format('select public.ops_remove_store_build(%L)', gen_random_uuid()), 'store_build_not_found');
  perform pg_temp.refused_as('central@yuntera.example', 'select public.ops_remove_store_build(null)',
    'store_build_not_found');
end $$;

-- Invalid builds are refused, and nothing is kept.
do $$
declare
  v_rows bigint := (select count(*) from private.store_builds);
  bad text;
begin
  foreach bad in array array[
    $s$select public.ops_set_store_build('tienda', 'ios', '1.0.0', 1, current_date, 'internal')$s$,
    $s$select public.ops_set_store_build('shop', 'windows', '1.0.0', 1, current_date, 'internal')$s$,
    $s$select public.ops_set_store_build('shop', 'ios', '1.0', 1, current_date, 'internal')$s$,
    $s$select public.ops_set_store_build('shop', 'ios', '1.0.0 beta', 1, current_date, 'internal')$s$,
    $s$select public.ops_set_store_build('shop', 'ios', '1.0.0', 0, current_date, 'internal')$s$,
    $s$select public.ops_set_store_build('shop', 'ios', '1.0.0', 1, current_date + 2, 'internal')$s$,
    $s$select public.ops_set_store_build('shop', 'ios', '1.0.0', 1, date '2025-12-31', 'internal')$s$,
    $s$select public.ops_set_store_build('shop', 'ios', '1.0.0', 1, current_date, 'review')$s$,
    $s$select public.ops_set_store_build('shop', 'ios', null, 1, current_date, 'internal')$s$]
  loop
    perform pg_temp.refused_as('central@yuntera.example', bad, 'store_build_invalid');
  end loop;
  assert (select count(*) from private.store_builds) = v_rows, 'nothing kept';
end $$;

-- Wrong callers: every other staff role, a shopper, a seller, a visitor.
do $$
declare
  who text;
begin
  foreach who in array array['soporte185@yuntera.example', 'finanzas185@yuntera.example',
                             'operaciones185@yuntera.example', 'catalogo185@yuntera.example',
                             'comprador@yuntera.example', 'vendedor@yuntera.example'] loop
    perform pg_temp.refused_as(who, 'select public.ops_versions()', 'forbidden');
    perform pg_temp.refused_as(who,
      $s$select public.ops_set_store_build('shop', 'ios', '1.0.0', 1, current_date, 'internal')$s$, 'forbidden');
    perform pg_temp.refused_as(who,
      format('select public.ops_remove_store_build(%L)', (select id from private.store_builds limit 1)), 'forbidden');
  end loop;
  assert exists (select 1 from private.store_builds), 'wrong callers removed nothing';
  perform pg_temp.refused_as(null, 'select public.ops_versions()', 'forbidden');
  perform pg_temp.refused_as(null,
    $s$select public.ops_set_store_build('shop', 'ios', '1.0.0', 1, current_date, 'internal')$s$, 'forbidden');
  perform pg_temp.refused_as(null, format('select public.ops_remove_store_build(%L)', gen_random_uuid()),
    'forbidden');
end $$;

-- Where the migrations are not recorded, the panel says so.
savepoint s;
do $$
declare
  v jsonb;
begin
  alter table supabase_migrations.schema_migrations rename to schema_migrations_hidden;
  perform pg_temp.login('central@yuntera.example');
  v := public.ops_versions();
  execute 'reset role';
  assert v ->> 'migration_history' = 'unavailable' and v -> 'migration' = 'null'::jsonb,
    format('no migration table: %s', v);
end $$;
rollback to savepoint s;

rollback;
