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
--   9. What Atención reads of a customer's own words (ops_care_queues,
--      redefined): their own delivery code masked, and only what the role
--      reads in Casos.
--  10. Atención's doors keep a refusal (ops_resolve_complaint,
--      ops_decide_return, ops_receive_return, ops_complete_return, redefined).
--
-- Who sees which case (section 4.1): support and admin all of them; ops the
-- cases tied to an order; finance the cases about payments and refunds;
-- catalog the cases about listings (content reports). Every function checks
-- the role again. Sellers never reach a case. The triggers follow the
-- source rows whatever function changes them; the only existing functions
-- this migration redefines are the five of sections 9 and 10.

-- ═══ 1. Response targets ═══════════════════════════════════════════════════

-- One row per kind of case and topic ('*' = any other topic of that kind).
-- first_response: the first human answer; resolution: the case closed.
-- Units: minutes; working_hours (counted between 08:00 and 17:00 of working
-- days, from the moment the case opens; what is left at 17:00 carries to the
-- next working day); working_days
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
  v_left interval;
  v_free interval;
  -- When people start and stop answering on a working day. customer-service.md
  -- says the hours are published but does not give them: both are
  -- assumptions to confirm.
  c_opens constant time := time '08:00';
  c_closes constant time := time '17:00';
begin
  case p_unit
    when 'minutes' then
      return p_from + make_interval(mins => p_amount);
    when 'working_hours' then
      -- Counted only inside working hours: what is left at closing time
      -- carries to the opening of the next working day.
      v_left := make_interval(hours => p_amount);
      loop
        v_day := v_local::date;
        if private.add_business_days(v_day - 1, 1) <> v_day or v_local::time >= c_closes then
          v_local := private.add_business_days(v_day, 1) + c_opens;
          continue;
        end if;
        if v_local::time < c_opens then
          v_local := v_day + c_opens;
        end if;
        v_free := (v_day + c_closes) - v_local;
        if v_left <= v_free then
          return private.cr_instant(v_local + v_left);
        end if;
        v_left := v_left - v_free;
        v_local := private.add_business_days(v_day, 1) + c_opens;
      end loop;
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
  -- Nothing in the API deletes these; if one is deleted (a test cleaning up
  -- after itself), its case and the case's timeline go with it.
  complaint_id uuid unique references public.complaints (id) on delete cascade,
  return_id uuid unique references public.return_requests (id) on delete cascade,
  report_id uuid unique references public.content_reports (id) on delete cascade,
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
-- deletes an entry. Two exceptions: erasing the text of a deleted account's
-- cases (section 8), and the entries of a case that is itself gone (its
-- source row was deleted, which nothing in the API does).
create table private.case_entries (
  id bigint generated always as identity primary key,
  case_id uuid not null references private.cases (id) on delete cascade,
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
  if tg_op = 'DELETE' and not exists (select 1 from private.cases c where c.id = old.case_id) then
    return old;
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

-- Whether an account is a customer: it ordered, complained or asked for a
-- return. Only customers have a customer view, a revealable contact or a
-- recorded contact against their account (a seller or a driver account
-- that never bought anything is not one).
create or replace function private.is_customer(p_user_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.orders o where o.user_id = p_user_id)
      or exists (select 1 from public.complaints c where c.user_id = p_user_id)
      or exists (select 1 from public.return_requests r where r.user_id = p_user_id);
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
-- shopper. A note, an answer or a contact summary is refused when it holds
-- the real code of the case's order, or of another order of the same
-- customer that is still to be delivered.
--
-- What counts as "holding" it, after the text is brought to plain digits
-- (NFKC, the decimal digits of other scripts mapped to 0-9, invisible format
-- characters and combining marks removed):
--   * a run of digits that is the code ('4821', 'x4821x', '4821 8888');
--   * consecutive runs joined by one to three characters that are neither a
--     letter nor a digit (spaces, dots, commas, dashes, slashes, colons,
--     underscores, brackets, line breaks) whose digits together are the code
--     ('48-21', '4 8 2 1', '48.21', '4/8/2/1', '(4)(8)(2)(1)'). These are the
--     gaps the mask of a customer's words reads too, so no shape the mask
--     would hide is one the guard lets pass uncounted.
-- Three shapes are read whole and never split, so they pass: an order number
-- (YT-100123), a Costa Rica phone written 8888-1234 or +506 8888 1234, and
-- an amount with a colón or dollar sign and thousands separators (₡4.821).
-- A text with more than five different four-digit numbers is refused as
-- such, whatever the code, so one note cannot test many guesses.
--
-- The guard must not become a way to find the code by trying numbers: every
-- refusal from a staff function is written on the audit trail (who and which
-- case, never the text or the code), and a staff member with three refusals
-- in the last hour cannot write notes, answers or contacts until the hour
-- has passed. To keep that row, the staff functions do not raise on a
-- refusal: they answer null, and the client shows note_contains_code.
-- Every four-digit number a writer writes also counts against an hourly
-- allowance (case_text_max_numbers), so accepted texts cannot test guesses
-- without end either.
--
-- The other direction: a customer may type their own live code into a
-- complaint, a return's reason or a report. What the staff functions answer
-- of those words masks it (mask_shopper_codes); the customer still reads
-- their own words as written. Only the customer's words are masked, never a
-- text staff wrote: a staff text passed the guard when it was written, and
-- masking it would show the writer which of their numbers is a live code
-- without counting anything (an oracle outside the lock-out and the
-- allowance).
--
-- Concurrent texts of one writer are checked one after another (an
-- advisory lock per writer in case_text_allowed), so the lock-out and the
-- allowance hold however many calls arrive at once.

-- Decimal digits of other scripts, '0' to '9' of each (NFKC already turns
-- full-width, mathematical, circled and superscript digits into 0-9).
create or replace function private.foreign_digits() returns text
language sql immutable
set search_path = ''
as $$
  select string_agg(chr(z + d), '' order by z, d)
  from unnest(array[
    x'0660'::int, x'06F0'::int, x'07C0'::int, x'0966'::int, x'09E6'::int, x'0A66'::int,
    x'0AE6'::int, x'0B66'::int, x'0BE6'::int, x'0C66'::int, x'0CE6'::int, x'0D66'::int,
    x'0DE6'::int, x'0E50'::int, x'0ED0'::int, x'0F20'::int, x'1040'::int, x'1090'::int,
    x'17E0'::int, x'1810'::int, x'1946'::int, x'19D0'::int, x'1A80'::int, x'1A90'::int,
    x'1B50'::int, x'1BB0'::int, x'1C40'::int, x'1C50'::int, x'A620'::int, x'A8D0'::int,
    x'A900'::int, x'A9D0'::int, x'A9F0'::int, x'AA50'::int, x'ABF0'::int, x'FF10'::int,
    x'104A0'::int]) z
  cross join generate_series(0, 9) d;
$$;

-- A text brought to plain digits, as the guard reads it: NFKC, the decimal
-- digits of other scripts mapped to 0-9, invisible characters (soft hyphen,
-- zero-width, direction marks, word joiners, variation selectors, byte-order
-- mark) and combining marks removed.
create or replace function private.case_text_plain(p_text text) returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  v text := coalesce(p_text, '');
begin
  v := normalize(v, NFKC);
  v := translate(v, private.foreign_digits(), repeat('0123456789', 37));
  return regexp_replace(v,
    '[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ̀-ͯ᪰-᫿⃐-⃿]',
    '', 'g');
end;
$$;

-- The four-digit numbers a text holds, as the guard reads them (see above).
create or replace function private.case_text_numbers(p_text text) returns text[]
language plpgsql immutable
set search_path = ''
as $$
declare
  v text := private.case_text_plain(p_text);
  v_group text;
  v_runs text[];
  v_found text[] := '{}';
  v_join text;
begin
  -- The shapes read whole.
  v := regexp_replace(v, '[Yy][Tt]-?[0-9]+', ' ', 'g');
  v := regexp_replace(v, '\+ ?506[ .-]?[0-9]{4}[ .-]?[0-9]{4}(?![0-9])', ' ', 'g');
  v := regexp_replace(v, '(?<![0-9][ .,-]?)[245678][0-9]{3}-[0-9]{4}(?![0-9]|[ .,-][0-9])', ' ', 'g');
  v := regexp_replace(v, '[₡$] ?[0-9]{1,3}(?:[.,][0-9]{3})+(?:,[0-9]{1,2})?(?![0-9])', ' ', 'g');

  for v_group in
    select m[1] from regexp_matches(v, '([0-9]+(?:[^[:alnum:]]{1,3}[0-9]+)*)', 'g') m
  loop
    v_runs := regexp_split_to_array(regexp_replace(v_group, '[^0-9]+', ' ', 'g'), ' ');
    for i in 1 .. cardinality(v_runs) loop
      v_join := '';
      for j in i .. cardinality(v_runs) loop
        v_join := v_join || v_runs[j];
        exit when char_length(v_join) > 4;
        if char_length(v_join) = 4 and not v_join = any (v_found) then
          v_found := v_found || v_join;
        end if;
      end loop;
    end loop;
  end loop;
  return v_found;
end;
$$;

-- Refusals in the last hour that lock a staff member out of writing.
create or replace function private.case_text_max_refusals() returns integer
language sql immutable
set search_path = ''
as $$ select 3 $$;

-- Four-digit numbers a staff member may write in an hour, in notes, answers,
-- contact summaries, complaint answers and return notes together. A year or
-- an amount written now and then stays far below it.
create or replace function private.case_text_max_numbers() returns integer
language sql immutable
set search_path = ''
as $$ select 20 $$;

-- How many four-digit numbers each staff member wrote, and when (never the
-- numbers themselves). Rows older than a day are dropped as new ones come.
create table private.case_number_checks (
  id bigint generated always as identity primary key,
  actor_id uuid not null references auth.users (id),
  at timestamptz not null default now(),
  numbers integer not null check (numbers between 1 and 5)
);

create index case_number_checks_actor_idx on private.case_number_checks (actor_id, at);
alter table private.case_number_checks enable row level security;
revoke all on private.case_number_checks from public, anon, authenticated;

-- The delivery codes a text about a case may not hold: the code of the
-- case's own order, and those of the customer's orders still to be
-- delivered (a delivered order's code is spent).
create or replace function private.case_live_codes(p_order_id uuid, p_user_id uuid) returns text[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct c.code), '{}')
  from private.delivery_codes c
  join public.orders o on o.id = c.order_id
  where o.id = p_order_id
     or (o.user_id = p_user_id and o.status not in ('delivered', 'completed', 'cancelled', 'refunded'));
$$;

-- What staff read of a customer's own words (a complaint, a return's reason,
-- a report's details): the customer may type their own live delivery code,
-- and staff must never read it, so each such number is shown as '••••'. The
-- customer still reads their words as they wrote them (my_cases and the
-- order's page read the rows themselves). A text that holds no live code
-- comes back exactly as written; one that does comes back in plain digits
-- (case_text_plain) with the code masked wherever it stands: its digits
-- split by up to eight characters that are neither a letter nor a digit, and
-- at the start or the end of a longer run of digits ('88881636', '16368888',
-- a phone written with or without its dash) (decision 61).
create or replace function private.mask_shopper_codes(p_text text, p_order_id uuid, p_user_id uuid)
returns text
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_plain text;
  v text;
  v_code text;
  v_shape text;
begin
  if p_text is null then
    return null;
  end if;
  v_plain := private.case_text_plain(p_text);
  v := v_plain;
  -- Its digits alone, or split by up to eight characters that are neither a
  -- letter nor a digit (spaces, dots, dashes, slashes, underscores, brackets,
  -- line breaks: more than the guard reads, as masking too much costs staff
  -- nothing), and also where it begins or ends a longer run of digits (a
  -- phone or an amount, with or without separators).
  foreach v_code in array private.case_live_codes(p_order_id, p_user_id) loop
    v_shape := substr(v_code, 1, 1) || '[^[:alnum:]]{0,8}' || substr(v_code, 2, 1) || '[^[:alnum:]]{0,8}'
      || substr(v_code, 3, 1) || '[^[:alnum:]]{0,8}' || substr(v_code, 4, 1);
    v := regexp_replace(v, '(?<![0-9])' || v_shape || '|' || v_shape || '(?![0-9])', '••••', 'g');
  end loop;
  return case when v = v_plain then p_text else v end;
end;
$$;

-- Whether a text holds one of the delivery codes a text about the case may
-- not hold (the match alone: it writes nothing and raises nothing).
create or replace function private.case_text_has_code(p_order_id uuid, p_user_id uuid, p_text text)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_numbers text[] := private.case_text_numbers(p_text);
begin
  return cardinality(v_numbers) > 0 and v_numbers && private.case_live_codes(p_order_id, p_user_id);
end;
$$;

-- Checks a text staff want to write on a case (or as a new contact's
-- summary) against the customer's delivery codes. Raises when the writer is
-- locked out (too_many_refusals) or the text holds too many four-digit
-- numbers (too_many_numbers). When it holds a code, it writes the refusal on
-- the audit trail and answers false, without raising, so the row stays; the
-- caller then answers null. p_row_key names the case (or the order for a new
-- contact) on the trail.
create or replace function private.case_text_allowed(
  p_order_id uuid, p_user_id uuid, p_text text, p_function text, p_row_key text
) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_numbers text[];
begin
  -- One writer's texts are checked one after another: without it, parallel
  -- calls each read the counts before any of them wrote, and together pass
  -- the lock-out and the hourly allowance.
  if (select auth.uid()) is not null then
    perform pg_advisory_xact_lock(hashtextextended('yuntera.case_text:' || (select auth.uid())::text, 0));
  end if;
  if (select count(*) from private.audit_log a
      where a.actor_id = (select auth.uid()) and a.action = 'REFUSED_CODE'
        and a.at > now() - interval '1 hour') >= private.case_text_max_refusals() then
    perform private.fail('too_many_refusals');
  end if;
  v_numbers := private.case_text_numbers(p_text);
  if cardinality(v_numbers) > 5 then
    perform private.fail('too_many_numbers');
  end if;
  -- Every four-digit number a writer puts in a text counts against an hourly
  -- allowance, written or refused, from all the entry points together (the
  -- case functions and, through the triggers, Atención). Without it the
  -- lock-out bounds only the refusals, and a writer could test five guesses
  -- in each of any number of accepted texts (decision 61).
  if cardinality(v_numbers) > 0 and (select auth.uid()) is not null then
    if coalesce((select sum(k.numbers) from private.case_number_checks k
                 where k.actor_id = (select auth.uid()) and k.at > now() - interval '1 hour'), 0)
       + cardinality(v_numbers) > private.case_text_max_numbers() then
      perform private.fail('too_many_numbers_hour');
    end if;
    delete from private.case_number_checks k
    where k.actor_id = (select auth.uid()) and k.at < now() - interval '1 day';
    insert into private.case_number_checks (actor_id, numbers)
    values ((select auth.uid()), cardinality(v_numbers));
  end if;
  if not private.case_text_has_code(p_order_id, p_user_id, p_text) then
    return true;
  end if;
  insert into private.audit_log (actor_id, action, table_name, row_key, old_row, new_row)
  values ((select auth.uid()), 'REFUSED_CODE', 'cases', p_row_key, null,
          jsonb_build_object('function', p_function));
  return false;
end;
$$;

-- The same check for texts that reach a case through Atención (a complaint's
-- answer, the note on a return decision): those functions run the trigger
-- inside their own step, so a refusal there raises note_contains_code.
create or replace function private.guard_case_text(c private.cases, p_text text, p_function text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.case_text_allowed(c.order_id, c.user_id, p_text, p_function, c.id::text) then
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
    -- ops_resolve_complaint checks its text itself, after everything else, so
    -- that a refusal is kept (section 10); any other writer is checked here.
    if current_setting('yuntera.case_text_checked', true) is distinct from new.id::text then
      perform private.guard_case_text(c, new.resolution, 'ops_resolve_complaint');
    end if;
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
    -- The doors of Atención check their note themselves (section 10).
    if current_setting('yuntera.case_text_checked', true) is distinct from new.id::text then
      perform private.guard_case_text(c, new.resolution_note, 'return_decision');
    end if;
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
      select jsonb_build_object('text', private.mask_shopper_codes(x.description, c.order_id, c.user_id),
               'category', x.category, 'status', x.status)
      from public.complaints x where x.id = c.complaint_id)
    when 'return' then (
      select jsonb_build_object('text', private.mask_shopper_codes(x.reason, c.order_id, c.user_id),
               'return_kind', x.kind, 'status', x.status,
               'quantity', x.quantity, 'title', i.title, 'refund_due_on', x.refund_due_on)
      from public.return_requests x join public.order_items i on i.id = x.order_item_id
      where x.id = c.return_id)
    when 'report' then (
      select jsonb_build_object('text', private.mask_shopper_codes(x.details, c.order_id, c.user_id),
               'reason', x.reason, 'status', x.status,
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
               'id', e.id, 'kind', e.kind,
               -- A staff text (it has an author) passed the guard when it
               -- was written and is shown as written: masking it would tell
               -- its writer which of their numbers is a live code (section
               -- 3). Only entries without an author, the answers kept from
               -- before this migration (cases_backfill), are masked.
               'body', case when e.author_id is null
                            then private.mask_shopper_codes(e.body, c.order_id, c.user_id)
                            else e.body end,
               'created_at', e.created_at,
               'author', private.first_name_of(e.author_id)) order by e.id)
      from private.case_entries e where e.case_id = c.id), '[]'::jsonb),
    'can', jsonb_build_object(
      'note', v_role in ('admin', 'support', 'ops', 'finance') and not private.case_account_deleted(c),
      'answer', v_role in ('admin', 'support') and c.status = 'open' and not private.case_account_deleted(c),
      'close', v_role in ('admin', 'support') and c.status = 'open' and not private.case_source_open(c)
               and not private.case_account_deleted(c),
      'assign', v_role in ('admin', 'support') and c.status = 'open'
                and c.assignee_id is distinct from (select auth.uid()),
      'reopen', v_role in ('admin', 'support') and c.status = 'closed' and not private.case_account_deleted(c),
      'customer', c.user_id is not null and v_role in ('admin', 'support', 'ops', 'finance')
                  and private.is_customer(c.user_id))
  );
end;
$$;

-- Whether a case's source row (a return request or a content report) is
-- still waiting for its decision in Atención.
create or replace function private.case_source_open(c private.cases) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case c.kind
    when 'return' then exists (select 1 from public.return_requests r
                               where r.id = c.return_id and r.status not in ('rejected', 'refunded'))
    when 'report' then exists (select 1 from public.content_reports r
                               where r.id = c.report_id and r.status in ('open', 'in_review'))
    else false
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

-- Whether the account a case belongs to was deleted.
create or replace function private.case_account_deleted(c private.cases) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from auth.users u where u.id = c.user_id and u.deleted_at is not null);
$$;

-- An internal note: staff only, never shown to the customer. Answers the
-- new entry's id, or null when the text holds the delivery code (section 3).
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
  -- The text of a deleted account's cases went with it (section 8); nothing
  -- new is written there. The case row is locked, so a deletion that started
  -- meanwhile waits and then erases this note too.
  if private.case_account_deleted(c) then
    perform private.fail('case_account_deleted');
  end if;
  if char_length(v_body) not between 1 and 2000 then
    perform private.fail('invalid_note');
  end if;
  if not private.case_text_allowed(c.order_id, c.user_id, v_body, 'ops_add_case_note', c.id::text) then
    return null;
  end if;
  insert into private.case_entries (case_id, kind, author_id, body)
  values (c.id, 'note', (select auth.uid()), v_body)
  returning id into v_id;
  return v_id;
end;
$$;

-- The answer the customer reads, in their account and on the order's page,
-- and a message that says there is one (through the notification planner).
-- Answers the case as a list row, or null when the text holds the delivery
-- code (section 3). A return or a report is decided in Atención, so its case
-- cannot be closed here while that is still open (case_source_open): the
-- case closes by itself when Atención decides.
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
  -- The customer's account row first, as delete_my_account takes it before
  -- the rows of their complaints and cases: the answer plans a message to
  -- them (a row that points at that account), so the two wait for each other
  -- in one order, never in a circle. Then a complaint's row before its case,
  -- in the order ops_resolve_complaint (and the trigger behind it) takes them.
  perform 1 from auth.users u
  where u.id = (select k.user_id from private.cases k where k.id = p_case_id)
  for key share;
  perform 1 from public.complaints x
  where x.id = (select k.complaint_id from private.cases k where k.id = p_case_id)
  for update;
  c := private.case_for_work(p_case_id, v_role);
  if c.status = 'closed' then
    perform private.fail('case_closed');
  end if;
  if private.case_account_deleted(c) then
    perform private.fail('case_account_deleted');
  end if;
  if char_length(v_body) not between 10 and 4000 then
    perform private.fail('reason_required');
  end if;
  if v_close and private.case_source_open(c) then
    perform private.fail('case_source_open');
  end if;
  if not private.case_text_allowed(c.order_id, c.user_id, v_body, 'ops_answer_case', c.id::text) then
    return null;
  end if;

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
  -- The customer's account row first, then the complaint, then the case, in
  -- the order ops_answer_case takes them. A deletion under way holds the
  -- account row, so the reopening waits for it and then refuses
  -- (case_account_deleted below); a reopening under way makes the deletion
  -- wait and then refuse for the open complaint. Without it a closed case
  -- could be reopened while its account was being deleted and stay open,
  -- with nobody left to answer or close it (the second review of the join).
  perform 1 from auth.users u
  where u.id = (select k.user_id from private.cases k where k.id = p_case_id)
  for key share;
  perform 1 from public.complaints x
  where x.id = (select k.complaint_id from private.cases k where k.id = p_case_id)
  for update;
  c := private.case_for_work(p_case_id, v_role);
  if c.status = 'open' then
    perform private.fail('case_open');
  end if;
  if private.case_account_deleted(c) then
    perform private.fail('case_account_deleted');
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
-- as a case against an order (by its number) or a customer's account, with
-- a summary. Answers the new case's id, or null when the summary holds the
-- delivery code (section 3).
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
    -- The customer's account row, as ops_answer_case takes it: a deletion
    -- under way (it holds that row) is waited for, so its outcome is read
    -- below and no contact is left behind it unerased and open.
    perform 1 from auth.users u where u.id = v_user for key share;
    if exists (select 1 from auth.users u where u.id = v_user and u.deleted_at is not null) then
      perform private.fail('case_account_deleted');
    end if;
  else
    -- A customer: someone who ordered, complained or asked for a return, and
    -- not a staff member. A seller or a driver account is not one.
    perform 1 from auth.users u where u.id = p_user_id for key share;
    select u.id into v_user from auth.users u
    where u.id = p_user_id and u.deleted_at is null and private.is_customer(u.id)
      and not exists (select 1 from public.staff_members s where s.user_id = u.id);
    if v_user is null then
      perform private.fail('customer_not_found');
    end if;
  end if;
  if not private.case_text_allowed(v_order, v_user, v_summary, 'ops_record_contact',
                                   coalesce(v_order, v_user)::text) then
    return null;
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
  if p_user_id is null or not exists (select 1 from auth.users u where u.id = p_user_id)
     or not private.is_customer(p_user_id) then
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
      join private.cases k on k.return_id = r.id
      where r.user_id = p_user_id and private.case_visible(v_role, k.area, k.order_id)), '[]'::jsonb),
    'complaints', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'category', c.category, 'status', c.status,
               'order_number', o.order_number, 'created_at', c.created_at) order by c.created_at desc)
      from public.complaints c left join public.orders o on o.id = c.order_id
      join private.cases k on k.complaint_id = c.id
      where c.user_id = p_user_id and private.case_visible(v_role, k.area, k.order_id)), '[]'::jsonb),
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
  where u.id = p_user_id and private.is_customer(u.id);
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
-- An open recorded contact closes; no note, answer or reopening is accepted
-- on a deleted account's case afterwards (case_account_deleted).

create or replace function private.erase_case_text() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.deleted_at is null or old.deleted_at is not null then
    return null;
  end if;
  -- The person's cases first, in one order: a note or an answer being
  -- written now holds its case, so this waits for it and erases it too, and
  -- none is written after (they refuse a deleted account's case).
  perform 1 from private.cases c where c.user_id = new.id order by c.id for update;
  perform set_config('yuntera.erasing_cases', 'on', true);
  -- Notes and answers (a status entry holds only a status name).
  update private.case_entries e set body = private.erased_case_text()
  from private.cases c
  where c.id = e.case_id and c.user_id = new.id and e.kind in ('note', 'answer') and e.body is not null
    and e.body <> private.erased_case_text();
  perform set_config('yuntera.erasing_cases', '', true);
  update private.cases c set summary = private.erased_case_text()
  where c.user_id = new.id and c.summary is not null;
  -- A recorded contact still open has nobody left to answer: it closes.
  -- (Complaints and returns cannot be open here: delete_my_account refuses
  -- then. A report's case stays open until Atención decides the report.)
  insert into private.case_entries (case_id, kind)
  select c.id, 'closed' from private.cases c
  where c.user_id = new.id and c.kind = 'contact' and c.status = 'open';
  update private.cases c set status = 'closed', resolved_at = now()
  where c.user_id = new.id and c.kind = 'contact' and c.status = 'open';
  return null;
end;
$$;

create trigger auth_users_erase_case_text after update of deleted_at on auth.users
  for each row execute function private.erase_case_text();

-- ═══ 9. What Atención reads of a customer's own words ═════════════════════
-- public.ops_care_queues (083000) gave staff a complaint's description, a
-- return's reason and a report's details as the customer typed them, so a
-- customer's own live delivery code typed there reached staff. A faithful
-- copy of 083000's definition except those three values, which pass through
-- private.mask_shopper_codes (section 3), as public.ops_case's do; and
-- except what it lists: each role reads only the complaints, returns and
-- reports whose case it may open in Casos (section 4.1, through
-- private.care_visible), the totals count the same rows, and the customer is
-- named by first name, as in the customer view. Same arguments and columns:
-- owner, security definer, search path and grants stay as they were, and
-- the console of 12ec48c reads the same shape.

-- Whether the caller's role reads the case of a complaint, return or report
-- (section 4.1), so Atención lists what Casos lets that role open.
create or replace function private.care_visible(p_kind text, p_id uuid, p_role public.staff_role)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.cases k
    where case p_kind when 'complaint' then k.complaint_id = p_id
                      when 'return' then k.return_id = p_id
                      else k.report_id = p_id end
      and private.case_visible(p_role, k.area, k.order_id));
$$;

create or replace function public.ops_care_queues() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  c_page constant integer := 100;
  v_role public.staff_role := private.case_reader_role();
begin
  if not private.has_staff_role('support', 'ops', 'finance', 'catalog') then
    perform private.fail('forbidden');
  end if;
  return jsonb_build_object(
    'complaints', coalesce((
      select jsonb_agg(x.item order by x.created_at, x.id)
      from (
        select c.created_at, c.id, jsonb_build_object(
          'id', c.id, 'category', c.category, 'description', private.mask_shopper_codes(c.description, c.order_id, c.user_id), 'status', c.status,
          'created_at', c.created_at, 'order_number', o.order_number, 'customer', private.first_name_of(c.user_id)
        ) as item
        from public.complaints c
        left join public.orders o on o.id = c.order_id
        where c.status <> 'resolved' and private.care_visible('complaint', c.id, v_role)
        order by c.created_at, c.id
        limit c_page
      ) x), '[]'::jsonb),
    'returns', coalesce((
      select jsonb_agg(x.item order by x.refund_due_on nulls last, x.created_at, x.id)
      from (
        select r.refund_due_on, r.created_at, r.id, jsonb_build_object(
          'id', r.id, 'kind', r.kind, 'quantity', r.quantity, 'reason', private.mask_shopper_codes(r.reason, o.id, r.user_id),
          'status', r.status, 'refund_due_on', r.refund_due_on, 'created_at', r.created_at,
          'title', i.title, 'order_number', o.order_number, 'seller_name', s.trade_name,
          'customer', private.first_name_of(r.user_id), 'amount_minor', i.unit_price_minor * r.quantity
        ) as item
        from public.return_requests r
        join public.order_items i on i.id = r.order_item_id
        join public.orders o on o.id = i.order_id
        left join public.sellers s on s.id = i.seller_id
        where r.status in ('requested', 'approved', 'received') and private.care_visible('return', r.id, v_role)
        order by r.refund_due_on nulls last, r.created_at, r.id
        limit c_page
      ) x), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(x.item order by x.created_at, x.id)
      from (
        select cr.created_at, cr.id, jsonb_build_object(
          'id', cr.id, 'target_type', cr.target_type, 'target_id', cr.target_id,
          'reason', cr.reason, 'details', private.mask_shopper_codes(cr.details, null, cr.reporter_id), 'status', cr.status,
          'created_at', cr.created_at,
          'target_label', case cr.target_type
            when 'product' then (select p.title from public.products p where p.id = cr.target_id)
            when 'seller' then (select s.trade_name from public.sellers s where s.id = cr.target_id)
            when 'review' then (select left(rv.body, 120) from public.reviews rv where rv.id = cr.target_id)
          end
        ) as item
        from public.content_reports cr
        where cr.status in ('open', 'in_review') and private.care_visible('report', cr.id, v_role)
        order by cr.created_at, cr.id
        limit c_page
      ) x), '[]'::jsonb),
    'totals', jsonb_build_object(
      'complaints', (select count(*) from public.complaints c
                     where c.status <> 'resolved' and private.care_visible('complaint', c.id, v_role)),
      'returns', (select count(*) from public.return_requests r
                  where r.status in ('requested', 'approved', 'received')
                    and private.care_visible('return', r.id, v_role)),
      'reports', (select count(*) from public.content_reports cr
                  where cr.status in ('open', 'in_review') and private.care_visible('report', cr.id, v_role)))
  );
end;
$$;

-- ═══ 10. Atención's doors keep a refusal ═══════════════════════════════════
-- A staff text reaches a case through Atención too: a complaint's answer
-- (ops_resolve_complaint, 081700) and the note of a return decision, a
-- received return or a refund (ops_decide_return, ops_receive_return,
-- ops_complete_return, 082900). Until now the triggers of section 3 checked
-- those texts and raised note_contains_code, and a raise rolls back the
-- whole call: the refusal never reached the audit trail, the numbers never
-- counted against the hourly allowance, and a call that failed for another
-- reason after the check (a text too long for the timeline) told the writer
-- the answer for free. Staff could test every code without a trace.
--
-- Each of the four is now a faithful copy of its definition in force except
-- these lines: it refuses a text longer than the timeline holds (4000
-- characters) before anything else (text_too_long); it does its own work
-- inside a block, checks the text only when that work has succeeded (so no
-- later step can fail and tell the answer), and on a code undoes its work
-- and keeps only the refusal; it then counts the text's numbers and, on a
-- code, writes the refusal (case_text_allowed), so the lock-out of three
-- refusals an hour and the allowance of twenty numbers an hour hold here as
-- in Casos. It answers null when the text was refused (nothing else
-- changed) and otherwise what it answered before, or true where it answered
-- nothing (so it is dropped and created again, with the same grants). The
-- triggers skip their own check for the row the door checks.

drop function public.ops_resolve_complaint(uuid, text, boolean);
create or replace function public.ops_resolve_complaint(
  p_complaint_id uuid,
  p_resolution text,
  p_close boolean default true
) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  c private.cases;
  v_text text := trim(p_resolution);
  v_refused boolean := false;
begin
  if not private.has_staff_role('support', 'ops') then
    perform private.fail('forbidden');
  end if;
  -- The answer is sent to the person who complained, so it cannot be empty.
  if coalesce(char_length(trim(p_resolution)), 0) < 10 then
    perform private.fail('reason_required');
  end if;
  if char_length(v_text) > 4000 then
    perform private.fail('text_too_long');
  end if;
  select * into c from private.cases where complaint_id = p_complaint_id;

  begin
    perform set_config('yuntera.case_text_checked', p_complaint_id::text, true);
  update public.complaints
  set status = case when p_close then 'resolved' else 'in_progress' end,
      resolution = trim(p_resolution),
      resolved_at = case when p_close then now() end
  where id = p_complaint_id and status <> 'resolved';
  if not found then
    perform private.fail('complaint_not_found');
  end if;

  perform private.emit('complaint.answered',
    jsonb_build_object('complaint_id', p_complaint_id, 'closed', p_close));
    perform set_config('yuntera.case_text_checked', '', true);
    if c.id is not null and private.case_text_has_code(c.order_id, c.user_id, v_text) then
      raise exception using errcode = 'YT409';  -- caught just below, never seen
    end if;
  exception when sqlstate 'YT409' then
    v_refused := true;
  end;
  if c.id is not null
     and not private.case_text_allowed(c.order_id, c.user_id, v_text, 'ops_resolve_complaint', c.id::text) then
    v_refused := true;
  end if;
  return case when v_refused then null else true end;
end;
$$;

drop function public.ops_decide_return(uuid, boolean, text);
create or replace function public.ops_decide_return(
  p_return_id uuid,
  p_approve boolean,
  p_note text default null
) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_status text;
  c private.cases;
  v_text text := nullif(trim(p_note), '');
  v_refused boolean := false;
begin
  if not private.has_staff_role('support', 'ops') then
    perform private.fail('forbidden');
  end if;
  if char_length(v_text) > 4000 then
    perform private.fail('text_too_long');
  end if;
  select * into c from private.cases where return_id = p_return_id;

  begin
    perform set_config('yuntera.case_text_checked', p_return_id::text, true);
  select o.* into v_order
  from public.return_requests r
  join public.order_items i on i.id = r.order_item_id
  join public.orders o on o.id = i.order_id
  where r.id = p_return_id;
  if not found then
    perform private.fail('return_not_found');
  end if;
  perform 1 from public.orders where id = v_order.id for update;
  select status into v_status from public.return_requests where id = p_return_id for update;
  if not (v_status = 'requested' or (v_status = 'approved' and not p_approve)) then
    perform private.fail('invalid_return_state', v_status);
  end if;
  -- A refusal has to be explained: the shopper is told why.
  if not p_approve and coalesce(char_length(trim(p_note)), 0) < 10 then
    perform private.fail('reason_required');
  end if;
  if p_approve and not private.order_returnable(v_order) then
    perform private.fail('order_not_returnable', v_order.status::text);
  end if;

  update public.return_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      refund_due_on = case when p_approve then private.cr_local(now())::date + 8 end,
      resolution_note = nullif(trim(p_note), ''),
      decided_by = (select auth.uid()),
      resolved_at = case when p_approve then null else now() end
  where id = p_return_id;

  perform private.emit('return.decided',
    jsonb_build_object('return_request_id', p_return_id, 'approved', p_approve));
    perform set_config('yuntera.case_text_checked', '', true);
    if c.id is not null and v_text is not null and private.case_text_has_code(c.order_id, c.user_id, v_text) then
      raise exception using errcode = 'YT409';  -- caught just below, never seen
    end if;
  exception when sqlstate 'YT409' then
    v_refused := true;
  end;
  if c.id is not null and v_text is not null
     and not private.case_text_allowed(c.order_id, c.user_id, v_text, 'return_decision', c.id::text) then
    v_refused := true;
  end if;
  return case when v_refused then null else true end;
end;
$$;

drop function public.ops_receive_return(uuid, boolean, text);
create or replace function public.ops_receive_return(
  p_return_id uuid,
  p_resellable boolean default true,
  p_note text default null
) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_return public.return_requests%rowtype;
  v_item public.order_items%rowtype;
  v_warehouse uuid;
  v_location uuid;
  v_restock boolean := false;
  c private.cases;
  v_text text := nullif(trim(p_note), '');
  v_refused boolean := false;
begin
  if not private.has_staff_role('support', 'ops') then
    perform private.fail('forbidden');
  end if;
  if char_length(v_text) > 4000 then
    perform private.fail('text_too_long');
  end if;
  select * into c from private.cases where return_id = p_return_id;

  begin
    perform set_config('yuntera.case_text_checked', p_return_id::text, true);
  select i.order_id into v_order_id
  from public.return_requests r join public.order_items i on i.id = r.order_item_id
  where r.id = p_return_id;
  if not found then
    perform private.fail('return_not_found');
  end if;
  perform 1 from public.orders where id = v_order_id for update;
  select * into v_return from public.return_requests where id = p_return_id for update;
  if v_return.status <> 'approved' then
    perform private.fail('invalid_return_state', v_return.status);
  end if;
  if not private.order_returnable((select o from public.orders o where o.id = v_order_id)) then
    perform private.fail('order_not_returnable');
  end if;
  select * into v_item from public.order_items where id = v_return.order_item_id;

  if coalesce(p_resellable, true) and v_item.fulfillment = 'platform' then
    select s.origin_warehouse_id into v_warehouse
    from public.shipments s
    join public.shipment_items si on si.shipment_id = s.id
    join public.warehouses w on w.id = s.origin_warehouse_id
    where si.order_item_id = v_item.id and s.status = 'delivered' and w.kind = 'platform'
    order by si.quantity desc, s.id
    limit 1;
    if v_warehouse is not null then
      select wl.id into v_location from public.warehouse_locations wl
      where wl.warehouse_id = v_warehouse and wl.kind = 'returns' and wl.active
      order by wl.code limit 1;
      perform private.apply_stock_change(
        v_warehouse, v_item.sku_id, v_item.seller_id, v_return.quantity, 'return',
        v_location, 'return_request', p_return_id, 'Devolución recibida');
      v_restock := true;
    end if;
  end if;

  update public.return_requests
  set status = 'received', received_at = now(), received_by = (select auth.uid()),
      restocked = v_restock,
      resolution_note = coalesce(nullif(trim(p_note), ''), resolution_note)
  where id = p_return_id;

  insert into public.order_events (order_id, kind, note, actor_id)
  values (v_order_id, 'note',
          'Recibimos ' || v_return.quantity || ' × ' || v_item.title || ' de vuelta',
          (select auth.uid()));
  perform private.emit('return.received', jsonb_build_object(
    'return_request_id', p_return_id, 'restocked', v_restock));
    perform set_config('yuntera.case_text_checked', '', true);
    if c.id is not null and v_text is not null and private.case_text_has_code(c.order_id, c.user_id, v_text) then
      raise exception using errcode = 'YT409';  -- caught just below, never seen
    end if;
  exception when sqlstate 'YT409' then
    v_refused := true;
  end;
  if c.id is not null and v_text is not null
     and not private.case_text_allowed(c.order_id, c.user_id, v_text, 'return_decision', c.id::text) then
    v_refused := true;
  end if;
  return case when v_refused then null else true end;
end;
$$;

create or replace function public.ops_complete_return(
  p_return_id uuid,
  p_note text default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_return public.return_requests%rowtype;
  v_item public.order_items%rowtype;
  v_result jsonb;
  c private.cases;
  v_text text := nullif(trim(p_note), '');
  v_refused boolean := false;
  v_answer jsonb;
begin
  if not private.has_staff_role('finance', 'support') then
    perform private.fail('forbidden');
  end if;
  if char_length(v_text) > 4000 then
    perform private.fail('text_too_long');
  end if;
  select * into c from private.cases where return_id = p_return_id;

  begin
    perform set_config('yuntera.case_text_checked', p_return_id::text, true);
  select i.order_id into v_order_id
  from public.return_requests r join public.order_items i on i.id = r.order_item_id
  where r.id = p_return_id;
  if not found then
    perform private.fail('return_not_found');
  end if;
  perform 1 from public.orders where id = v_order_id for update;
  select * into v_return from public.return_requests where id = p_return_id for update;
  if v_return.status = 'approved' then
    -- The money goes back once the goods are back.
    perform private.fail('return_not_received');
  end if;
  if v_return.status <> 'received' then
    perform private.fail('invalid_return_state', v_return.status);
  end if;
  select * into v_item from public.order_items where id = v_return.order_item_id;

  v_result := private.refund_units(v_order_id, 'return', p_return_id,
    jsonb_build_array(jsonb_build_object('order_item_id', v_item.id, 'quantity', v_return.quantity)));

  update public.return_requests
  set status = 'refunded', refund_minor = (v_result ->> 'refund_minor')::bigint,
      refunded_by = (select auth.uid()),
      resolution_note = coalesce(nullif(trim(p_note), ''), resolution_note), resolved_at = now()
  where id = p_return_id;

  insert into public.order_events (order_id, kind, to_status, note, actor_id)
  values (v_order_id, 'note', null,
          'Reembolso de ' || v_return.quantity || ' × ' || v_item.title, (select auth.uid()));

  v_answer := jsonb_build_object('refund_minor', (v_result ->> 'refund_minor')::bigint,
                            'seller_debit_minor', (v_result ->> 'seller_debit_minor')::bigint);
    perform set_config('yuntera.case_text_checked', '', true);
    if c.id is not null and v_text is not null and private.case_text_has_code(c.order_id, c.user_id, v_text) then
      raise exception using errcode = 'YT409';  -- caught just below, never seen
    end if;
  exception when sqlstate 'YT409' then
    v_refused := true;
  end;
  if c.id is not null and v_text is not null
     and not private.case_text_allowed(c.order_id, c.user_id, v_text, 'return_decision', c.id::text) then
    v_refused := true;
  end if;
  return case when v_refused then null else v_answer end;
end;
$$;

revoke all on function public.ops_resolve_complaint(uuid, text, boolean) from public, anon;
revoke all on function public.ops_decide_return(uuid, boolean, text) from public, anon;
revoke all on function public.ops_receive_return(uuid, boolean, text) from public, anon;
grant execute on function public.ops_resolve_complaint(uuid, text, boolean) to authenticated;
grant execute on function public.ops_decide_return(uuid, boolean, text) to authenticated;
grant execute on function public.ops_receive_return(uuid, boolean, text) to authenticated;

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
revoke all on function private.foreign_digits() from public, anon, authenticated;
revoke all on function private.case_text_numbers(text) from public, anon, authenticated;
revoke all on function private.case_text_max_refusals() from public, anon, authenticated;
revoke all on function private.case_text_max_numbers() from public, anon, authenticated;
revoke all on function private.case_text_plain(text) from public, anon, authenticated;
revoke all on function private.case_live_codes(uuid, uuid) from public, anon, authenticated;
revoke all on function private.mask_shopper_codes(text, uuid, uuid) from public, anon, authenticated;
revoke all on function private.case_text_allowed(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function private.case_text_has_code(uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.care_visible(text, uuid, public.staff_role) from public, anon, authenticated;
revoke all on function private.guard_case_text(private.cases, text, text) from public, anon, authenticated;
revoke all on function private.is_customer(uuid) from public, anon, authenticated;
revoke all on function private.case_source_open(private.cases) from public, anon, authenticated;
revoke all on function private.case_follow_complaint() from public, anon, authenticated;
revoke all on function private.case_follow_return() from public, anon, authenticated;
revoke all on function private.case_follow_report() from public, anon, authenticated;
revoke all on function private.case_next_due(private.cases) from public, anon, authenticated;
revoke all on function private.case_clock(private.cases) from public, anon, authenticated;
revoke all on function private.case_row(private.cases) from public, anon, authenticated;
revoke all on function private.case_for_work(uuid, public.staff_role) from public, anon, authenticated;
revoke all on function private.case_account_deleted(private.cases) from public, anon, authenticated;
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
