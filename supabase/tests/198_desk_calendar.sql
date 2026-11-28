-- The support desk's own working calendar (owner decision D56, 27 November
-- 2026; 20261121084700_support_cases.sql, private.desk_week, desk_hours,
-- desk_add_days and case_due).
--
--   the week:     Monday to Friday 08:00 to 17:00 and Saturday 08:00 to 12:00,
--                 Costa Rica time; Sunday and every public holiday closed, a
--                 holiday on a Saturday included;
--   due times:    a table of instants with the due time of each unit the
--                 targets use, at the edges (exactly 08:00, exactly 17:00,
--                 Saturday exactly 12:00, a Sunday, a holiday on a Saturday,
--                 a holiday on a Monday after a Saturday, the end of the year);
--   the law:      private.add_business_days, which counts the withdrawal and
--                 warranty periods, still skips Saturday;
--   wrong caller: no API role may call the calendar's functions;
--   left behind:  nothing (the test holidays go with the rollback).
--
-- Every instant below is written in Costa Rica time (UTC−6 all year) and
-- turned into an instant with private.cr_instant, so the table reads as the
-- desk reads its clock.

begin;

-- Two holidays of the test's own: Saturday 14 May 2033 and Monday 23 May
-- 2033 (the Monday after a Saturday). Friday 1 January 2027 is a holiday of
-- the operations calendar already (20261121080300_geography_data.sql).
insert into public.holidays (day, name) values
  ('2033-05-14', 'Feriado de prueba 198 en sábado'),
  ('2033-05-23', 'Feriado de prueba 198 en lunes')
on conflict (day) do nothing;

do $$
begin
  assert exists (select 1 from public.holidays where day = '2027-01-01'), 'New Year 2027 is a holiday';
  -- The week, as packages/core/src/service-times.ts (SERVICE_HOURS) says it.
  assert (select string_agg(format('%s %s-%s', dow, opens, closes), ', ' order by dow)
          from private.desk_week())
         = '1 08:00:00-17:00:00, 2 08:00:00-17:00:00, 3 08:00:00-17:00:00, 4 08:00:00-17:00:00, '
           '5 08:00:00-17:00:00, 6 08:00:00-12:00:00',
    'the desk works Monday to Friday 08:00-17:00 and Saturday 08:00-12:00';
  -- One day at a time.
  assert (select (opens, closes) from private.desk_hours('2033-05-06')) = (time '08:00', time '17:00'),
    'a Friday: 08:00 to 17:00';
  assert (select (opens, closes) from private.desk_hours('2033-05-07')) = (time '08:00', time '12:00'),
    'a Saturday: 08:00 to 12:00';
  assert not exists (select 1 from private.desk_hours('2033-05-08')), 'a Sunday is closed';
  assert not exists (select 1 from private.desk_hours('2033-05-14')), 'a holiday on a Saturday is closed';
  assert not exists (select 1 from private.desk_hours('2033-05-23')), 'a holiday on a Monday is closed';
  assert not exists (select 1 from private.desk_hours('2027-01-01')), 'New Year is closed';
  -- Counting days: Saturday counts for the desk, not for the law.
  assert private.desk_add_days('2033-05-06', 1) = '2033-05-07', 'the desk: Friday + 1 is Saturday';
  assert private.desk_add_days('2033-05-07', 1) = '2033-05-09', 'the desk: Saturday + 1 is Monday';
  assert private.desk_add_days('2033-05-13', 1) = '2033-05-16', 'the desk: over a Saturday holiday';
  assert private.desk_add_days('2033-05-21', 1) = '2033-05-24', 'the desk: over a Monday holiday';
  assert private.add_business_days('2033-05-06', 1) = '2033-05-09',
    'the operations calendar (withdrawal, warranty) still skips Saturday';
  assert private.add_business_days('2033-05-06', 8) = '2033-05-18',
    'eight business days of the law from a Friday';
end $$;

-- ── Due times ──────────────────────────────────────────────────────────────
-- (filed at, amount, unit, due at, what the row checks); all Costa Rica time.

create temporary table due_cases (
  filed timestamp, amount integer, unit text, due timestamp, what text
) on commit drop;

insert into due_cases values
  -- working_hours: inside the day's hours; what is left at closing carries
  -- to the opening of the next working day.
  ('2033-05-06 08:00', 2, 'working_hours', '2033-05-06 10:00', 'Friday, exactly 08:00'),
  ('2033-05-06 07:30', 2, 'working_hours', '2033-05-06 10:00', 'Friday before opening: from 08:00'),
  ('2033-05-06 15:00', 2, 'working_hours', '2033-05-06 17:00', 'Friday afternoon, due at closing'),
  ('2033-05-06 16:00', 2, 'working_hours', '2033-05-07 09:00', 'Friday afternoon: one hour carries to Saturday'),
  ('2033-05-06 17:00', 2, 'working_hours', '2033-05-07 10:00', 'Friday, exactly 17:00: from Saturday 08:00'),
  ('2033-05-06 22:00', 2, 'working_hours', '2033-05-07 10:00', 'Friday night: from Saturday 08:00'),
  ('2033-05-06 15:00', 10, 'working_hours', '2033-05-09 12:00', 'ten hours: Friday 2, Saturday 4, Monday 4'),
  ('2033-05-07 08:00', 2, 'working_hours', '2033-05-07 10:00', 'Saturday, exactly 08:00'),
  ('2033-05-07 09:00', 2, 'working_hours', '2033-05-07 11:00', 'Saturday morning'),
  ('2033-05-07 10:00', 2, 'working_hours', '2033-05-07 12:00', 'Saturday morning, due at the Saturday closing'),
  ('2033-05-07 11:00', 2, 'working_hours', '2033-05-09 09:00', 'Saturday 11:00: one hour carries to Monday'),
  ('2033-05-07 12:00', 2, 'working_hours', '2033-05-09 10:00', 'Saturday, exactly 12:00: from Monday 08:00'),
  ('2033-05-07 15:00', 2, 'working_hours', '2033-05-09 10:00', 'Saturday afternoon: from Monday 08:00'),
  ('2033-05-08 10:00', 2, 'working_hours', '2033-05-09 10:00', 'Sunday: from Monday 08:00'),
  ('2033-05-13 16:00', 2, 'working_hours', '2033-05-16 09:00', 'Friday before a Saturday holiday'),
  ('2033-05-14 09:00', 2, 'working_hours', '2033-05-16 10:00', 'a Saturday holiday: from Monday'),
  ('2033-05-21 11:00', 2, 'working_hours', '2033-05-24 09:00', 'Saturday before a Monday holiday'),
  ('2033-05-22 10:00', 2, 'working_hours', '2033-05-24 10:00', 'Sunday before a Monday holiday'),
  ('2026-12-31 16:00', 2, 'working_hours', '2027-01-02 09:00', 'end of the year: New Year closed, Saturday open'),
  ('2026-12-31 17:00', 2, 'working_hours', '2027-01-02 10:00', 'end of the year, exactly 17:00'),
  -- working_days: to the end (midnight) of the nth working day after the day
  -- the case opens; Saturday is a working day of the desk.
  ('2033-05-06 16:00', 1, 'working_days', '2033-05-08 00:00', 'Friday afternoon: the end of Saturday'),
  ('2033-05-07 09:00', 1, 'working_days', '2033-05-10 00:00', 'Saturday morning: the end of Monday'),
  ('2033-05-07 15:00', 1, 'working_days', '2033-05-10 00:00', 'Saturday afternoon: the end of Monday'),
  ('2033-05-08 10:00', 1, 'working_days', '2033-05-10 00:00', 'Sunday: the end of Monday'),
  ('2033-05-13 16:00', 1, 'working_days', '2033-05-17 00:00', 'Friday before a Saturday holiday: Monday'),
  ('2033-05-21 10:00', 1, 'working_days', '2033-05-25 00:00', 'Saturday before a Monday holiday: Tuesday'),
  ('2026-12-31 10:00', 1, 'working_days', '2027-01-03 00:00', 'end of the year: Saturday 2 January'),
  ('2033-05-06 16:00', 2, 'working_days', '2033-05-10 00:00', 'two from a Friday: Saturday, Monday'),
  ('2033-05-06 16:00', 3, 'working_days', '2033-05-11 00:00', 'three from a Friday: to Tuesday'),
  ('2033-05-06 16:00', 5, 'working_days', '2033-05-13 00:00', 'five from a Friday afternoon: to Thursday'),
  ('2033-05-07 09:00', 5, 'working_days', '2033-05-14 00:00', 'five from a Saturday morning: to Friday'),
  ('2033-05-07 15:00', 5, 'working_days', '2033-05-14 00:00', 'five from a Saturday afternoon: to Friday'),
  ('2033-05-08 10:00', 5, 'working_days', '2033-05-14 00:00', 'five from a Sunday: to Friday'),
  ('2033-05-13 16:00', 5, 'working_days', '2033-05-21 00:00', 'five over a Saturday holiday: to Friday'),
  ('2026-12-31 10:00', 5, 'working_days', '2027-01-08 00:00', 'five at the end of the year: to Thursday 7'),
  -- calendar_days: the calendar, whatever the hours.
  ('2033-05-06 16:00', 8, 'calendar_days', '2033-05-15 00:00', 'eight calendar days from a Friday'),
  ('2033-05-07 09:00', 8, 'calendar_days', '2033-05-16 00:00', 'eight calendar days from a Saturday'),
  ('2033-05-08 10:00', 8, 'calendar_days', '2033-05-17 00:00', 'eight calendar days from a Sunday'),
  ('2026-12-31 10:00', 8, 'calendar_days', '2027-01-09 00:00', 'eight calendar days over New Year'),
  -- same_day: the end of the day the desk is first open (the walk of part 3
  -- found a contact recorded on Friday at 22:15 due that same evening).
  ('2033-05-06 16:00', 1, 'same_day', '2033-05-07 00:00', 'same day, Friday afternoon: that Friday'),
  ('2033-05-06 22:15', 1, 'same_day', '2033-05-08 00:00', 'same day, Friday night: the end of Saturday'),
  ('2033-05-09 07:00', 1, 'same_day', '2033-05-10 00:00', 'same day, Monday before opening: that Monday'),
  ('2033-05-07 15:00', 1, 'same_day', '2033-05-10 00:00', 'same day, Saturday afternoon: the end of Monday'),
  ('2033-05-08 10:00', 1, 'same_day', '2033-05-10 00:00', 'same day, Sunday: the end of Monday'),
  ('2026-12-31 23:30', 1, 'same_day', '2027-01-03 00:00', 'same day, the last evening of the year: Saturday 2 January'),
  -- minutes: clock minutes from the moment the desk is open.
  ('2033-05-07 11:50', 15, 'minutes', '2033-05-07 12:05', 'minutes past the Saturday closing'),
  ('2033-05-09 08:00', 15, 'minutes', '2033-05-09 08:15', 'minutes from exactly 08:00'),
  ('2033-05-09 07:50', 15, 'minutes', '2033-05-09 08:15', 'minutes before opening: from 08:00'),
  ('2033-05-06 17:00', 15, 'minutes', '2033-05-07 08:15', 'minutes from exactly 17:00: Saturday 08:15'),
  ('2033-05-08 10:00', 15, 'minutes', '2033-05-09 08:15', 'minutes on a Sunday: Monday 08:15'),
  ('2033-05-14 10:00', 15, 'minutes', '2033-05-16 08:15', 'minutes on a Saturday holiday: Monday 08:15');

do $$
declare
  r record;
  v_got timestamptz;
  n integer := 0;
begin
  for r in select * from due_cases loop
    v_got := private.case_due(private.cr_instant(r.filed), r.amount, r.unit);
    assert v_got = private.cr_instant(r.due),
      format('%s (%s %s from %s): due %s, got %s', r.what, r.amount, r.unit, r.filed, r.due,
             private.cr_local(v_got));
    n := n + 1;
  end loop;
  assert n = 51, format('the table has 51 rows, %s ran', n);
end $$;

-- ── Wrong caller ───────────────────────────────────────────────────────────

do $$
declare
  f text;
begin
  foreach f in array array['private.desk_week()', 'private.desk_hours(date)',
                           'private.desk_add_days(date, integer)', 'private.desk_next_open(timestamptz)',
                           'private.case_due(timestamptz, integer, text)'] loop
    assert not has_function_privilege('anon', f, 'execute'), format('anon cannot call %s', f);
    assert not has_function_privilege('authenticated', f, 'execute'),
      format('authenticated cannot call %s', f);
  end loop;
end $$;

select 'ok' as desk_calendar;
rollback;
