-- Support desk: cases, their timeline, response targets, saved answers and
-- the customer view (docs/research/support-and-system-health-tools.md,
-- section 4; the owner chose "inside the staff console" on 24 Nov 2026).
--
--   1. Response targets: one settings table with the targets of
--      docs/06-operations/customer-service.md, and the due time of a target
--      counted on the operations calendar the delivery promise uses
--      (public.holidays through private.add_business_days).
--   2. Cases (private.cases) and their timeline (private.case_entries,
--      append-only). Every complaint, return request and content report gets
--      a case by trigger, and the existing ones get one here, so the three
--      queues of /atencion keep working while /casos grows. Staff record a
--      contact that came by WhatsApp, phone or e-mail as a case of its own.
--   3. The guard that keeps the delivery code out of notes and answers.
--   4. Staff functions: the list, one case, notes, answers, assignment,
--      reopening, contacts, the cases of an order, the "Hoy" line, the
--      monthly report and the targets.
--   5. Saved answers.
--   6. The customer view and the audited reveal of a customer's contact.
--   7. The shopper's own cases, with the answers, and a complaint's receipt.
--   8. Account deletion: the text of the person's cases goes with the account.
--
-- Who sees which case (section 4.1): support and admin all of them; ops the
-- cases tied to an order; finance the cases about payments and refunds;
-- catalog the cases about listings (content reports). Every function checks
-- the role again. Sellers never reach a case. No function changes an
-- existing one: the triggers follow the source rows whatever function
-- changes them.

-- ═══ 1. Response targets ═══════════════════════════════════════════════════

-- One row per kind of case and topic ('*' = any other topic of that kind).
-- first_response: the first human answer; resolution: the case closed.
-- Units: minutes; working_hours (from the moment the case opens, or from
-- 08:00 of the next working day when it opens outside one); working_days
-- and calendar_days (to the end of that day, Costa Rica time); same_day (the
-- end of the day it opens).
create table private.case_targets (
  kind text not null check (kind in ('complaint', 'return', 'report', 'contact')),
  topic text not null default '*' check (topic ~ '^(\*|[a-z_]{2,40})$'),
  first_response_amount integer not null check (first_response_amount between 1 and 600),
  first_response_unit text not null
    check (first_response_unit in ('minutes', 'working_hours', 'working_days', 'calendar_days', 'same_day')),
  resolution_amount integer not null check (resolution_amount between 1 and 600),
  resolution_unit text not null
    check (resolution_unit in ('minutes', 'working_hours', 'working_days', 'calendar_days', 'same_day')),
  -- The situation in customer-service.md the row comes from, in its words.
  situation text not null check (char_length(situation) between 3 and 200),
  primary key (kind, topic)
);

alter table private.case_targets enable row level security;
revoke all on private.case_targets from public, anon, authenticated;

insert into private.case_targets
  (kind, topic, first_response_amount, first_response_unit, resolution_amount, resolution_unit, situation)
values
  -- "Formal complaint: acknowledged in 1 working day; written answer within 5 working days."
  ('complaint', '*', 1, 'working_days', 5, 'working_days', 'Formal complaint'),
  -- "Withdrawal or return request: 1 working day; refund within the legal 8 calendar days."
  ('return', '*', 1, 'working_days', 8, 'calendar_days', 'Withdrawal or return request'),
  -- "Wrong, damaged or missing item: 2 working hours; replacement or refund within 2 working days."
  ('return', 'damaged', 2, 'working_hours', 2, 'working_days', 'Wrong, damaged or missing item'),
  ('return', 'wrong_item', 2, 'working_hours', 2, 'working_days', 'Wrong, damaged or missing item'),
  ('return', 'warranty', 2, 'working_hours', 2, 'working_days', 'Wrong, damaged or missing item'),
  -- customer-service.md sets no target for reports; it says "the same
  -- mechanism" as complaints serves reporters, so they take the complaint's.
  ('report', '*', 1, 'working_days', 5, 'working_days', 'Formal complaint (reports use the same mechanism)'),
  -- Contacts recorded by staff, by what the person asked about.
  ('contact', 'delivery_today', 15, 'minutes', 1, 'same_day', 'Order out for delivery today'),
  ('contact', 'delivery_problem', 1, 'same_day', 1, 'same_day', 'Delivery failed or late'),
  ('contact', 'item_problem', 2, 'working_hours', 2, 'working_days', 'Wrong, damaged or missing item'),
  ('contact', 'return', 1, 'working_days', 8, 'calendar_days', 'Withdrawal or return request'),
  ('contact', 'payment', 2, 'working_hours', 1, 'working_days', 'Payment question'),
  ('contact', 'seller', 1, 'working_days', 3, 'working_days', 'Seller question'),
  ('contact', 'complaint', 1, 'working_days', 5, 'working_days', 'Formal complaint'),
  -- No row in customer-service.md: the complaint's, the longest of the written targets.
  ('contact', '*', 1, 'working_days', 5, 'working_days', 'Any other question');

-- A local Costa Rica time back to an instant (Costa Rica is UTC−6 all year,
-- as private.cr_local says).
create or replace function private.cr_instant(p_local timestamp) returns timestamptz
language sql immutable
set search_path = ''
as $$
  select (p_local + interval '6 hours') at time zone 'UTC';
$$;

-- When a target counted from p_from falls due. Working days are those of the
-- operations calendar (Monday to Friday, without public.holidays), the same
-- calendar the withdrawal and warranty windows use.
create or replace function private.case_due(p_from timestamptz, p_amount integer, p_unit text)
returns timestamptz
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_local timestamp := private.cr_local(p_from);
  v_day date := v_local::date;
  -- When people start answering on a working day. customer-service.md says
  -- the hours are published but does not give them: an assumption to confirm.
  c_opens constant time := time '08:00';
begin
  case p_unit
    when 'minutes' then
      return p_from + make_interval(mins => p_amount);
    when 'working_hours' then
      if private.add_business_days(v_day - 1, 1) <> v_day then
        v_local := private.add_business_days(v_day, 1) + c_opens;
      elsif v_local::time < c_opens then
        v_local := v_day + c_opens;
      end if;
      return private.cr_instant(v_local + make_interval(hours => p_amount));
    when 'working_days' then
      return private.cr_instant((private.add_business_days(v_day, p_amount) + 1)::timestamp);
    when 'calendar_days' then
      return private.cr_instant((v_day + p_amount + 1)::timestamp);
    when 'same_day' then
      return private.cr_instant((v_day + 1)::timestamp);
    else
      perform private.fail('invalid_target');
  end case;
end;
$$;

-- The target of a kind of case and topic: its own row, or the kind's '*'.
create or replace function private.case_target(p_kind text, p_topic text)
returns private.case_targets
language sql stable security definer
set search_path = ''
as $$
  select t.* from private.case_targets t
  where t.kind = p_kind and t.topic in (p_topic, '*')
  order by (t.topic = '*'), t.topic
  limit 1;
$$;

-- ═══ 2. Cases and their timeline ═══════════════════════════════════════════

create table private.cases (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('complaint', 'return', 'report', 'contact')),
  -- The complaint's category, the return's kind, the report's reason, or
  -- what a contact was about.
  topic text not null check (topic ~ '^[a-z_]{2,40}$'),
  -- Which team besides support reads it: ops reads every case with an
  -- order; finance 'payment'; catalog 'listing'.
  area text not null check (area in ('order', 'payment', 'listing', 'account')),
  order_id uuid references public.orders (id),
  user_id uuid references auth.users (id),
  complaint_id uuid unique references public.complaints (id),
  return_id uuid unique references public.return_requests (id),
  report_id uuid unique references public.content_reports (id),
  -- Where it came in: the shop (web or app) or a contact staff recorded.
  channel text not null check (channel in ('shop', 'whatsapp', 'phone', 'email')),
  -- What a recorded contact was about, in staff's words (complaints,
  -- returns and reports keep their own text on their own row).
  summary text check (char_length(summary) between 10 and 1000),
  status text not null default 'open' check (status in ('open', 'closed')),
  assignee_id uuid references auth.users (id),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  first_response_due_at timestamptz not null,
  due_at timestamptz not null,
  first_response_at timestamptz,
  resolved_at timestamptz,
  reopened_count integer not null default 0 check (reopened_count >= 0),
  check (case kind
    when 'complaint' then complaint_id is not null and return_id is null and report_id is null
    when 'return' then return_id is not null and complaint_id is null and report_id is null
    when 'report' then report_id is not null and complaint_id is null and return_id is null
    else complaint_id is null and return_id is null and report_id is null and summary is not null
  end),
  check (kind <> 'contact' or order_id is not null or user_id is not null),
  check ((status = 'closed') = (resolved_at is not null))
);

create index cases_open_idx on private.cases (created_at, id) where status = 'open';
create index cases_order_idx on private.cases (order_id) where order_id is not null;
create index cases_user_idx on private.cases (user_id, created_at desc) where user_id is not null;
create index cases_created_idx on private.cases (created_at);

-- Who did what to a case, in order. Append-only: no function updates or
-- deletes an entry (the one exception is erasing the text of a deleted
-- account's cases, section 8).
create table private.case_entries (
  id bigint generated always as identity primary key,
  case_id uuid not null references private.cases (id),
  -- opened · note (staff only) · answer (the customer reads it) · assigned ·
  -- closed · reopened · status (the source row moved: body is its new status)
  kind text not null check (kind in ('opened', 'note', 'answer', 'assigned', 'closed', 'reopened', 'status')),
  author_id uuid references auth.users (id),
  body text check (char_length(body) <= 4000),
  created_at timestamptz not null default now()
);

create index case_entries_case_idx on private.case_entries (case_id, id);

create or replace function private.case_entries_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Only the account-deletion step may blank a body, and nothing else.
  if tg_op = 'UPDATE' and current_setting('yuntera.erasing_cases', true) = 'on'
     and new.id = old.id and new.case_id = old.case_id and new.kind = old.kind
     and new.author_id is not distinct from old.author_id and new.created_at = old.created_at
     and new.body = private.erased_case_text() then
    return new;
  end if;
  raise exception 'Rows in % are immutable', tg_table_name using errcode = 'P0001';
end;
$$;

create or replace function private.erased_case_text() returns text
language sql immutable
set search_path = ''
as $$ select 'Texto eliminado junto con la cuenta.'::text $$;

create trigger case_entries_append_only before update or delete on private.case_entries
  for each row execute function private.case_entries_append_only();

alter table private.cases enable row level security;
alter table private.case_entries enable row level security;
revoke all on private.cases, private.case_entries from public, anon, authenticated;

-- Which team reads a case besides support.
create or replace function private.case_area(p_kind text, p_topic text, p_order_id uuid)
returns text
language sql immutable
set search_path = ''
as $$
  select case
    when p_kind = 'report' or (p_kind = 'contact' and p_topic = 'listing') then 'listing'
    when p_kind = 'return' or p_topic in ('payment', 'refund') then 'payment'
    when p_order_id is not null then 'order'
    else 'account'
  end;
$$;

-- The caller's staff role, or null for anyone else (and for staff who have
-- not passed their second step where it is required).
create or replace function private.case_reader_role() returns public.staff_role
language sql stable security definer
set search_path = ''
as $$
  select s.role from public.staff_members s
  where s.user_id = (select auth.uid()) and s.active and private.staff_session_ok();
$$;

-- Whether a role reads a case (section 4.1 of the specification).
create or replace function private.case_visible(p_role public.staff_role, p_area text, p_order_id uuid)
returns boolean
language sql immutable
set search_path = ''
as $$
  select coalesce(case p_role
    when 'admin' then true
    when 'support' then true
    when 'ops' then p_order_id is not null
    when 'finance' then p_area = 'payment'
    when 'catalog' then p_area = 'listing'
    else false
  end, false);
$$;

-- The reference the customer reads: the first eight characters of the
-- complaint's, return's or report's id (what the messages already call it),
-- or of the case's own id for a recorded contact.
create or replace function private.case_reference(c private.cases) returns text
language sql immutable
set search_path = ''
as $$
  select upper(left(coalesce(c.complaint_id, c.return_id, c.report_id, c.id)::text, 8));
$$;

-- A first name, never more (assignees, authors and customers on screen).
create or replace function private.first_name_of(p_user_id uuid) returns text
language sql stable security definer
set search_path = ''
as $$
  select nullif(split_part(trim(p.full_name), ' ', 1), '') from public.profiles p where p.id = p_user_id;
$$;

-- Opens a case with its due times and its first entry.
create or replace function private.open_case(
  p_kind text, p_topic text, p_order_id uuid, p_user_id uuid, p_channel text,
  p_source uuid, p_summary text, p_created_by uuid, p_at timestamptz
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  t private.case_targets := private.case_target(p_kind, p_topic);
  v_id uuid;
begin
  insert into private.cases (kind, topic, area, order_id, user_id, complaint_id, return_id, report_id,
                             channel, summary, created_by, created_at, first_response_due_at, due_at)
  values (p_kind, p_topic, private.case_area(p_kind, p_topic, p_order_id), p_order_id, p_user_id,
          case when p_kind = 'complaint' then p_source end,
          case when p_kind = 'return' then p_source end,
          case when p_kind = 'report' then p_source end,
          p_channel, p_summary, p_created_by, p_at,
          private.case_due(p_at, t.first_response_amount, t.first_response_unit),
          private.case_due(p_at, t.resolution_amount, t.resolution_unit))
  returning id into v_id;
  insert into private.case_entries (case_id, kind, author_id, created_at)
  values (v_id, 'opened', p_created_by, p_at);
  return v_id;
end;
$$;

-- ═══ 3. The delivery code stays out of notes and answers ═══════════════════
-- The code (private.delivery_codes, four digits) is shown to nobody but the
-- shopper. A note or an answer is refused when one of the numbers in it is
-- the real code of the case's order or of another order of the same
-- customer. A number is a run of digits that may carry separators between
-- groups (8888-1234, 8888 1234, 1.234, YT-100123's 100123): only a number
-- that IS the code is refused, so order numbers, phone numbers and amounts
-- pass. Nothing about the code is returned, only that the text has it.

create or replace function private.text_has_delivery_code(p_order_id uuid, p_user_id uuid, p_text text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.delivery_codes c
    join public.orders o on o.id = c.order_id
    where (o.id = p_order_id or o.user_id = p_user_id)
      and c.code in (
        select m[1] from regexp_matches(coalesce(p_text, ''), '([0-9]+(?:[ .,-][0-9]+)*)', 'g') as m
      )
  );
$$;

create or replace function private.guard_case_text(c private.cases, p_text text) returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if private.text_has_delivery_code(c.order_id, c.user_id, p_text) then
    perform private.fail('note_contains_code');
  end if;
end;
$$;

-- ── The source rows open, answer and close their cases ─────────────────────

create or replace function private.case_follow_complaint() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  c private.cases;
begin
  if tg_op = 'INSERT' then
    perform private.open_case('complaint', new.category, new.order_id, new.user_id, 'shop',
      new.id, null, null, new.created_at);
    return null;
  end if;
  -- ops_answer_case and ops_reopen_case write their own entries.
  if current_setting('yuntera.case_in_hand', true) = new.id::text then
    return null;
  end if;
  select * into c from private.cases where complaint_id = new.id for update;
  if not found then
    return null;
  end if;
  -- Answered from /atencion (ops_resolve_complaint): the answer goes on the timeline.
  if new.resolution is not null and new.resolution is distinct from old.resolution then
    perform private.guard_case_text(c, new.resolution);
    insert into private.case_entries (case_id, kind, author_id, body)
    values (c.id, 'answer', (select auth.uid()), new.resolution);
    update private.cases set first_response_at = coalesce(first_response_at, now()) where id = c.id;
  end if;
  if new.status = 'resolved' and c.status = 'open' then
    update private.cases set status = 'closed', resolved_at = coalesce(new.resolved_at, now()),
                             first_response_at = coalesce(first_response_at, now())
    where id = c.id;
    insert into private.case_entries (case_id, kind, author_id) values (c.id, 'closed', (select auth.uid()));
  elsif new.status <> 'resolved' and c.status = 'closed' then
    update private.cases set status = 'open', resolved_at = null, reopened_count = reopened_count + 1
    where id = c.id;
    insert into private.case_entries (case_id, kind, author_id) values (c.id, 'reopened', (select auth.uid()));
  end if;
  return null;
end;
$$;

create trigger complaints_follow_case after insert or update of status, resolution on public.complaints
  for each row execute function private.case_follow_complaint();

create or replace function private.case_follow_return() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  c private.cases;
  v_order uuid;
begin
  if tg_op = 'INSERT' then
    select i.order_id into v_order from public.order_items i where i.id = new.order_item_id;
    perform private.open_case('return', new.kind, v_order, new.user_id, 'shop',
      new.id, null, null, new.created_at);
    return null;
  end if;
  select * into c from private.cases where return_id = new.id for update;
  if not found then
    return null;
  end if;
  -- The note staff write when they decide is the customer's to read.
  if new.resolution_note is not null and new.resolution_note is distinct from old.resolution_note then
    perform private.guard_case_text(c, new.resolution_note);
    insert into private.case_entries (case_id, kind, author_id, body)
    values (c.id, 'answer', (select auth.uid()), new.resolution_note);
  end if;
  if new.status is distinct from old.status then
    insert into private.case_entries (case_id, kind, author_id, body)
    values (c.id, 'status', (select auth.uid()), new.status);
    -- A decision is a response; a withdrawal is approved by itself at once,
    -- which is not, so only a later change counts.
    update private.cases set first_response_at = coalesce(first_response_at, now()) where id = c.id;
    if new.status in ('rejected', 'refunded') and c.status = 'open' then
      update private.cases set status = 'closed', resolved_at = now() where id = c.id;
      insert into private.case_entries (case_id, kind, author_id) values (c.id, 'closed', (select auth.uid()));
    end if;
  end if;
  return null;
end;
$$;

create trigger return_requests_follow_case
  after insert or update of status, resolution_note on public.return_requests
  for each row execute function private.case_follow_return();

create or replace function private.case_follow_report() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  c private.cases;
begin
  if tg_op = 'INSERT' then
    perform private.open_case('report', new.reason, null, new.reporter_id, 'shop',
      new.id, null, null, new.created_at);
    return null;
  end if;
  select * into c from private.cases where report_id = new.id for update;
  if not found or new.status is not distinct from old.status then
    return null;
  end if;
  insert into private.case_entries (case_id, kind, author_id, body)
  values (c.id, 'status', (select auth.uid()), new.status::text);
  update private.cases set first_response_at = coalesce(first_response_at, now()) where id = c.id;
  if new.status in ('actioned', 'dismissed') and c.status = 'open' then
    update private.cases set status = 'closed', resolved_at = coalesce(new.resolved_at, now()) where id = c.id;
    insert into private.case_entries (case_id, kind, author_id) values (c.id, 'closed', (select auth.uid()));
  end if;
  return null;
end;
$$;

create trigger content_reports_follow_case after insert or update of status on public.content_reports
  for each row execute function private.case_follow_report();

-- ── A case for every complaint, return and report that already exists ──────
-- A function, so the database tests can run it on rows made without the
-- triggers; it skips every row that already has a case, so a second run
-- changes nothing. Returns how many cases it opened.

create or replace function private.cases_backfill() returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
  v_case uuid;
  v_count integer := 0;
begin
  for r in
    select * from public.complaints c
    where not exists (select 1 from private.cases k where k.complaint_id = c.id)
    order by c.created_at, c.id
  loop
    v_count := v_count + 1;
    v_case := private.open_case('complaint', r.category, r.order_id, r.user_id, 'shop',
      r.id, null, null, r.created_at);
    if r.resolution is not null then
      insert into private.case_entries (case_id, kind, body, created_at)
      values (v_case, 'answer', r.resolution, coalesce(r.resolved_at, r.created_at));
      update private.cases set first_response_at = coalesce(r.resolved_at, r.created_at) where id = v_case;
    end if;
    if r.status = 'resolved' then
      update private.cases set status = 'closed', resolved_at = coalesce(r.resolved_at, r.created_at)
      where id = v_case;
      insert into private.case_entries (case_id, kind, created_at)
      values (v_case, 'closed', coalesce(r.resolved_at, r.created_at));
    end if;
  end loop;

  for r in
    select rr.*, i.order_id from public.return_requests rr
    join public.order_items i on i.id = rr.order_item_id
    where not exists (select 1 from private.cases k where k.return_id = rr.id)
    order by rr.created_at, rr.id
  loop
    v_count := v_count + 1;
    v_case := private.open_case('return', r.kind, r.order_id, r.user_id, 'shop',
      r.id, null, null, r.created_at);
    if r.resolution_note is not null then
      insert into private.case_entries (case_id, kind, body, created_at)
      values (v_case, 'answer', r.resolution_note, coalesce(r.resolved_at, r.created_at));
    end if;
    if r.status <> 'requested' and not (r.kind = 'withdrawal' and r.status = 'approved') then
      insert into private.case_entries (case_id, kind, body, created_at)
      values (v_case, 'status', r.status, coalesce(r.resolved_at, r.created_at));
      update private.cases set first_response_at = coalesce(r.resolved_at, r.created_at) where id = v_case;
    end if;
    if r.status in ('rejected', 'refunded') then
      update private.cases set status = 'closed', resolved_at = coalesce(r.resolved_at, r.created_at)
      where id = v_case;
      insert into private.case_entries (case_id, kind, created_at)
      values (v_case, 'closed', coalesce(r.resolved_at, r.created_at));
    end if;
  end loop;

  for r in
    select * from public.content_reports cr
    where not exists (select 1 from private.cases k where k.report_id = cr.id)
    order by cr.created_at, cr.id
  loop
    v_count := v_count + 1;
    v_case := private.open_case('report', r.reason, null, r.reporter_id, 'shop',
      r.id, null, null, r.created_at);
    if r.status <> 'open' then
      insert into private.case_entries (case_id, kind, body, created_at)
      values (v_case, 'status', r.status::text, coalesce(r.resolved_at, r.created_at));
      update private.cases set first_response_at = coalesce(r.resolved_at, r.created_at) where id = v_case;
    end if;
    if r.status in ('actioned', 'dismissed') then
      update private.cases set status = 'closed', resolved_at = coalesce(r.resolved_at, r.created_at)
      where id = v_case;
      insert into private.case_entries (case_id, kind, created_at)
      values (v_case, 'closed', coalesce(r.resolved_at, r.created_at));
    end if;
  end loop;
  return v_count;
end;
$$;

select private.cases_backfill();

-- ═══ 4. Staff: cases ═══════════════════════════════════════════════════════

-- How a case stands against its clock: the first-response target until
-- someone answers, then the resolution target. 'due_soon' once less than a
-- quarter of the time allowed is left.
create or replace function private.case_next_due(c private.cases) returns timestamptz
language sql immutable
set search_path = ''
as $$
  select case when c.status = 'closed' then null
              when c.first_response_at is null then c.first_response_due_at
              else c.due_at end;
$$;

create or replace function private.case_clock(c private.cases) returns text
language sql stable
set search_path = ''
as $$
  select case
    when c.status = 'closed' then 'closed'
    when now() > private.case_next_due(c) then 'overdue'
    when private.case_next_due(c) - now()
         < (private.case_next_due(c) - case when c.first_response_at is null then c.created_at
                                            else c.first_response_at end) / 4 then 'due_soon'
    else 'on_time'
  end;
$$;

-- A case as a list row.
create or replace function private.case_row(c private.cases) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'reference', private.case_reference(c),
    'kind', c.kind,
    'topic', c.topic,
    'channel', c.channel,
    'status', c.status,
    'order_number', (select o.order_number from public.orders o where o.id = c.order_id),
    'customer', private.first_name_of(c.user_id),
    'assignee', private.first_name_of(c.assignee_id),
    'assigned_to_me', c.assignee_id is not distinct from (select auth.uid()) and c.assignee_id is not null,
    'created_at', c.created_at,
    'first_response_due_at', c.first_response_due_at,
    'due_at', c.due_at,
    'first_response_at', c.first_response_at,
    'resolved_at', c.resolved_at,
    'next_due_at', private.case_next_due(c),
    'clock', private.case_clock(c),
    'reopened_count', c.reopened_count
  );
$$;

-- The open (or closed) cases the caller's role reads, oldest first.
create or replace function public.ops_cases(
  p_status text default 'open',
  p_limit integer default 50,
  p_offset integer default 0
) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_role public.staff_role := private.case_reader_role();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  if v_role is null then
    perform private.fail('forbidden');
  end if;
  if p_status is null or p_status not in ('open', 'closed') then
    perform private.fail('invalid_case');
  end if;
  return jsonb_build_object(
    'cases', coalesce((
      select jsonb_agg(private.case_row(x.c) order by
               case when p_status = 'open' then x.created_at end,
               case when p_status = 'closed' then x.resolved_at end desc, x.id)
      from (
        select c, c.created_at, c.resolved_at, c.id from private.cases c
        where c.status = p_status and private.case_visible(v_role, c.area, c.order_id)
        order by case when p_status = 'open' then c.created_at end,
                 case when p_status = 'closed' then c.resolved_at end desc, c.id
        limit v_limit offset greatest(coalesce(p_offset, 0), 0)
      ) x), '[]'::jsonb),
    'total', (select count(*) from private.cases c
              where c.status = p_status and private.case_visible(v_role, c.area, c.order_id))
  );
end;
$$;

-- What the "Hoy" page says about cases: due before the end of today and late.
create or replace function public.ops_cases_due() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_role public.staff_role := private.case_reader_role();
  v_end timestamptz := private.cr_instant((private.cr_local(now())::date + 1)::timestamp);
begin
  if v_role is null then
    perform private.fail('forbidden');
  end if;
  return (
    select jsonb_build_object(
      'open', count(*),
      'overdue', count(*) filter (where private.case_next_due(c) < now()),
      'due_today', count(*) filter (where private.case_next_due(c) >= now()
                                      and private.case_next_due(c) < v_end))
    from private.cases c
    where c.status = 'open' and private.case_visible(v_role, c.area, c.order_id)
  );
end;
$$;

-- One case, with what was asked, the order, the customer and the timeline.
create or replace function public.ops_case(p_case_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_role public.staff_role := private.case_reader_role();
  c private.cases;
  v_request jsonb;
begin
  if v_role is null then
    perform private.fail('forbidden');
  end if;
  select * into c from private.cases where id = p_case_id;
  -- A case the role does not read is answered as one that does not exist.
  if not found or not private.case_visible(v_role, c.area, c.order_id) then
    perform private.fail('case_not_found');
  end if;

  v_request := case c.kind
    when 'complaint' then (
      select jsonb_build_object('text', x.description, 'category', x.category, 'status', x.status)
      from public.complaints x where x.id = c.complaint_id)
    when 'return' then (
      select jsonb_build_object('text', x.reason, 'return_kind', x.kind, 'status', x.status,
               'quantity', x.quantity, 'title', i.title, 'refund_due_on', x.refund_due_on)
      from public.return_requests x join public.order_items i on i.id = x.order_item_id
      where x.id = c.return_id)
    when 'report' then (
      select jsonb_build_object('text', x.details, 'reason', x.reason, 'status', x.status,
               'target_type', x.target_type, 'target_id', x.target_id)
      from public.content_reports x where x.id = c.report_id)
    else jsonb_build_object('text', c.summary)
  end;

  return private.case_row(c) || jsonb_build_object(
    'request', v_request,
    'order', (
      select jsonb_build_object('order_number', o.order_number, 'status', o.status,
               'placed_at', o.placed_at, 'total_minor', o.total_minor,
               'item_count', (select count(*) from public.order_items i where i.order_id = o.id))
      from public.orders o where o.id = c.order_id),
    'customer', case when c.user_id is not null then jsonb_build_object(
      'id', c.user_id,
      'first_name', private.first_name_of(c.user_id),
      'district', (select d.name from public.orders o
                   join public.districts d on d.postal_code = o.ship_postal_code
                   where o.id = coalesce(c.order_id, (
                     select o2.id from public.orders o2 where o2.user_id = c.user_id
                     order by o2.placed_at desc limit 1))))
    end,
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'kind', e.kind, 'body', e.body, 'created_at', e.created_at,
               'author', private.first_name_of(e.author_id)) order by e.id)
      from private.case_entries e where e.case_id = c.id), '[]'::jsonb),
    'can', jsonb_build_object(
      'note', v_role in ('admin', 'support', 'ops', 'finance'),
      'answer', v_role in ('admin', 'support') and c.status = 'open',
      'assign', v_role in ('admin', 'support') and c.status = 'open'
                and c.assignee_id is distinct from (select auth.uid()),
      'reopen', v_role in ('admin', 'support') and c.status = 'closed',
      'customer', c.user_id is not null and v_role in ('admin', 'support', 'ops', 'finance'))
  );
end;
$$;

-- Locks a case the caller may work on, or fails as if it did not exist.
create or replace function private.case_for_work(p_case_id uuid, p_role public.staff_role)
returns private.cases
language plpgsql security definer
set search_path = ''
as $$
declare
  c private.cases;
begin
  select * into c from private.cases where id = p_case_id for update;
  if not found or not private.case_visible(p_role, c.area, c.order_id) then
    perform private.fail('case_not_found');
  end if;
  return c;
end;
$$;

-- An internal note: staff only, never shown to the customer.
create or replace function public.ops_add_case_note(p_case_id uuid, p_body text) returns bigint
language plpgsql security definer
set search_path = ''
as $$
declare
  v_role public.staff_role := private.case_reader_role();
  v_body text := trim(coalesce(p_body, ''));
  c private.cases;
  v_id bigint;
begin
  if v_role is null or v_role not in ('admin', 'support', 'ops', 'finance') then
    perform private.fail('forbidden');
  end if;
  c := private.case_for_work(p_case_id, v_role);
  if char_length(v_body) not between 1 and 2000 then
    perform private.fail('invalid_note');
  end if;
  perform private.guard_case_text(c, v_body);
  insert into private.case_entries (case_id, kind, author_id, body)
  values (c.id, 'note', (select auth.uid()), v_body)
  returning id into v_id;
  return v_id;
end;
$$;

-- The answer the customer reads, in their account and on the order's page,
-- and a message that says there is one (through the notification planner).
create or replace function public.ops_answer_case(
  p_case_id uuid,
  p_body text,
  p_close boolean default false
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_role public.staff_role := private.case_reader_role();
  v_body text := trim(coalesce(p_body, ''));
  v_close boolean := coalesce(p_close, false);
  c private.cases;
  v_event bigint;
begin
  if v_role is null or v_role not in ('admin', 'support') then
    perform private.fail('forbidden');
  end if;
  c := private.case_for_work(p_case_id, v_role);
  if c.status = 'closed' then
    perform private.fail('case_closed');
  end if;
  if char_length(v_body) not between 10 and 4000 then
    perform private.fail('reason_required');
  end if;
  perform private.guard_case_text(c, v_body);

  insert into private.case_entries (case_id, kind, author_id, body)
  values (c.id, 'answer', (select auth.uid()), v_body);
  update private.cases
  set first_response_at = coalesce(first_response_at, now()),
      status = case when v_close then 'closed' else status end,
      resolved_at = case when v_close then now() else resolved_at end
  where id = c.id;
  if v_close then
    insert into private.case_entries (case_id, kind, author_id) values (c.id, 'closed', (select auth.uid()));
  end if;

  if c.kind = 'complaint' then
    -- The complaint itself says the same, so /atencion and the register agree.
    perform set_config('yuntera.case_in_hand', c.complaint_id::text, true);
    update public.complaints
    set resolution = v_body,
        status = case when v_close then 'resolved' else 'in_progress' end,
        resolved_at = case when v_close then now() else null end
    where id = c.complaint_id;
    perform set_config('yuntera.case_in_hand', '', true);
    perform private.emit('complaint.answered',
      jsonb_build_object('complaint_id', c.complaint_id, 'closed', v_close));
  elsif c.user_id is not null then
    -- Planned at once (no consumer reads this topic), so it is recorded as
    -- processed; the message says there is an answer, never the answer.
    insert into private.outbox_events (topic, payload, processed_at)
    values ('case.answered', jsonb_build_object('case_id', c.id, 'closed', v_close), now())
    returning id into v_event;
    perform private.notify_person(v_event, 'case_answered', c.user_id, array['email', 'push'],
      coalesce('order:' || c.order_id, 'user:' || c.user_id),
      jsonb_strip_nulls(jsonb_build_object('order_id', c.order_id,
        'case_ref', private.case_reference(c), 'case_kind', c.kind, 'closed', v_close)));
  end if;

  select * into c from private.cases where id = c.id;
  return private.case_row(c);
end;
$$;

-- "Asignarme el caso".
create or replace function public.ops_assign_case(p_case_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_role public.staff_role := private.case_reader_role();
  c private.cases;
begin
  if v_role is null or v_role not in ('admin', 'support') then
    perform private.fail('forbidden');
  end if;
  c := private.case_for_work(p_case_id, v_role);
  if c.status = 'closed' then
    perform private.fail('case_closed');
  end if;
  if c.assignee_id is distinct from (select auth.uid()) then
    update private.cases set assignee_id = (select auth.uid()) where id = c.id;
    insert into private.case_entries (case_id, kind, author_id) values (c.id, 'assigned', (select auth.uid()));
  end if;
  select * into c from private.cases where id = c.id;
  return private.case_row(c);
end;
$$;

-- A closed case opened again: it counts as reopened in the monthly report,
-- and its resolution target starts again from now.
create or replace function public.ops_reopen_case(p_case_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_role public.staff_role := private.case_reader_role();
  c private.cases;
  t private.case_targets;
begin
  if v_role is null or v_role not in ('admin', 'support') then
    perform private.fail('forbidden');
  end if;
  c := private.case_for_work(p_case_id, v_role);
  if c.status = 'open' then
    perform private.fail('case_open');
  end if;
  t := private.case_target(c.kind, c.topic);
  update private.cases
  set status = 'open', resolved_at = null, reopened_count = reopened_count + 1,
      due_at = private.case_due(now(), t.resolution_amount, t.resolution_unit)
  where id = c.id;
  insert into private.case_entries (case_id, kind, author_id) values (c.id, 'reopened', (select auth.uid()));
  if c.kind = 'complaint' then
    perform set_config('yuntera.case_in_hand', c.complaint_id::text, true);
    update public.complaints set status = 'in_progress', resolved_at = null where id = c.complaint_id;
    perform set_config('yuntera.case_in_hand', '', true);
  end if;
  select * into c from private.cases where id = c.id;
  return private.case_row(c);
end;
$$;

-- "Registrar un contacto": a WhatsApp, phone or e-mail conversation recorded
-- as a case against an order (by its number) or an account, with a summary.
create or replace function public.ops_record_contact(
  p_channel text,
  p_topic text,
  p_summary text,
  p_order_number text default null,
  p_user_id uuid default null
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_role public.staff_role := private.case_reader_role();
  v_summary text := trim(coalesce(p_summary, ''));
  v_order uuid;
  v_user uuid;
  v_id uuid;
begin
  if v_role is null or v_role not in ('admin', 'support') then
    perform private.fail('forbidden');
  end if;
  if p_channel is null or p_channel not in ('whatsapp', 'phone', 'email')
     or p_topic is null or p_topic not in ('delivery_today', 'delivery_problem', 'item_problem',
                                           'return', 'payment', 'seller', 'listing', 'complaint', 'other')
     or char_length(v_summary) not between 10 and 1000
     or (p_order_number is null and p_user_id is null)
     or char_length(p_order_number) > 40 then
    perform private.fail('invalid_contact');
  end if;
  if p_order_number is not null then
    select o.id, o.user_id into v_order, v_user from public.orders o where o.order_number = trim(p_order_number);
    if v_order is null or (p_user_id is not null and p_user_id <> v_user) then
      perform private.fail('order_not_found');
    end if;
  else
    select u.id into v_user from auth.users u
    where u.id = p_user_id and u.deleted_at is null
      and not exists (select 1 from public.staff_members s where s.user_id = u.id);
    if v_user is null then
      perform private.fail('customer_not_found');
    end if;
  end if;
  if private.text_has_delivery_code(v_order, v_user, v_summary) then
    perform private.fail('note_contains_code');
  end if;
  v_id := private.open_case('contact', p_topic, v_order, v_user, p_channel, null, v_summary,
    (select auth.uid()), now());
  return v_id;
end;
$$;

-- The cases of one order, for the staff order page, and whose order it is
-- (the link to the customer view). Roles that open the order page.
create or replace function public.ops_order_cases(p_order_number text) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_role public.staff_role := private.case_reader_role();
  o public.orders;
begin
  if v_role is null or v_role not in ('admin', 'support', 'ops', 'finance') then
    perform private.fail('forbidden');
  end if;
  select * into o from public.orders where order_number = p_order_number;
  if not found then
    perform private.fail('order_not_found');
  end if;
  return jsonb_build_object(
    'customer_id', o.user_id,
    'cases', coalesce((
      select jsonb_agg(private.case_row(c) order by c.created_at, c.id)
      from private.cases c
      where c.order_id = o.id and private.case_visible(v_role, c.area, c.order_id)), '[]'::jsonb)
  );
end;
$$;

-- The register for a period [p_from, p_to): the measures customer-service.md
-- names ("What support is measured on") that the database can count.
create or replace function public.ops_case_report(p_from date, p_to date) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
begin
  if not private.has_staff_role('support') then
    perform private.fail('forbidden');
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > 366 then
    perform private.fail('invalid_period');
  end if;
  v_from := private.cr_instant(p_from::timestamp);
  v_to := private.cr_instant(p_to::timestamp);
  return (
    with period as (
      select c.* from private.cases c where c.created_at >= v_from and c.created_at < v_to
    ), answered as (
      select extract(epoch from (p.first_response_at - p.created_at)) / 60 as minutes,
             p.first_response_at <= p.first_response_due_at as on_time
      from period p where p.first_response_at is not null
    )
    select jsonb_build_object(
      'from', p_from, 'to', p_to,
      'total', (select count(*) from period),
      'by_kind', coalesce((select jsonb_object_agg(k.kind, k.n) from (
        select p.kind, count(*) as n from period p group by p.kind) k), '{}'::jsonb),
      'by_topic', coalesce((select jsonb_agg(jsonb_build_object('kind', k.kind, 'topic', k.topic, 'count', k.n)
                                             order by k.n desc, k.kind, k.topic) from (
        select p.kind, p.topic, count(*) as n from period p group by p.kind, p.topic) k), '[]'::jsonb),
      'orders', (select count(*) from public.orders o where o.placed_at >= v_from and o.placed_at < v_to),
      -- A case not answered yet whose first-response time has passed counts as late.
      'first_response', jsonb_build_object(
        'answered', (select count(*) from answered),
        'on_time', (select count(*) from answered a where a.on_time),
        'late_unanswered', (select count(*) from period p
                            where p.first_response_at is null and p.first_response_due_at < now()),
        'median_minutes', (select round(percentile_cont(0.5) within group (order by a.minutes))::integer
                           from answered a)),
      'complaints_answered_in_time', jsonb_build_object(
        'closed', (select count(*) from period p where p.kind = 'complaint' and p.resolved_at is not null),
        'on_time', (select count(*) from period p
                    where p.kind = 'complaint' and p.resolved_at is not null and p.resolved_at <= p.due_at),
        'late_open', (select count(*) from period p
                      where p.kind = 'complaint' and p.resolved_at is null and p.due_at < now())),
      'refunds_in_legal_time', jsonb_build_object(
        'refunded', (select count(*) from period p join public.return_requests r on r.id = p.return_id
                     where r.status = 'refunded' and r.refund_due_on is not null),
        'on_time', (select count(*) from period p join public.return_requests r on r.id = p.return_id
                    where r.status = 'refunded' and r.refund_due_on is not null
                      and private.cr_local(r.resolved_at)::date <= r.refund_due_on)),
      'reopened', (select count(*) from period p where p.reopened_count > 0)
    )
  );
end;
$$;

-- The targets the clocks use, for administrators and support to read.
create or replace function public.ops_case_targets() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('support') then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'kind', t.kind, 'topic', t.topic, 'situation', t.situation,
             'first_response_amount', t.first_response_amount, 'first_response_unit', t.first_response_unit,
             'resolution_amount', t.resolution_amount, 'resolution_unit', t.resolution_unit)
           order by t.kind, t.topic = '*', t.topic)
    from private.case_targets t), '[]'::jsonb);
end;
$$;

-- ═══ 5. Saved answers ══════════════════════════════════════════════════════

create table private.saved_replies (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 80),
  body text not null check (char_length(body) between 10 and 4000),
  updated_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index saved_replies_title_idx on private.saved_replies (lower(title));

alter table private.saved_replies enable row level security;
revoke all on private.saved_replies from public, anon, authenticated;

-- Every change to a saved answer is on the audit trail.
create trigger audit_saved_replies after insert or update or delete on private.saved_replies
  for each row execute function private.audit();

-- The five commonest questions (support research, section 2.1), to start with.
insert into private.saved_replies (title, body) values
  ('Dónde está mi pedido',
   'Gracias por escribirnos. Revisamos su pedido: en la página del pedido, en su cuenta, ve el estado de cada paquete y la fecha en que llega. Si la fecha cambia, le avisamos antes.'),
  ('Cambiar la fecha de entrega',
   'Gracias por avisarnos. Podemos entregar su pedido otro día hábil de reparto. Díganos qué día le sirve y se lo confirmamos por este medio.'),
  ('Cómo devolver un producto',
   'Puede devolverlo desde la página de su pedido, con «Devolver». Pasamos a recogerlo en una de nuestras rutas, sin costo, y le devolvemos el dinero por el mismo medio con el que pagó.'),
  ('Estado de su reembolso',
   'Su reembolso está en curso. Le devolvemos el dinero por el mismo medio con el que pagó, en un máximo de 8 días naturales desde su solicitud, y le escribimos cuando salga.'),
  ('El pago no pasó',
   'El pago no se completó, así que no se le cobró. Puede intentarlo de nuevo desde la página de su pedido, con otra tarjeta o con SINPE Móvil.');

create or replace function public.ops_saved_replies() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('support') then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'body', r.body,
                                        'updated_at', r.updated_at) order by lower(r.title))
    from private.saved_replies r), '[]'::jsonb);
end;
$$;

create or replace function public.ops_save_reply(p_title text, p_body text, p_id uuid default null)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_title text := trim(coalesce(p_title, ''));
  v_body text := trim(coalesce(p_body, ''));
  v_id uuid;
begin
  if not private.has_staff_role('admin') then
    perform private.fail('forbidden');
  end if;
  if char_length(v_title) not between 3 and 80 or char_length(v_body) not between 10 and 4000 then
    perform private.fail('invalid_saved_reply');
  end if;
  if p_id is null then
    insert into private.saved_replies (title, body, updated_by)
    values (v_title, v_body, (select auth.uid()))
    returning id into v_id;
  else
    update private.saved_replies
    set title = v_title, body = v_body, updated_by = (select auth.uid()), updated_at = now()
    where id = p_id
    returning id into v_id;
    if v_id is null then
      perform private.fail('reply_not_found');
    end if;
  end if;
  return v_id;
exception
  when unique_violation then
    perform private.fail('reply_title_taken');
end;
$$;

create or replace function public.ops_delete_reply(p_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('admin') then
    perform private.fail('forbidden');
  end if;
  delete from private.saved_replies where id = p_id;
  if not found then
    perform private.fail('reply_not_found');
  end if;
end;
$$;

-- ═══ 6. The customer view ══════════════════════════════════════════════════
-- Reached from an order or a case, never from a list of all customers (no
-- function lists them). No contact details here: those come one customer at
-- a time from ops_customer_contact, with a reason, on the audit trail.

create or replace function public.ops_customer(p_user_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_role public.staff_role := private.case_reader_role();
begin
  if v_role is null or v_role not in ('admin', 'support', 'ops', 'finance') then
    perform private.fail('forbidden');
  end if;
  if p_user_id is null or not exists (
    select 1 from auth.users u where u.id = p_user_id
      and (exists (select 1 from public.orders o where o.user_id = u.id)
           or exists (select 1 from private.cases c where c.user_id = u.id))) then
    perform private.fail('customer_not_found');
  end if;
  return jsonb_build_object(
    'id', p_user_id,
    'first_name', private.first_name_of(p_user_id),
    'district', (select d.name from public.orders o
                 join public.districts d on d.postal_code = o.ship_postal_code
                 where o.user_id = p_user_id order by o.placed_at desc limit 1),
    'account_deleted', exists (select 1 from auth.users u where u.id = p_user_id and u.deleted_at is not null),
    'order_count', (select count(*) from public.orders o where o.user_id = p_user_id),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object('order_number', x.order_number, 'status', x.status,
               'placed_at', x.placed_at, 'total_minor', x.total_minor) order by x.placed_at desc)
      from (select o.* from public.orders o where o.user_id = p_user_id
            order by o.placed_at desc limit 50) x), '[]'::jsonb),
    'returns', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'status', r.status,
               'quantity', r.quantity, 'title', i.title, 'order_number', o.order_number,
               'created_at', r.created_at) order by r.created_at desc)
      from public.return_requests r
      join public.order_items i on i.id = r.order_item_id
      join public.orders o on o.id = i.order_id
      where r.user_id = p_user_id), '[]'::jsonb),
    'complaints', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'category', c.category, 'status', c.status,
               'order_number', o.order_number, 'created_at', c.created_at) order by c.created_at desc)
      from public.complaints c left join public.orders o on o.id = c.order_id
      where c.user_id = p_user_id), '[]'::jsonb),
    'cases', coalesce((
      select jsonb_agg(private.case_row(c) order by c.created_at desc)
      from private.cases c
      where c.user_id = p_user_id and private.case_visible(v_role, c.area, c.order_id)), '[]'::jsonb),
    'can_reveal_contact', v_role in ('admin', 'support')
  );
end;
$$;

-- "Mostrar contacto": the customer's e-mail and phone, for support and
-- administrators, with the reason written on the audit trail (shown on
-- Auditoría as "Vio el contacto de un cliente"). The trail keeps the reason
-- and whose contact it was (the account id), never the contact itself.
create or replace function public.ops_customer_contact(p_user_id uuid, p_reason text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_reason text := trim(coalesce(p_reason, ''));
  v_email text;
  v_phone text;
begin
  if not private.has_staff_role('support') then
    perform private.fail('forbidden');
  end if;
  if char_length(v_reason) not between 10 and 300 then
    perform private.fail('reason_required');
  end if;
  select case when u.deleted_at is null then u.email::text end,
         coalesce(p.phone,
                  (select a.phone from public.addresses a where a.user_id = u.id
                   order by a.is_default desc, a.created_at desc limit 1))
  into v_email, v_phone
  from auth.users u left join public.profiles p on p.id = u.id
  where u.id = p_user_id
    and (exists (select 1 from public.orders o where o.user_id = u.id)
         or exists (select 1 from private.cases c where c.user_id = u.id));
  if not found then
    perform private.fail('customer_not_found');
  end if;
  insert into private.audit_log (actor_id, action, table_name, row_key, old_row, new_row)
  values ((select auth.uid()), 'VIEW_CONTACT', 'customers', p_user_id::text, null,
          jsonb_build_object('reason', v_reason));
  return jsonb_build_object('email', v_email, 'phone', v_phone);
end;
$$;

-- ═══ 7. The shopper's own cases ════════════════════════════════════════════
-- Their cases with the answers staff wrote, never the internal notes, never
-- more of staff than a first name, never anyone else's case.

create or replace function private.my_case_row(c private.cases) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'reference', private.case_reference(c),
    'kind', c.kind,
    'topic', c.topic,
    'status', c.status,
    'created_at', c.created_at,
    -- The last day, Costa Rica time, of the promise (due times are the end of a day).
    'answer_due_on', (private.cr_local(c.due_at) - interval '1 second')::date,
    'resolved_at', c.resolved_at,
    'order_number', (select o.order_number from public.orders o where o.id = c.order_id),
    'answers', coalesce((
      select jsonb_agg(jsonb_build_object('body', e.body, 'created_at', e.created_at,
               'author', private.first_name_of(e.author_id)) order by e.id)
      from private.case_entries e where e.case_id = c.id and e.kind = 'answer'), '[]'::jsonb)
  );
$$;

create or replace function public.my_cases(p_order_number text default null) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_order uuid;
begin
  if v_user is null then
    perform private.fail('not_authenticated');
  end if;
  if p_order_number is not null then
    select o.id into v_order from public.orders o where o.order_number = p_order_number and o.user_id = v_user;
    if v_order is null then
      perform private.fail('order_not_found');
    end if;
  end if;
  return coalesce((
    select jsonb_agg(private.my_case_row(x.c) order by x.created_at desc, x.id)
    from (
      select c, c.created_at, c.id from private.cases c
      where c.user_id = v_user and (v_order is null or c.order_id = v_order)
      order by c.created_at desc, c.id
      limit 50
    ) x), '[]'::jsonb);
end;
$$;

-- What the complaint form shows once file_complaint has answered: the
-- reference, when it was filed, and by when the acknowledgement and the
-- written answer are promised.
create or replace function public.my_complaint_receipt(p_complaint_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  c private.cases;
begin
  if v_user is null then
    perform private.fail('not_authenticated');
  end if;
  select * into c from private.cases where complaint_id = p_complaint_id and user_id = v_user;
  if not found then
    perform private.fail('complaint_not_found');
  end if;
  return jsonb_build_object(
    'reference', private.case_reference(c),
    'filed_at', c.created_at,
    -- The last days, Costa Rica time, of the two promises.
    'acknowledge_by', (private.cr_local(c.first_response_due_at) - interval '1 second')::date,
    'answer_by', (private.cr_local(c.due_at) - interval '1 second')::date,
    'order_number', (select o.order_number from public.orders o where o.id = c.order_id)
  );
end;
$$;

-- ═══ 8. Account deletion ═══════════════════════════════════════════════════
-- delete_my_account marks the sign-in record deleted; the text of the
-- person's cases (a contact's summary, notes and answers, which may name
-- them) goes with it. The cases stay, as the complaints do, for the register.

create or replace function private.erase_case_text() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.deleted_at is null or old.deleted_at is not null then
    return null;
  end if;
  perform set_config('yuntera.erasing_cases', 'on', true);
  update private.case_entries e set body = private.erased_case_text()
  from private.cases c
  where c.id = e.case_id and c.user_id = new.id and e.body is not null
    and e.body <> private.erased_case_text();
  perform set_config('yuntera.erasing_cases', '', true);
  update private.cases c set summary = private.erased_case_text()
  where c.user_id = new.id and c.summary is not null;
  return null;
end;
$$;

create trigger auth_users_erase_case_text after update of deleted_at on auth.users
  for each row execute function private.erase_case_text();

-- ═══ Grants ════════════════════════════════════════════════════════════════

revoke all on function private.cr_instant(timestamp) from public, anon, authenticated;
revoke all on function private.case_due(timestamptz, integer, text) from public, anon, authenticated;
revoke all on function private.case_target(text, text) from public, anon, authenticated;
revoke all on function private.case_entries_append_only() from public, anon, authenticated;
revoke all on function private.erased_case_text() from public, anon, authenticated;
revoke all on function private.case_area(text, text, uuid) from public, anon, authenticated;
revoke all on function private.case_reader_role() from public, anon, authenticated;
revoke all on function private.case_visible(public.staff_role, text, uuid) from public, anon, authenticated;
revoke all on function private.case_reference(private.cases) from public, anon, authenticated;
revoke all on function private.first_name_of(uuid) from public, anon, authenticated;
revoke all on function private.open_case(text, text, uuid, uuid, text, uuid, text, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function private.text_has_delivery_code(uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.guard_case_text(private.cases, text) from public, anon, authenticated;
revoke all on function private.case_follow_complaint() from public, anon, authenticated;
revoke all on function private.case_follow_return() from public, anon, authenticated;
revoke all on function private.case_follow_report() from public, anon, authenticated;
revoke all on function private.case_next_due(private.cases) from public, anon, authenticated;
revoke all on function private.case_clock(private.cases) from public, anon, authenticated;
revoke all on function private.case_row(private.cases) from public, anon, authenticated;
revoke all on function private.case_for_work(uuid, public.staff_role) from public, anon, authenticated;
revoke all on function private.my_case_row(private.cases) from public, anon, authenticated;
revoke all on function private.erase_case_text() from public, anon, authenticated;
revoke all on function private.cases_backfill() from public, anon, authenticated;

revoke all on function public.ops_cases(text, integer, integer) from public, anon;
revoke all on function public.ops_cases_due() from public, anon;
revoke all on function public.ops_case(uuid) from public, anon;
revoke all on function public.ops_add_case_note(uuid, text) from public, anon;
revoke all on function public.ops_answer_case(uuid, text, boolean) from public, anon;
revoke all on function public.ops_assign_case(uuid) from public, anon;
revoke all on function public.ops_reopen_case(uuid) from public, anon;
revoke all on function public.ops_record_contact(text, text, text, text, uuid) from public, anon;
revoke all on function public.ops_order_cases(text) from public, anon;
revoke all on function public.ops_case_report(date, date) from public, anon;
revoke all on function public.ops_case_targets() from public, anon;
revoke all on function public.ops_saved_replies() from public, anon;
revoke all on function public.ops_save_reply(text, text, uuid) from public, anon;
revoke all on function public.ops_delete_reply(uuid) from public, anon;
revoke all on function public.ops_customer(uuid) from public, anon;
revoke all on function public.ops_customer_contact(uuid, text) from public, anon;
revoke all on function public.my_cases(text) from public, anon;
revoke all on function public.my_complaint_receipt(uuid) from public, anon;

grant execute on function public.ops_cases(text, integer, integer) to authenticated;
grant execute on function public.ops_cases_due() to authenticated;
grant execute on function public.ops_case(uuid) to authenticated;
grant execute on function public.ops_add_case_note(uuid, text) to authenticated;
grant execute on function public.ops_answer_case(uuid, text, boolean) to authenticated;
grant execute on function public.ops_assign_case(uuid) to authenticated;
grant execute on function public.ops_reopen_case(uuid) to authenticated;
grant execute on function public.ops_record_contact(text, text, text, text, uuid) to authenticated;
grant execute on function public.ops_order_cases(text) to authenticated;
grant execute on function public.ops_case_report(date, date) to authenticated;
grant execute on function public.ops_case_targets() to authenticated;
grant execute on function public.ops_saved_replies() to authenticated;
grant execute on function public.ops_save_reply(text, text, uuid) to authenticated;
grant execute on function public.ops_delete_reply(uuid) to authenticated;
grant execute on function public.ops_customer(uuid) to authenticated;
grant execute on function public.ops_customer_contact(uuid, text) to authenticated;
grant execute on function public.my_cases(text) to authenticated;
grant execute on function public.my_complaint_receipt(uuid) to authenticated;
