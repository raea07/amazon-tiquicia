-- Support cases (20261121084700_support_cases.sql).
--
--   targets:      the due times of every unit, on the desk's calendar
--                 (Saturday mornings worked, Sundays and public.holidays
--                 skipped; suite 198 has the full table), and who reads them;
--   triggers:     a complaint, a return request and a content report each
--                 open a case with the target's due times; answering or
--                 closing them from /atencion is written on the timeline;
--   backfill:     rows made without the triggers get a case, once;
--   right caller: support works every case; ops notes cases with an order;
--                 finance reads payment cases; catalog reads reports; the
--                 shopper reads the answers to their own cases;
--   wrong caller: each role is refused what table 4.1 does not give it, a
--                 case it does not read is "not found", a shopper reads no
--                 other shopper's case and never a note, a seller nothing;
--   code guard:   a note, an answer or a contact summary holding the real
--                 delivery code is refused, however it is disguised; order
--                 numbers, phone numbers, amounts and other numbers pass;
--                 every refusal is on the audit trail, three in an hour lock
--                 the writer out, and one text cannot test many guesses;
--   left behind:  entries are append-only, the tables are out of reach of
--                 the API roles, a contact reveal and saved-answer changes
--                 are on the audit trail, an answer plans one message that
--                 does not carry the answer, and a deleted account's case
--                 text is erased.

begin;
\ir _helpers.sql
\ir _money_helpers.sql

-- ── Fixtures ───────────────────────────────────────────────────────────────

select pg_temp.shopper('casos181a@yuntera.example', 'Ana Prueba Casos');
select pg_temp.shopper('casos181b@yuntera.example', 'Beto Otro Cliente');
select pg_temp.shopper('casos181c@yuntera.example', 'Carla Sin Pedidos');
select pg_temp.shopper('soporte181@yuntera.example', 'Sonia Soporte Uno');
select pg_temp.shopper('ops181@yuntera.example', 'Oscar Operaciones');
select pg_temp.shopper('finanzas181@yuntera.example', 'Fabiola Finanzas');
select pg_temp.shopper('catalogo181@yuntera.example', 'Camilo Catálogo');
insert into public.staff_members (user_id, role)
select u.id, x.role::public.staff_role
from (values ('soporte181@yuntera.example', 'support'), ('ops181@yuntera.example', 'ops'),
             ('finanzas181@yuntera.example', 'finance'), ('catalogo181@yuntera.example', 'catalog')) x (email, role)
join auth.users u on u.email = x.email;

select pg_temp.remember('order_a', pg_temp.place('casos181a@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'casos-181-a')::text);
select pg_temp.pay(current_setting('t.order_a')::uuid);
select pg_temp.remember('order_b', pg_temp.place('casos181b@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'casos-181-b')::text);
select pg_temp.pay(current_setting('t.order_b')::uuid);
-- Known codes, so the guard can be tested with numbers around them.
update private.delivery_codes set code = '4821' where order_id = current_setting('t.order_a')::uuid;
update private.delivery_codes set code = '1357' where order_id = current_setting('t.order_b')::uuid;
-- Delivered, so a withdrawal can be asked for (the code is kept after delivery).
select pg_temp.deliver(current_setting('t.order_a')::uuid);
-- A second order of the same customer, still to be delivered.
select pg_temp.remember('order_a2', pg_temp.place('casos181a@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'casos-181-a2')::text);
select pg_temp.pay(current_setting('t.order_a2')::uuid);
update private.delivery_codes set code = '2468' where order_id = current_setting('t.order_a2')::uuid;
select pg_temp.remember('number_a2', (select order_number from public.orders where id = current_setting('t.order_a2')::uuid));
select pg_temp.remember('number_a', (select order_number from public.orders where id = current_setting('t.order_a')::uuid));
select pg_temp.remember('number_b', (select order_number from public.orders where id = current_setting('t.order_b')::uuid));
select pg_temp.remember('user_a', (select id::text from auth.users where email = 'casos181a@yuntera.example'));
select pg_temp.remember('user_c', (select id::text from auth.users where email = 'casos181c@yuntera.example'));
-- Carla never ordered, but she complained: she is a customer.
do $$
begin
  perform pg_temp.act('casos181c@yuntera.example');
  perform public.file_complaint('other', 'No puedo cambiar el correo de mi cuenta.', null);
  perform pg_temp.logout();
end $$;

-- ── Targets ────────────────────────────────────────────────────────────────

do $$
begin
  -- A known holiday on a Monday, so the count is checked against the calendar.
  insert into public.holidays (day, name) values ('2031-03-03', 'Feriado de prueba 181')
  on conflict (day) do nothing;

  -- minutes: the clock, whatever the day.
  assert private.case_due('2031-03-01 18:00+00', 15, 'minutes') = '2031-03-01 18:15+00', 'minutes';
  -- working_hours on a working day inside the hours: from the moment (Tue 4 Mar 10:00 CR).
  assert private.case_due('2031-03-04 16:00+00', 2, 'working_hours') = '2031-03-04 18:00+00',
    format('working hours, Tuesday: %s', private.case_due('2031-03-04 16:00+00', 2, 'working_hours'));
  -- before 08:00 CR: from 08:00.
  assert private.case_due('2031-03-04 12:00+00', 2, 'working_hours') = '2031-03-04 16:00+00',
    'working hours, before opening';
  -- Up to closing time (17:00 CR) the same day.
  assert private.case_due('2031-03-04 21:00+00', 2, 'working_hours') = '2031-03-04 23:00+00',
    'working hours, up to closing';
  -- Friday 28 Feb 16:30 CR: half an hour that day, the rest from 08:00 of the
  -- next working day, Saturday 1 Mar (the desk's calendar, owner decision D56).
  assert private.case_due('2031-02-28 22:30+00', 2, 'working_hours') = '2031-03-01 15:30+00',
    format('working hours across closing: %s', private.case_due('2031-02-28 22:30+00', 2, 'working_hours'));
  -- Friday 22:00 CR, after closing: from Saturday 08:00.
  assert private.case_due('2031-03-01 04:00+00', 2, 'working_hours') = '2031-03-01 16:00+00',
    format('working hours, after closing: %s', private.case_due('2031-03-01 04:00+00', 2, 'working_hours'));
  -- More hours than a working day holds: 10 hours from Tuesday 08:00 is Wednesday 09:00.
  assert private.case_due('2031-03-04 14:00+00', 10, 'working_hours') = '2031-03-05 15:00+00',
    format('working hours over two days: %s', private.case_due('2031-03-04 14:00+00', 10, 'working_hours'));
  -- Saturday 1 Mar 10:00 CR: the two hours fit before the Saturday closing at 12:00.
  assert private.case_due('2031-03-01 16:00+00', 2, 'working_hours') = '2031-03-01 18:00+00',
    format('working hours on a Saturday morning: %s',
           private.case_due('2031-03-01 16:00+00', 2, 'working_hours'));
  -- Saturday 1 Mar 11:00 CR: one hour that morning; Sunday is closed and
  -- Monday 3 is the holiday, so the other hour from Tuesday 4 at 08:00.
  assert private.case_due('2031-03-01 17:00+00', 2, 'working_hours') = '2031-03-04 15:00+00',
    format('working hours over a weekend and a holiday: %s',
           private.case_due('2031-03-01 17:00+00', 2, 'working_hours'));
  -- working_days: Friday 28 Feb + 1 is Saturday 1 Mar, a working day of the desk: its end (CR).
  assert private.case_due('2031-02-28 16:00+00', 1, 'working_days') = '2031-03-02 06:00+00',
    format('working days: %s', private.case_due('2031-02-28 16:00+00', 1, 'working_days'));
  -- Five: Saturday 1, Tuesday 4 to Friday 7 (Sunday closed, Monday 3 the holiday).
  assert private.case_due('2031-02-28 16:00+00', 5, 'working_days') = '2031-03-08 06:00+00',
    format('five working days: %s', private.case_due('2031-02-28 16:00+00', 5, 'working_days'));
  -- calendar_days and same_day: to the end of that day, Costa Rica time.
  assert private.case_due('2031-02-28 16:00+00', 8, 'calendar_days') = '2031-03-09 06:00+00', 'calendar days';
  assert private.case_due('2031-02-28 16:00+00', 1, 'same_day') = '2031-03-01 06:00+00', 'same day';
  -- Late at night in Costa Rica is still that day there (01:00 UTC is 19:00 CR the day before).
  assert private.case_due('2031-03-01 01:00+00', 1, 'same_day') = '2031-03-01 06:00+00', 'same day, CR evening';

  -- The targets of customer-service.md.
  assert (select (first_response_amount, first_response_unit, resolution_amount, resolution_unit)
          from private.case_target('complaint', 'delivery'))
         = (1, 'working_days'::text, 5, 'working_days'::text), 'complaint: 1 and 5 working days';
  assert (private.case_target('return', 'withdrawal')).resolution_unit = 'calendar_days', 'withdrawal: 8 calendar days';
  assert (private.case_target('return', 'damaged')).first_response_unit = 'working_hours', 'damaged: 2 working hours';
  assert (private.case_target('contact', 'delivery_today')).first_response_amount = 15, 'delivery today: 15 minutes';
  assert (private.case_target('contact', 'nada')).topic = '*', 'unknown topic: the kind''s own';

  perform pg_temp.act('soporte181@yuntera.example');
  assert jsonb_array_length(public.ops_case_targets()) = (select count(*) from private.case_targets),
    'support reads the targets';
  perform pg_temp.act('central@yuntera.example');
  assert jsonb_array_length(public.ops_case_targets()) > 10, 'the administrator reads the targets';
  perform pg_temp.act('ops181@yuntera.example');
  perform pg_temp.refused('select public.ops_case_targets()', 'forbidden');
  perform pg_temp.logout();
end $$;

-- ── Triggers: a complaint, a return and a report open their cases ──────────

do $$
declare
  v_complaint uuid;
  v_return uuid;
  v_report uuid;
  c private.cases;
  t private.case_targets;
  r jsonb;
begin
  perform pg_temp.act('casos181a@yuntera.example');
  v_complaint := public.file_complaint('delivery', 'El paquete llegó con la caja rota.', current_setting('t.number_a'));
  v_return := public.request_return(pg_temp.item(current_setting('t.order_a')::uuid, 'libreta-tapa-dura-a5'),
    'withdrawal', 1, null);
  perform pg_temp.logout();
  v_report := public.report_content('product',
    (select id from public.products where slug = 'libreta-tapa-dura-a5'), 'misleading',
    'La foto no corresponde al producto.', 'visitante181@example.com');
  perform pg_temp.remember('complaint', v_complaint::text);
  perform pg_temp.remember('return', v_return::text);
  perform pg_temp.remember('report', v_report::text);

  select * into strict c from private.cases where complaint_id = v_complaint;
  t := private.case_target('complaint', 'delivery');
  assert c.kind = 'complaint' and c.topic = 'delivery' and c.area = 'order' and c.channel = 'shop'
         and c.order_id = current_setting('t.order_a')::uuid and c.user_id = current_setting('t.user_a')::uuid
         and c.status = 'open', format('complaint case: %s', to_jsonb(c));
  assert c.first_response_due_at = private.case_due(c.created_at, t.first_response_amount, t.first_response_unit)
         and c.due_at = private.case_due(c.created_at, t.resolution_amount, t.resolution_unit),
    'complaint case: due times from the target';
  assert (select array_agg(kind order by id) from private.case_entries where case_id = c.id) = array['opened'],
    'complaint case: opened on the timeline';
  perform pg_temp.remember('case_complaint', c.id::text);

  select * into strict c from private.cases where return_id = v_return;
  assert c.kind = 'return' and c.topic = 'withdrawal' and c.area = 'payment'
         and c.order_id = current_setting('t.order_a')::uuid, format('return case: %s', to_jsonb(c));
  assert c.due_at = private.case_due(c.created_at, 8, 'calendar_days'), 'return case: refund within 8 calendar days';
  -- The withdrawal approved itself: that is not a human response.
  assert c.first_response_at is null, 'return case: no response yet';
  perform pg_temp.remember('case_return', c.id::text);

  select * into strict c from private.cases where report_id = v_report;
  assert c.kind = 'report' and c.area = 'listing' and c.user_id is null and c.order_id is null,
    format('report case: %s', to_jsonb(c));
  perform pg_temp.remember('case_report', c.id::text);

  -- The receipt the complaint form shows.
  perform pg_temp.act('casos181a@yuntera.example');
  r := public.my_complaint_receipt(v_complaint);
  assert r ->> 'reference' = upper(left(v_complaint::text, 8)) and r ->> 'order_number' = current_setting('t.number_a')
         and (r ->> 'answer_by')::date
             = (select (private.cr_local(due_at) - interval '1 second')::date from private.cases where complaint_id = v_complaint)
         and (r ->> 'acknowledge_by')::date < (r ->> 'answer_by')::date
         and (r ->> 'acknowledge_by')::date > private.cr_local(now())::date,
    format('receipt: %s', r);
  perform pg_temp.act('casos181b@yuntera.example');
  perform pg_temp.refused(format('select public.my_complaint_receipt(%L)', v_complaint), 'complaint_not_found');
  perform pg_temp.logout();
  perform pg_temp.refused(format('select public.my_complaint_receipt(%L)', v_complaint), 'not_authenticated');
end $$;

-- ── Who reads which case ───────────────────────────────────────────────────

do $$
declare
  v_complaint text := current_setting('t.case_complaint');
  v_return text := current_setting('t.case_return');
  v_report text := current_setting('t.case_report');
  ids text[];
begin
  perform pg_temp.act('soporte181@yuntera.example');
  select array_agg(x ->> 'id') into ids from jsonb_array_elements(public.ops_cases('open', 200) -> 'cases') x;
  assert ids @> array[v_complaint, v_return, v_report], 'support reads every case';
  assert (public.ops_cases('open', 200) -> 'cases' -> 0 ->> 'created_at')::timestamptz
         <= (public.ops_cases('open', 200) -> 'cases' -> 1 ->> 'created_at')::timestamptz, 'oldest first';

  perform pg_temp.act('ops181@yuntera.example');
  select array_agg(x ->> 'id') into ids from jsonb_array_elements(public.ops_cases('open', 200) -> 'cases') x;
  assert ids @> array[v_complaint, v_return] and not (ids @> array[v_report]),
    'ops reads the cases with an order, not reports';
  perform pg_temp.refused(format('select public.ops_case(%L)', v_report), 'case_not_found');

  perform pg_temp.act('finanzas181@yuntera.example');
  select array_agg(x ->> 'id') into ids from jsonb_array_elements(public.ops_cases('open', 200) -> 'cases') x;
  assert ids @> array[v_return] and not (ids && array[v_complaint, v_report]),
    'finance reads the payment cases only';
  perform pg_temp.refused(format('select public.ops_case(%L)', v_complaint), 'case_not_found');

  perform pg_temp.act('catalogo181@yuntera.example');
  select array_agg(x ->> 'id') into ids from jsonb_array_elements(public.ops_cases('open', 200) -> 'cases') x;
  assert ids @> array[v_report] and not (ids && array[v_complaint, v_return]), 'catalog reads reports only';
  assert public.ops_case(v_report::uuid) -> 'request' ->> 'text' = 'La foto no corresponde al producto.',
    'catalog reads the report';
  assert not (public.ops_case(v_report::uuid) -> 'can' ->> 'note')::boolean, 'catalog writes no note';

  -- Nobody outside staff: a shopper, a seller, a visitor.
  perform pg_temp.act('casos181a@yuntera.example');
  perform pg_temp.refused('select public.ops_cases()', 'forbidden');
  perform pg_temp.refused(format('select public.ops_case(%L)', v_complaint), 'forbidden');
  perform pg_temp.act('vendedor@yuntera.example');
  perform pg_temp.refused('select public.ops_cases()', 'forbidden');
  perform pg_temp.refused('select public.ops_cases_due()', 'forbidden');
  perform pg_temp.refused(format('select public.ops_order_cases(%L)', current_setting('t.number_a')), 'forbidden');
  perform pg_temp.logout();
  perform pg_temp.refused('select public.ops_cases()', 'forbidden');

  -- The case page: the request, the order, the customer's first name and district.
  perform pg_temp.act('soporte181@yuntera.example');
  assert public.ops_case(v_complaint::uuid) -> 'order' ->> 'order_number' = current_setting('t.number_a')
         and public.ops_case(v_complaint::uuid) -> 'customer' ->> 'first_name' = 'Ana'
         and public.ops_case(v_complaint::uuid) -> 'customer' ->> 'district' is not null
         and public.ops_case(v_complaint::uuid) -> 'request' ->> 'text' = 'El paquete llegó con la caja rota.',
    format('case page: %s', public.ops_case(v_complaint::uuid));
  assert public.ops_case(v_complaint::uuid)::text not like '%casos181a@%', 'no e-mail on the case page';
  perform pg_temp.refused('select public.ops_cases(''todos'')', 'invalid_case');
  perform pg_temp.refused(format('select public.ops_case(%L)', gen_random_uuid()), 'case_not_found');
  perform pg_temp.logout();
end $$;

-- ── Notes, and the delivery code guard ─────────────────────────────────────

-- How the guard reads numbers: the code however it is disguised, and the
-- numbers that are not it.
do $$
declare
  v_text text;
begin
  foreach v_text in array array[
    '4821', 'Su código es 4821.', 'código: 4821, ya se lo dije', '(4821)', 'x4821x', '4821a',
    -- followed or preceded by another number
    '4821 8888', 'el 4821 2 veces', '4821,1234', '1234, 4821', '1 4821',
    -- split by separators
    '4 8 2 1', '48-21', '48.21', '4 821', '₡4821',
    -- other digits and invisible characters
    '４８２１', '٤٨٢١', '۴۸۲۱', '४८२१', E'48​21', E'4‍8⁠21', E'4821​',
    E'­4821', E'4́8́21', '⁴⁸²¹', '𝟒𝟖𝟐𝟏'] loop
    assert '4821' = any (private.case_text_numbers(v_text)), format('the code in %L', v_text);
  end loop;
  foreach v_text in array array[
    'Llamar al 8888-4821 en la tarde.', 'Llamar al +506 8888 4821.', 'Teléfono +5068888-4821.',
    'Pedido YT-104821 revisado.', 'Se devuelven ₡4.821 del envío.', 'Son $4,821.50 en total.',
    'Referencia 482100 del banco.', 'Son 48 210 colones.', '84821', 'El 27/11 a las 10:30.',
    'Sin números.'] loop
    assert not '4821' = any (private.case_text_numbers(v_text)), format('not the code: %L', v_text);
  end loop;
end $$;

do $$
declare
  v_case uuid := current_setting('t.case_complaint')::uuid;
  v_ops uuid := (select id from auth.users where email = 'ops181@yuntera.example');
  v_text text;
  v_audit integer := (select count(*) from private.audit_log where action = 'REFUSED_CODE');
begin
  perform pg_temp.act('ops181@yuntera.example');
  perform public.ops_add_case_note(v_case, 'Nota interna 181: revisar el empaque en bodega.');
  -- Numbers that are not a live code pass.
  foreach v_text in array array[
    'Llamar al 8888-4821 en la tarde.',
    'Llamar al +506 8888 4821.',
    format('Pedido %s revisado.', current_setting('t.number_a')),
    'Se devuelven ₡4.821 del envío.',
    'Referencia 482100 del banco.',
    'Son 48 210 colones.'] loop
    assert public.ops_add_case_note(v_case, v_text) is not null, format('passes: %L', v_text);
  end loop;
  perform pg_temp.refused(format('select public.ops_add_case_note(%L, %L)', v_case, ''), 'invalid_note');
  perform pg_temp.refused(format('select public.ops_add_case_note(%L, %L)', v_case, repeat('x', 2001)), 'invalid_note');

  -- One note cannot test many guesses: more than five four-digit numbers are
  -- refused whatever the code, and without counting as a refusal.
  perform pg_temp.refused(format('select public.ops_add_case_note(%L, %L)', v_case,
    'Revisar 1000, 1001, 1002, 1003, 1004 y 1005.'), 'too_many_numbers');
  perform pg_temp.refused(format('select public.ops_add_case_note(%L, %L)', v_case,
    (select string_agg(lpad(n::text, 4, '0'), ';') from generate_series(7400, 7799) n)), 'too_many_numbers');
  assert public.ops_add_case_note(v_case, 'Revisar 1000, 1001, 1002, 1003 y 1004.') is not null, 'five pass';

  -- The code of the case's order: refused, answered null, written on the trail.
  assert public.ops_add_case_note(v_case, 'Su código es 4 8 2 1.') is null, 'the code is refused';
  assert (select count(*) from private.audit_log where action = 'REFUSED_CODE') = v_audit + 1, 'one refusal row';
  assert (select (actor_id, table_name, row_key, new_row) from private.audit_log
          where action = 'REFUSED_CODE' order by id desc limit 1)
         = (v_ops, 'cases'::text, v_case::text, '{"function": "ops_add_case_note"}'::jsonb),
    'the refusal row: who, which case and where, never the text or the code';
  -- The code of another order of the same customer, still to be delivered.
  assert public.ops_add_case_note(v_case, 'El otro pedido tiene 2468.') is null, 'another live order''s code';
  assert public.ops_add_case_note(v_case, E'Disfrazado: ٤٨​٢١') is null, 'a disguised code';
  -- Three refusals in the hour: this person writes nothing more for now.
  perform pg_temp.refused(format('select public.ops_add_case_note(%L, %L)', v_case, 'Una nota sin números.'),
    'too_many_refusals');
  assert (select count(*) from private.audit_log where action = 'REFUSED_CODE') = v_audit + 3, 'three refusal rows';

  perform pg_temp.act('catalogo181@yuntera.example');
  perform pg_temp.refused(format('select public.ops_add_case_note(%L, %L)', current_setting('t.case_report'),
    'Nota de catálogo'), 'forbidden');
  perform pg_temp.act('finanzas181@yuntera.example');
  perform pg_temp.refused(format('select public.ops_add_case_note(%L, %L)', v_case, 'Nota de finanzas'),
    'case_not_found');
  perform pg_temp.act('casos181a@yuntera.example');
  perform pg_temp.refused(format('select public.ops_add_case_note(%L, %L)', v_case, 'Nota del cliente'), 'forbidden');
  perform pg_temp.logout();

  -- Left behind: eight notes, the code in none.
  assert (select count(*) from private.case_entries where case_id = v_case and kind = 'note') = 8, 'eight notes';
  assert not exists (select 1 from private.case_entries where case_id = v_case
                     and body in ('Su código es 4 8 2 1.', 'El otro pedido tiene 2468.')),
    'no refused note was written';
  -- The lock-out is the writer's own: support still writes.
  perform pg_temp.act('soporte181@yuntera.example');
  assert public.ops_add_case_note(v_case, 'Nota de soporte: el cliente espera respuesta.') is not null,
    'another staff member is not locked out';
  perform pg_temp.logout();
  -- The hour passes for ops (the rows are moved back an hour; the trail is otherwise immutable).
  alter table private.audit_log disable trigger audit_log_immutable;
  update private.audit_log set at = at - interval '61 minutes' where action = 'REFUSED_CODE' and actor_id = v_ops;
  alter table private.audit_log enable trigger audit_log_immutable;
  perform pg_temp.act('ops181@yuntera.example');
  assert public.ops_add_case_note(v_case, 'Nota de operaciones, una hora después.') is not null, 'after the hour';
  perform pg_temp.logout();
end $$;

-- ── Answers: support writes, the shopper reads ─────────────────────────────

do $$
declare
  v_case uuid := current_setting('t.case_complaint')::uuid;
  v_complaint uuid := current_setting('t.complaint')::uuid;
  v_events integer := (select count(*) from private.outbox_events where topic = 'complaint.answered'
                       and payload ->> 'complaint_id' = current_setting('t.complaint'));
  r jsonb;
  mine jsonb;
begin
  perform pg_temp.act('ops181@yuntera.example');
  perform pg_temp.refused(format('select public.ops_answer_case(%L, %L)', v_case,
    'Respuesta de operaciones al cliente.'), 'forbidden');
  perform pg_temp.act('soporte181@yuntera.example');
  assert public.ops_answer_case(v_case, 'Su código de entrega es 4821, désele al repartidor.') is null,
    'an answer with the code is refused';
  perform pg_temp.refused(format('select public.ops_answer_case(%L, %L)', v_case, 'Corto'), 'reason_required');
  r := public.ops_answer_case(v_case, 'Lamentamos lo de la caja. Le enviamos uno nuevo el lunes.', false);
  assert r ->> 'status' = 'open' and r ->> 'first_response_at' is not null, format('answered, open: %s', r);
  assert (select (status, resolution) from public.complaints where id = v_complaint)
         = ('in_progress'::text, 'Lamentamos lo de la caja. Le enviamos uno nuevo el lunes.'::text),
    'the complaint says the same';
  assert (select count(*) from private.case_entries where case_id = v_case and kind = 'answer') = 1,
    'one answer on the timeline (the trigger did not add a second)';
  assert (select count(*) from private.outbox_events where topic = 'complaint.answered'
          and payload ->> 'complaint_id' = v_complaint::text) = v_events + 1, 'the planner is told';

  -- Assign.
  r := public.ops_assign_case(v_case);
  assert r ->> 'assignee' = 'Sonia' and (r ->> 'assigned_to_me')::boolean, format('assigned: %s', r);
  perform public.ops_assign_case(v_case);
  assert (select count(*) from private.case_entries where case_id = v_case and kind = 'assigned') = 1,
    'assigning twice writes once';
  perform pg_temp.act('ops181@yuntera.example');
  perform pg_temp.refused(format('select public.ops_assign_case(%L)', v_case), 'forbidden');
  assert public.ops_case(v_case) ->> 'assignee' = 'Sonia', 'ops reads the assignee''s first name';

  -- The shopper reads the answer, with a first name, and never a note.
  perform pg_temp.act('casos181a@yuntera.example');
  mine := public.my_cases(current_setting('t.number_a'));
  select x into r from jsonb_array_elements(mine) x where x ->> 'id' = v_case::text;
  assert r -> 'answers' -> 0 ->> 'body' = 'Lamentamos lo de la caja. Le enviamos uno nuevo el lunes.'
         and r -> 'answers' -> 0 ->> 'author' = 'Sonia' and jsonb_array_length(r -> 'answers') = 1,
    format('shopper reads the answer: %s', r);
  assert mine::text not like '%Nota interna 181%' and mine::text not like '%8888%', 'no note reaches the shopper';
  assert public.my_cases()::text like '%' || v_case || '%', 'and in the account';
  -- Another shopper reads none of it.
  perform pg_temp.act('casos181b@yuntera.example');
  assert public.my_cases()::text not like '%' || v_case || '%', 'another shopper does not read the case';
  perform pg_temp.refused(format('select public.my_cases(%L)', current_setting('t.number_a')), 'order_not_found');
  perform pg_temp.logout();
  perform pg_temp.refused('select public.my_cases()', 'not_authenticated');

  -- Answer and close; then an answer on a closed case is refused; reopen.
  perform pg_temp.act('soporte181@yuntera.example');
  r := public.ops_answer_case(v_case, 'Ya le llegó el reemplazo. Damos el reclamo por resuelto.', true);
  assert r ->> 'status' = 'closed' and r ->> 'resolved_at' is not null, format('closed: %s', r);
  assert (select status from public.complaints where id = v_complaint) = 'resolved', 'the complaint is resolved';
  perform pg_temp.refused(format('select public.ops_answer_case(%L, %L)', v_case, 'Otra respuesta más larga.'),
    'case_closed');
  perform pg_temp.refused(format('select public.ops_assign_case(%L)', v_case), 'case_closed');
  r := public.ops_reopen_case(v_case);
  assert r ->> 'status' = 'open' and (r ->> 'reopened_count')::integer = 1, format('reopened: %s', r);
  assert (select status from public.complaints where id = v_complaint) = 'in_progress', 'the complaint is open again';
  perform pg_temp.refused(format('select public.ops_reopen_case(%L)', v_case), 'case_open');
  assert (select array_agg(kind order by id) from private.case_entries where case_id = v_case and kind <> 'note')
         = array['opened', 'answer', 'assigned', 'answer', 'closed', 'reopened'],
    format('timeline: %s', (select array_agg(kind order by id) from private.case_entries where case_id = v_case));
  perform pg_temp.logout();
end $$;

-- ── Answered from /atencion: the timeline follows ──────────────────────────

do $$
declare
  v_complaint uuid;
  c private.cases;
begin
  perform pg_temp.act('casos181a@yuntera.example');
  v_complaint := public.file_complaint('payment', 'Me cobraron dos veces el mismo pedido.', null);
  perform pg_temp.act('central@yuntera.example');
  -- Refused with the refusal kept (section 10 of 084700): null, nothing else.
  assert public.ops_resolve_complaint(v_complaint, 'El código 2468 no sirve para esto.', true) is null,
    'an answer with the code is refused';
  -- Many numbers are refused here too, whatever the code.
  perform pg_temp.refused(format('select public.ops_resolve_complaint(%L, %L, true)', v_complaint,
    (select string_agg(lpad(n::text, 4, '0'), ' ') from generate_series(1000, 1005) n)), 'too_many_numbers');
  perform public.ops_resolve_complaint(v_complaint, 'Revisamos el cobro y devolvimos el segundo.', true);
  perform pg_temp.logout();
  select * into strict c from private.cases where complaint_id = v_complaint;
  assert c.area = 'payment' and c.order_id is null, 'a payment complaint without an order';
  assert c.status = 'closed' and c.first_response_at is not null, format('closed from atencion: %s', to_jsonb(c));
  assert (select array_agg(kind order by id) from private.case_entries where case_id = c.id)
         = array['opened', 'answer', 'closed'], 'answer and closure on the timeline';
  -- Finance reads it: a payment case.
  perform pg_temp.act('finanzas181@yuntera.example');
  assert public.ops_case(c.id) ->> 'kind' = 'complaint', 'finance reads a payment complaint';
  perform pg_temp.logout();

  -- A return decided and a report resolved close their cases.
  perform pg_temp.act('central@yuntera.example');
  perform public.ops_resolve_report(current_setting('t.report')::uuid, false, 'No incumple las reglas.');
  perform pg_temp.logout();
  assert (select status from private.cases where id = current_setting('t.case_report')::uuid) = 'closed',
    'the report''s case closed';
  assert (select array_agg(kind || coalesce(':' || body, '') order by id) from private.case_entries
          where case_id = current_setting('t.case_report')::uuid)
         = array['opened', 'status:dismissed', 'closed'], 'the report''s timeline';
end $$;

-- ── Contacts recorded by staff ─────────────────────────────────────────────

do $$
declare
  v_case uuid;
  c private.cases;
  d record;
begin
  perform pg_temp.act('soporte181@yuntera.example');
  v_case := public.ops_record_contact('whatsapp', 'delivery_today',
    'Pregunta a qué hora llega el pedido de hoy.', current_setting('t.number_a'));
  select * into strict c from private.cases where id = v_case;
  assert c.kind = 'contact' and c.channel = 'whatsapp' and c.order_id = current_setting('t.order_a')::uuid
         and c.user_id = current_setting('t.user_a')::uuid and c.first_response_due_at = c.created_at + interval '15 minutes'
         and c.created_by = (select id from auth.users where email = 'soporte181@yuntera.example'),
    format('contact by order: %s', to_jsonb(c));
  perform pg_temp.remember('case_contact', v_case::text);

  -- Against an account, without an order.
  v_case := public.ops_record_contact('phone', 'other', 'Pidió cambiar su correo de la cuenta.', null,
    current_setting('t.user_c')::uuid);
  assert (select (order_id is null and user_id = current_setting('t.user_c')::uuid and area = 'account')
          from private.cases where id = v_case), 'contact by account';
  perform pg_temp.remember('case_contact_c', v_case::text);

  perform pg_temp.refused('select public.ops_record_contact(''telegram'', ''other'', ''Una consulta cualquiera.'', '
    || quote_literal(current_setting('t.number_a')) || ')', 'invalid_contact');
  perform pg_temp.refused('select public.ops_record_contact(''phone'', ''other'', ''Corto'', '
    || quote_literal(current_setting('t.number_a')) || ')', 'invalid_contact');
  perform pg_temp.refused('select public.ops_record_contact(''phone'', ''other'', ''Una consulta cualquiera.'')',
    'invalid_contact');
  perform pg_temp.refused('select public.ops_record_contact(''phone'', ''other'', ''Una consulta cualquiera.'', ''YT-0'')',
    'order_not_found');
  perform pg_temp.refused(format('select public.ops_record_contact(%L, %L, %L, null, %L)', 'phone', 'other',
    'Una consulta cualquiera.', gen_random_uuid()), 'customer_not_found');
  -- A staff account is not a customer.
  perform pg_temp.refused(format('select public.ops_record_contact(%L, %L, %L, null, %L)', 'phone', 'other',
    'Una consulta cualquiera.', (select id from auth.users where email = 'central@yuntera.example')),
    'customer_not_found');
  -- A seller or a driver account that never bought anything is not a customer.
  perform pg_temp.refused(format('select public.ops_record_contact(%L, %L, %L, null, %L)', 'whatsapp', 'other',
    'Hablamos por WhatsApp con el vendedor.', (select id from auth.users where email = 'vendedor@yuntera.example')),
    'customer_not_found');
  perform pg_temp.refused(format('select public.ops_record_contact(%L, %L, %L, null, %L)', 'phone', 'other',
    'Hablamos con el repartidor por teléfono.', (select id from auth.users where email = 'repartidor@yuntera.example')),
    'customer_not_found');
  assert public.ops_record_contact('whatsapp', 'other', 'Me dio su código 4821 por WhatsApp.',
    current_setting('t.number_a')) is null, 'a summary with the code is refused';
  assert not exists (select 1 from private.cases where summary like '%4821 por%'), 'and no case was opened';
  -- Another customer's code is not this one's: the guard is about this customer.
  perform public.ops_record_contact('email', 'other', 'Escribió el número 4821 de una factura.',
    current_setting('t.number_b'));
  -- Nor is the code of a delivered order other than the contact's own.
  assert public.ops_record_contact('email', 'other', 'Citó el pedido anterior, código 4821, ya entregado.',
    current_setting('t.number_a2')) is not null, 'a spent code of another order passes';

  perform pg_temp.act('ops181@yuntera.example');
  perform pg_temp.refused(format('select public.ops_record_contact(%L, %L, %L, %L)', 'phone', 'other',
    'Una consulta cualquiera.', current_setting('t.number_a')), 'forbidden');
  perform pg_temp.logout();

  -- An answer to a contact plans one message through the planner, without the answer in it.
  perform pg_temp.act('soporte181@yuntera.example');
  perform public.ops_answer_case(current_setting('t.case_contact')::uuid,
    'Su pedido llega entre las 2 y las 4 de la tarde.', true);
  perform pg_temp.logout();
  select * into strict d from private.notification_deliveries
  where template = 'case_answered' and recipient_user_id = current_setting('t.user_a')::uuid and channel = 'email';
  assert d.context ->> 'case_ref' = upper(left(current_setting('t.case_contact'), 8))
         and d.context ->> 'order_id' = current_setting('t.order_a') and (d.context ->> 'closed')::boolean,
    format('message context: %s', d.context);
  assert d.context::text not like '%2 y las 4%', 'the answer is not in the message';
  assert (select processed_at is not null and topic = 'case.answered' from private.outbox_events where id = d.event_id),
    'its event is recorded as planned';
  assert not exists (select 1 from private.outbox_jobs j where j.event_id = d.event_id), 'and no consumer is queued';
end $$;

-- ── The order page, the "Hoy" line and the report ──────────────────────────

do $$
declare
  r jsonb;
  ids text[];
begin
  perform pg_temp.act('ops181@yuntera.example');
  r := public.ops_order_cases(current_setting('t.number_a'));
  assert r ->> 'customer_id' = current_setting('t.user_a'), 'the order page links the customer';
  select array_agg(x ->> 'id') into ids from jsonb_array_elements(r -> 'cases') x;
  assert ids @> array[current_setting('t.case_complaint'), current_setting('t.case_return'),
                      current_setting('t.case_contact')], format('the order''s cases: %s', r);
  perform pg_temp.refused('select public.ops_order_cases(''YT-0'')', 'order_not_found');
  perform pg_temp.act('finanzas181@yuntera.example');
  select array_agg(x ->> 'id') into ids
  from jsonb_array_elements(public.ops_order_cases(current_setting('t.number_a')) -> 'cases') x;
  assert ids = array[current_setting('t.case_return')], 'finance: the order''s payment cases only';

  -- "Hoy": counts what the role reads; a case made late counts as overdue.
  perform pg_temp.act('soporte181@yuntera.example');
  r := public.ops_cases_due();
  update private.cases set first_response_due_at = now() - interval '1 minute'
  where id = current_setting('t.case_return')::uuid;
  assert (public.ops_cases_due() ->> 'overdue')::integer = (r ->> 'overdue')::integer + 1, 'an overdue case counts';
  assert public.ops_case(current_setting('t.case_return')::uuid) ->> 'clock' = 'overdue', 'its clock says overdue';
  update private.cases set first_response_due_at = now() + interval '2 minutes',
                           created_at = now() - interval '1 hour'
  where id = current_setting('t.case_return')::uuid;
  assert public.ops_case(current_setting('t.case_return')::uuid) ->> 'clock' = 'due_soon', 'and due soon';
  perform pg_temp.act('catalogo181@yuntera.example');
  assert (public.ops_cases_due() ->> 'open')::integer
         = (select count(*) from private.cases where status = 'open' and area = 'listing'), 'catalog counts its own';

  -- The monthly report.
  perform pg_temp.act('soporte181@yuntera.example');
  r := public.ops_case_report((private.cr_local(now())::date - 1), (private.cr_local(now())::date + 1));
  assert (r ->> 'total')::integer >= 6 and (r -> 'by_kind' ->> 'contact')::integer >= 3
         and (r -> 'by_kind' ->> 'complaint')::integer >= 2 and (r ->> 'reopened')::integer >= 1
         and (r -> 'first_response' ->> 'answered')::integer >= 3
         and r -> 'first_response' ->> 'median_minutes' is not null,
    format('report: %s', r);
  perform pg_temp.refused('select public.ops_case_report(''2026-02-01'', ''2026-01-01'')', 'invalid_period');
  perform pg_temp.act('ops181@yuntera.example');
  perform pg_temp.refused('select public.ops_case_report(''2026-01-01'', ''2026-02-01'')', 'forbidden');
  perform pg_temp.logout();
end $$;

-- ── A return is decided in Atención, so its case is not closed in Casos ───

do $$
declare
  v_case uuid := current_setting('t.case_return')::uuid;
  r jsonb;
begin
  perform pg_temp.act('soporte181@yuntera.example');
  assert not (public.ops_case(v_case) -> 'can' ->> 'close')::boolean
         and (public.ops_case(v_case) -> 'can' ->> 'answer')::boolean, 'answer, but not close';
  perform pg_temp.refused(format('select public.ops_answer_case(%L, %L, true)', v_case,
    'Recibimos su solicitud y la revisamos hoy.'), 'case_source_open');
  r := public.ops_answer_case(v_case, 'Recibimos su solicitud y la revisamos hoy.', false);
  assert r ->> 'status' = 'open', 'answered and still open';
  assert (select status from public.return_requests where id = current_setting('t.return')::uuid) = 'approved',
    'the return is untouched';
  -- A complaint closes in Casos.
  assert (public.ops_case(current_setting('t.case_complaint')::uuid) -> 'can' ->> 'close')::boolean,
    'a complaint can be closed';
  perform pg_temp.logout();
end $$;

-- ── The customer view and "Mostrar contacto" ───────────────────────────────

do $$
declare
  v_user uuid := current_setting('t.user_a')::uuid;
  r jsonb;
  v_audit integer := (select count(*) from private.audit_log where action = 'VIEW_CONTACT');
begin
  perform pg_temp.act('ops181@yuntera.example');
  r := public.ops_customer(v_user);
  assert r ->> 'first_name' = 'Ana' and r ->> 'district' is not null and (r ->> 'order_count')::integer = 2
         and jsonb_array_length(r -> 'orders') = 2 and jsonb_array_length(r -> 'returns') = 1
         and jsonb_array_length(r -> 'complaints') = 1 and jsonb_array_length(r -> 'cases') >= 3
         and not (r ->> 'can_reveal_contact')::boolean,
    format('customer view: %s', r);
  assert r::text not like '%casos181a@%' and r::text not like '%Prueba Casos%' and r::text not like '%+506%',
    'no contact details and no full name in the customer view';
  perform pg_temp.refused(format('select public.ops_customer_contact(%L, %L)', v_user,
    'Necesito llamar al cliente por su pedido.'), 'forbidden');
  perform pg_temp.refused(format('select public.ops_customer(%L)', gen_random_uuid()), 'customer_not_found');
  -- What ops reads follows table 4.1: the cases and complaints tied to an order.
  assert not exists (select 1 from jsonb_array_elements(r -> 'cases') x where x ->> 'order_number' is null),
    'ops: no case without an order';
  -- Finance: only the payment cases, and the complaints and returns behind them.
  perform pg_temp.act('finanzas181@yuntera.example');
  r := public.ops_customer(v_user);
  assert jsonb_array_length(r -> 'cases') >= 2
         and not exists (select 1 from jsonb_array_elements(r -> 'cases') x
                         join private.cases k on k.id = (x ->> 'id')::uuid where k.area <> 'payment'),
    format('finance: payment cases only: %s', r -> 'cases');
  assert (select array_agg(x ->> 'category') from jsonb_array_elements(r -> 'complaints') x) = array['payment']
         and jsonb_array_length(r -> 'returns') = 1,
    format('finance: the payment complaint and the return: %s', r);
  -- A seller or a driver is not a customer: no view, no contact.
  perform pg_temp.act('soporte181@yuntera.example');
  perform pg_temp.refused(format('select public.ops_customer(%L)',
    (select id from auth.users where email = 'vendedor@yuntera.example')), 'customer_not_found');
  perform pg_temp.refused(format('select public.ops_customer_contact(%L, %L)',
    (select id from auth.users where email = 'repartidor@yuntera.example'), 'Necesito el correo del repartidor.'),
    'customer_not_found');
  perform pg_temp.act('catalogo181@yuntera.example');
  perform pg_temp.refused(format('select public.ops_customer(%L)', v_user), 'forbidden');
  perform pg_temp.act('casos181b@yuntera.example');
  perform pg_temp.refused(format('select public.ops_customer(%L)', v_user), 'forbidden');

  perform pg_temp.act('soporte181@yuntera.example');
  assert (public.ops_customer(v_user) ->> 'can_reveal_contact')::boolean, 'support may reveal';
  perform pg_temp.refused(format('select public.ops_customer_contact(%L, %L)', v_user, 'corto'), 'reason_required');
  r := public.ops_customer_contact(v_user, 'Llamar por la entrega de hoy, no contesta WhatsApp.');
  assert r ->> 'email' = 'casos181a@yuntera.example' and r ->> 'phone' is not null, format('contact: %s', r);
  perform pg_temp.logout();

  assert (select count(*) from private.audit_log where action = 'VIEW_CONTACT') = v_audit + 1, 'one audit row';
  assert (select (table_name, row_key, new_row ->> 'reason', actor_id) from private.audit_log
          where action = 'VIEW_CONTACT' order by id desc limit 1)
         = ('customers'::text, v_user::text, 'Llamar por la entrega de hoy, no contesta WhatsApp.'::text,
            (select id from auth.users where email = 'soporte181@yuntera.example')),
    'the audit row: whose, why and who';
  assert (select new_row::text not like '%@%' and new_row::text not like '%+506%' from private.audit_log
          where action = 'VIEW_CONTACT' order by id desc limit 1), 'the contact itself is not on the trail';
end $$;

-- ── Saved answers ──────────────────────────────────────────────────────────

do $$
declare
  v_id uuid;
  v_audit integer := (select count(*) from private.audit_log where table_name = 'saved_replies');
begin
  perform pg_temp.act('soporte181@yuntera.example');
  assert jsonb_array_length(public.ops_saved_replies()) >= 5, 'support reads the saved answers';
  perform pg_temp.refused('select public.ops_save_reply(''Título 181'', ''Un texto de respuesta guardada.'')', 'forbidden');
  perform pg_temp.act('ops181@yuntera.example');
  perform pg_temp.refused('select public.ops_saved_replies()', 'forbidden');

  perform pg_temp.act('central@yuntera.example');
  v_id := public.ops_save_reply('Título 181', 'Un texto de respuesta guardada.');
  assert public.ops_save_reply('Título 181 cambiado', 'Un texto de respuesta guardada, cambiado.', v_id) = v_id, 'edited';
  perform pg_temp.refused('select public.ops_save_reply(''título 181 CAMBIADO'', ''Otro texto de respuesta.'')',
    'reply_title_taken');
  perform pg_temp.refused('select public.ops_save_reply(''T'', ''Un texto de respuesta guardada.'')', 'invalid_saved_reply');
  perform pg_temp.refused(format('select public.ops_save_reply(%L, %L, %L)', 'Otro título', 'Un texto cualquiera.',
    gen_random_uuid()), 'reply_not_found');
  perform public.ops_delete_reply(v_id);
  perform pg_temp.refused(format('select public.ops_delete_reply(%L)', v_id), 'reply_not_found');
  perform pg_temp.logout();
  assert (select count(*) from private.audit_log where table_name = 'saved_replies') = v_audit + 3,
    'created, changed and deleted, on the audit trail';
end $$;

-- ── Left behind: append-only, out of reach ─────────────────────────────────

do $$
begin
  begin
    update private.case_entries set body = 'cambiado' where case_id = current_setting('t.case_complaint')::uuid;
    assert false, 'an entry was changed';
  exception when others then
    assert sqlerrm like '%immutable%', sqlerrm;
  end;
  begin
    delete from private.case_entries where case_id = current_setting('t.case_complaint')::uuid;
    assert false, 'an entry was deleted';
  exception when others then
    assert sqlerrm like '%immutable%', sqlerrm;
  end;
  assert (select relrowsecurity from pg_class where oid = 'private.cases'::regclass)
         and (select relrowsecurity from pg_class where oid = 'private.case_entries'::regclass)
         and (select relrowsecurity from pg_class where oid = 'private.saved_replies'::regclass)
         and (select relrowsecurity from pg_class where oid = 'private.case_targets'::regclass),
    'row-level security on';
  assert not has_table_privilege('authenticated', 'private.cases', 'select')
         and not has_table_privilege('authenticated', 'private.case_entries', 'select')
         and not has_table_privilege('anon', 'private.saved_replies', 'select')
         and not has_table_privilege('authenticated', 'private.case_targets', 'select'),
    'no API role reads the tables';
  assert not has_function_privilege('anon', 'public.my_cases(text)', 'execute')
         and not has_function_privilege('anon', 'public.ops_cases(text, integer, integer)', 'execute')
         and has_function_privilege('authenticated', 'public.ops_case(uuid)', 'execute'),
    'granted to authenticated only';
end $$;

-- A case follows its source row if one is ever deleted (nothing in the API
-- does; tests that clean up after themselves do), timeline included.
do $$
declare
  v_return uuid;
  v_case uuid;
begin
  insert into public.return_requests (order_item_id, user_id, kind, quantity, status)
  select i.id, o.user_id, 'withdrawal', 1, 'requested'
  from public.order_items i join public.orders o on o.id = i.order_id
  where o.id = current_setting('t.order_b')::uuid limit 1
  returning id into v_return;
  select id into strict v_case from private.cases where return_id = v_return;
  delete from public.return_requests where id = v_return;
  assert not exists (select 1 from private.cases where id = v_case)
         and not exists (select 1 from private.case_entries where case_id = v_case),
    'the case and its timeline went with the return';
end $$;

select pg_temp.login('casos181a@yuntera.example');
select pg_temp.refused('select count(*) from private.cases', 'forbidden');
select pg_temp.refused('select count(*) from private.case_entries', 'forbidden');
reset role;

-- ── Backfill ───────────────────────────────────────────────────────────────

do $$
declare
  v_complaint uuid;
  c private.cases;
begin
  alter table public.complaints disable trigger complaints_follow_case;
  insert into public.complaints (user_id, order_id, category, description, status, resolution, created_at, resolved_at)
  values (current_setting('t.user_a')::uuid, null, 'other', 'Un reclamo de antes de los casos.', 'resolved',
          'Respondido antes de los casos.', now() - interval '20 days', now() - interval '18 days')
  returning id into v_complaint;
  alter table public.complaints enable trigger complaints_follow_case;
  assert not exists (select 1 from private.cases where complaint_id = v_complaint), 'no case yet';

  assert private.cases_backfill() = 1, 'one case opened';
  select * into strict c from private.cases where complaint_id = v_complaint;
  assert c.status = 'closed' and c.created_at = now() - interval '20 days'
         and c.resolved_at = now() - interval '18 days' and c.first_response_at = c.resolved_at
         and c.due_at = private.case_due(c.created_at, 5, 'working_days'),
    format('backfilled: %s', to_jsonb(c));
  assert (select array_agg(kind || coalesce(':' || body, '') order by id) from private.case_entries where case_id = c.id)
         = array['opened', 'answer:Respondido antes de los casos.', 'closed'], 'its timeline';
  assert private.cases_backfill() = 0, 'a second run opens nothing';
end $$;

-- ── Account deletion erases the case text ──────────────────────────────────

do $$
declare
  v_case uuid := current_setting('t.case_contact_c')::uuid;
begin
  perform pg_temp.act('soporte181@yuntera.example');
  perform public.ops_add_case_note(v_case, 'Carla quiere el correo nuevo carla@example.com.');
  -- An open complaint holds a deletion back: answer Carla's first.
  perform public.ops_resolve_complaint((select id from public.complaints where user_id = current_setting('t.user_c')::uuid),
    'Le cambiamos el correo de la cuenta.', true);
  perform pg_temp.act('casos181c@yuntera.example');
  perform public.delete_my_account();
  perform pg_temp.logout();
  assert (select summary from private.cases where id = v_case) = private.erased_case_text(), 'summary erased';
  assert not exists (select 1 from private.case_entries where case_id = v_case
                     and body is not null and body <> private.erased_case_text()), 'entries erased';
  assert (select count(*) from private.case_entries where case_id = v_case and kind <> 'closed') = 2,
    'the entries themselves stay';
  -- The open contact has nobody left to answer: it closes (integration, wave 9).
  assert (select status from private.cases where id = v_case) = 'closed'
         and (select kind from private.case_entries where case_id = v_case order by id desc limit 1) = 'closed',
    'the open contact closes';
  -- Outside the deletion, entries stay immutable.
  begin
    update private.case_entries set body = private.erased_case_text()
    where case_id = current_setting('t.case_complaint')::uuid and kind = 'note';
    assert false, 'an entry was blanked outside a deletion';
  exception when others then
    assert sqlerrm like '%immutable%', sqlerrm;
  end;
end $$;

select 'ok' as support_cases;
rollback;
