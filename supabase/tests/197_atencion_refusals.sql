-- What the outside review of the wave 9 integration found, each fixed in
-- 084700 (applied nowhere yet):
--
--   Atención keeps a refusal: a staff text that holds the customer's live
--                  delivery code, sent through ops_resolve_complaint,
--                  ops_decide_return, ops_receive_return or
--                  ops_complete_return, is refused with the refusal kept on
--                  the audit trail and its numbers counted (the call answers
--                  null and changes nothing else), so the lock-out of three
--                  refusals an hour holds across Casos and Atención; a text
--                  too long for the timeline is refused before the code is
--                  looked at, so a long text with the code and one without
--                  give the same answer and leave nothing;
--   the masking:   the customer's own live code reaches staff masked also
--                  when typed with other separators (slashes, underscores,
--                  spaced dashes, several spaces, line breaks) or at the
--                  start or end of a longer number; a text staff wrote is
--                  never masked, and the guard reads every shape the mask
--                  reads (the review of the join, part 2);
--   Atención:      ops_care_queues lists for each role only the complaints,
--                  returns and reports whose case that role reads (table 4.1)
--                  and names the customer by first name.
--
-- And what the second review of the join left open, also in 084700:
--
--   the lock-out:  a writer locked out by three refusals still cancels an
--                  order with an open return, withdraws a return of their
--                  own, decides, receives and refunds without a note,
--                  assigns and reopens (none of them puts typed text on a
--                  case); what they type is still refused.
--
-- Everything is this suite's own and rolls back.

begin;
\ir _helpers.sql
\ir _money_helpers.sql

select pg_temp.shopper('cliente197@yuntera.example', 'Dalia Cliente Refusal');
select pg_temp.shopper('soporte197@yuntera.example', 'Sara Soporte');
select pg_temp.shopper('finanzas197@yuntera.example', 'Flor Finanzas');
select pg_temp.shopper('catalogo197@yuntera.example', 'Ciro Catalogo');
select pg_temp.shopper('ops197@yuntera.example', 'Omar Operaciones');
insert into public.staff_members (user_id, role)
select u.id, x.role::public.staff_role
from (values ('soporte197@yuntera.example', 'support'), ('finanzas197@yuntera.example', 'finance'),
             ('catalogo197@yuntera.example', 'catalog'), ('ops197@yuntera.example', 'ops')) x (email, role)
join auth.users u on u.email = x.email;

-- A delivered order (its code spent) with a complaint and two returns, and a
-- second order still to be delivered, whose code 6284 is live.
select pg_temp.remember('order_d', pg_temp.place('cliente197@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:2'), 'card', 'refusal-197-d')::text);
select pg_temp.pay(current_setting('t.order_d')::uuid);
select pg_temp.deliver(current_setting('t.order_d')::uuid);
select pg_temp.remember('order_l', pg_temp.place('cliente197@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'refusal-197-l')::text);
select pg_temp.pay(current_setting('t.order_l')::uuid);
update private.delivery_codes set code = '6284' where order_id = current_setting('t.order_l')::uuid;
select pg_temp.remember('user_d', (select id::text from auth.users where email = 'cliente197@yuntera.example'));

do $$
declare
  v_item uuid := pg_temp.item(current_setting('t.order_d')::uuid, 'libreta-tapa-dura-a5');
begin
  perform pg_temp.act('cliente197@yuntera.example');
  perform pg_temp.remember('complaint', public.file_complaint('delivery', 'El pedido llegó tarde y nadie me avisó.',
    (select order_number from public.orders where id = current_setting('t.order_d')::uuid))::text);
  perform pg_temp.remember('return_a', public.request_return(v_item, 'damaged', 1, 'Llegó rota la tapa.')::text);
  perform pg_temp.remember('return_b', public.request_return(v_item, 'damaged', 1, 'La otra también.')::text);
  perform pg_temp.logout();
end $$;

-- How many refusals and counted texts the support writer has, and whether
-- the complaint and the returns are as the customer left them.
create function pg_temp.trail() returns text
language sql as $$
  select format('refused=%s counted=%s answers=%s complaint=%s/%s a=%s b=%s',
    (select count(*) from private.audit_log a join auth.users u on u.id = a.actor_id
     where u.email = 'soporte197@yuntera.example' and a.action = 'REFUSED_CODE'),
    (select count(*) from private.case_number_checks k join auth.users u on u.id = k.actor_id
     where u.email in ('soporte197@yuntera.example', 'finanzas197@yuntera.example')),
    (select count(*) from private.case_entries e join private.cases c on c.id = e.case_id
     where e.kind = 'answer' and (c.complaint_id = current_setting('t.complaint')::uuid
       or c.return_id in (current_setting('t.return_a')::uuid, current_setting('t.return_b')::uuid))),
    (select status from public.complaints where id = current_setting('t.complaint')::uuid),
    (select coalesce(resolution, '-') from public.complaints where id = current_setting('t.complaint')::uuid),
    (select status from public.return_requests where id = current_setting('t.return_a')::uuid),
    (select status from public.return_requests where id = current_setting('t.return_b')::uuid))
$$;

-- ── A text too long for the timeline: the same answer, code or not ─────────

do $$
declare
  v_before text := pg_temp.trail();
begin
  perform pg_temp.act('soporte197@yuntera.example');
  perform pg_temp.refused(format('select public.ops_resolve_complaint(%L, %L, false)',
    current_setting('t.complaint'), 'Pruebe 0000 0001 6284 0003 0004 ' || repeat('x', 4000)), 'text_too_long');
  perform pg_temp.refused(format('select public.ops_resolve_complaint(%L, %L, false)',
    current_setting('t.complaint'), 'Pruebe 0000 0001 0002 0003 0004 ' || repeat('x', 4000)), 'text_too_long');
  perform pg_temp.refused(format('select public.ops_decide_return(%L, false, %L)',
    current_setting('t.return_a'), 'Pruebe 6284 ' || repeat('x', 4000)), 'text_too_long');
  perform pg_temp.logout();
  assert pg_temp.trail() = v_before, format('a long text leaves nothing: %s, was %s', pg_temp.trail(), v_before);
end $$;

-- ── A code refused through Atención is kept on the trail ───────────────────

do $$
declare
  v_jobs integer := (select count(*) from private.outbox_events where topic in ('complaint.answered', 'return.decided'));
begin
  perform pg_temp.act('soporte197@yuntera.example');
  -- A complaint's answer with the code: refused, nothing else changes.
  assert public.ops_resolve_complaint(current_setting('t.complaint')::uuid,
    'Dalia, su código 6284 queda anulado.', false) is null, 'the answer with the code answers null';
  assert pg_temp.trail() = 'refused=1 counted=1 answers=0 complaint=open/- a=requested b=requested',
    format('after the first refusal: %s', pg_temp.trail());
  -- An answer without it is kept, and its number counts.
  assert public.ops_resolve_complaint(current_setting('t.complaint')::uuid,
    'Dalia, revisamos la ruta 1234 y le escribimos mañana.', false), 'an answer without the code is kept';
  assert pg_temp.trail() like 'refused=1 counted=2 answers=1 complaint=in_progress/Dalia, revisamos%',
    format('after an accepted answer: %s', pg_temp.trail());
  -- A return refused with the code in its note: refused, still requested.
  assert public.ops_decide_return(current_setting('t.return_a')::uuid, false,
    'No vemos daño; el 6 2 8 4 no aplica.') is null, 'the decision with the code answers null';
  -- An approval whose note holds it: refused too, nothing approved.
  assert public.ops_decide_return(current_setting('t.return_b')::uuid, true,
    'Aprobada. Entregue con el código 6284.') is null, 'the approval with the code answers null';
  assert pg_temp.trail() like 'refused=3 counted=4 answers=1 complaint=in_progress/% a=requested b=requested',
    format('after three refusals: %s', pg_temp.trail());
  -- Three refusals in the hour, across Atención: the writer is locked out
  -- everywhere, in Casos too, whatever the text.
  perform pg_temp.refused(format('select public.ops_resolve_complaint(%L, %L, false)',
    current_setting('t.complaint'), 'Le escribimos mañana sin falta.'), 'too_many_refusals');
  perform pg_temp.refused(format('select public.ops_decide_return(%L, true, %L)',
    current_setting('t.return_a'), 'Aprobada, la recogemos mañana.'), 'too_many_refusals');
  perform pg_temp.refused(format('select public.ops_add_case_note(%L, %L)',
    (select id from private.cases where complaint_id = current_setting('t.complaint')::uuid),
    'Nota sin números.'), 'too_many_refusals');
  -- A decision without a note writes no text, so it still goes through.
  assert public.ops_decide_return(current_setting('t.return_a')::uuid, true, null), 'an approval without a note';
  perform pg_temp.logout();
  assert (select count(*) from private.outbox_events where topic in ('complaint.answered', 'return.decided'))
         = v_jobs + 2, 'messages only for what was kept (one answer, one approval)';
end $$;

-- ── Receiving and refunding: the same, for the note on each ────────────────

do $$
declare
  v_refund jsonb;
begin
  -- Another writer (the support writer is locked out for the hour).
  perform pg_temp.act('ops197@yuntera.example');
  assert public.ops_receive_return(current_setting('t.return_a')::uuid, true,
    'Recibida; la caja traía el 6284 escrito.') is null, 'a receipt note with the code answers null';
  assert (select status from public.return_requests where id = current_setting('t.return_a')::uuid) = 'approved',
    'not received';
  assert public.ops_receive_return(current_setting('t.return_a')::uuid, true, 'Recibida en buen estado.'),
    'a receipt without the code';
  perform pg_temp.act('finanzas197@yuntera.example');
  assert public.ops_complete_return(current_setting('t.return_a')::uuid, 'Reembolso hecho, código 6284.') is null,
    'a refund note with the code answers null';
  assert (select status from public.return_requests where id = current_setting('t.return_a')::uuid) = 'received',
    'not refunded';
  assert not exists (select 1 from private.refunds r where r.reason = 'return' and r.source_id = current_setting('t.return_a')::uuid),
    'no refund was made';
  v_refund := public.ops_complete_return(current_setting('t.return_a')::uuid, 'Reembolso hecho a su tarjeta.');
  assert (v_refund ->> 'refund_minor')::bigint > 0, format('the refund without the code: %s', v_refund);
  perform pg_temp.logout();
  assert (select count(*) from private.audit_log a join auth.users u on u.id = a.actor_id
          where u.email = 'finanzas197@yuntera.example' and a.action = 'REFUSED_CODE'
            and a.new_row ->> 'function' = 'return_decision') = 1, 'the refund''s refusal is on the trail';
end $$;

-- ── The customer's own code, typed with other separators ───────────────────

do $$
declare
  v_user uuid := current_setting('t.user_d')::uuid;
  v_text text;
begin
  foreach v_text in array array['6 - 2 - 8 - 4', '6/2/8/4', '6_2_8_4', '6   2   8   4', '6284', '6 2 8 4',
                                '62-84', '6.2.8.4', '٦٢٨٤', '8888-6284', '(6)(2)(8)(4)',
                                -- inside an unbroken longer number, and with wider gaps
                                '88886284', '62848888', '16284', '62841', '6  -  2  -  8  -  4',
                                E'6\n\n2\n\n8\n\n4'] loop
    assert private.mask_shopper_codes('Mi código: ' || v_text || '.', null, v_user) !~ '6.{0,12}2.{0,12}8.{0,12}4'
           and private.mask_shopper_codes('Mi código: ' || v_text || '.', null, v_user) like '%••••%',
      format('%s reaches staff masked: %s', v_text, private.mask_shopper_codes('Mi código: ' || v_text || '.', null, v_user));
  end loop;
  -- The live code written in the decimal digits of other scripts, those
  -- outside the basic plane among them: the guard reads it and the mask
  -- covers it. Each entry is the script's digit zero.
  declare
    v_script text;
    v_zero int;
    v_code text;
    v_masked text;
  begin
    for v_script, v_zero in values
      ('Arabic-Indic', x'0660'::int), ('Devanagari', x'0966'::int), ('Thai', x'0E50'::int),
      ('Tibetan', x'0F20'::int), ('Myanmar', x'1040'::int), ('Khmer', x'17E0'::int),
      ('Mongolian', x'1810'::int), ('Osmanya', x'104A0'::int), ('Brahmi', x'11066'::int),
      ('Chakma', x'11136'::int), ('Sharada', x'111D0'::int), ('Newa', x'11450'::int),
      ('Tirhuta', x'114D0'::int), ('Modi', x'11650'::int), ('Takri', x'116C0'::int),
      ('Ahom', x'11730'::int), ('Mro', x'16A60'::int), ('Pahawh Hmong', x'16B50'::int),
      ('Adlam', x'1E950'::int), ('Nag Mundari', x'1E4F0'::int) loop
      v_code := chr(v_zero + 6) || chr(v_zero + 2) || chr(v_zero + 8) || chr(v_zero + 4);
      assert '6284' = any (private.case_text_numbers('Su código es ' || v_code || '.')),
        format('the guard reads the code in %s digits', v_script);
      v_masked := private.mask_shopper_codes('Mi código: ' || v_code || '.', null, v_user);
      assert v_masked = 'Mi código: ••••.', format('the mask covers the code in %s digits: %s', v_script, v_masked);
    end loop;
    assert char_length(private.foreign_digits()) = 670, 'every Nd digit outside 0-9 (Unicode 15.1)';
  end;
  -- Other numbers stay as written.
  assert private.mask_shopper_codes('Pedido 1234, tel. 8888-1234, del 6 al 28 de abril.', null, v_user)
         = 'Pedido 1234, tel. 8888-1234, del 6 al 28 de abril.', 'nothing else is masked';
end $$;

-- ── A staff text is never masked; the guard reads what the mask reads ──────
-- The outside review of the join found an oracle: a note written as
-- '0/6/5/7 0/6/5/8 …' passed the guard (it read no four-digit number, so it
-- counted and refused nothing), and ops_case then masked the staff's own
-- note with the customer's mask, showing '••••' exactly where a guess was a
-- live code. Now the guard joins digits across the same gaps as the mask,
-- and ops_case shows a staff entry as it was written.

select pg_temp.shopper('notas197@yuntera.example', 'Nora Notas');
insert into public.staff_members (user_id, role)
select id, 'ops' from auth.users where email = 'notas197@yuntera.example';

do $$
declare
  v_case uuid := (select id from private.cases where complaint_id = current_setting('t.complaint')::uuid);
  v_text text;
  v_sweep text;
  v_note bigint;
  v_body text;
  v_refused integer;
begin
  -- Every shape the mask hides, the guard reads as the number.
  foreach v_text in array array['6/2/8/4', '6_2_8_4', '(6)(2)(8)(4)', E'6\n2\n8\n4', E'62\n84',
                                '6 - 2 - 8 - 4', '6 — 2 — 8 — 4', '6:2:8:4'] loop
    assert '6284' = any (private.case_text_numbers(v_text)), format('the guard reads %L', v_text);
  end loop;

  perform pg_temp.act('notas197@yuntera.example');
  -- The live code split by slashes: refused, and on the trail.
  assert public.ops_add_case_note(v_case, 'Probar el 6/2/8/4 en la ruta.') is null,
    'a note with the code split by slashes is refused';
  -- The review's sweep: two hundred guesses in one note are too many numbers.
  select string_agg(regexp_replace(lpad(g::text, 4, '0'), '(.)(.)(.)(.)', '\1/\2/\3/\4'), ' ')
    into v_sweep from generate_series(6200, 6399) g;
  perform pg_temp.refused(format('select public.ops_add_case_note(%L, %L)', v_case, v_sweep), 'too_many_numbers');
  -- A phone that ends in the live code is read whole by the guard (it is
  -- not a guess), so the note is kept, and staff read it as written: no
  -- mask tells its writer that those four digits are a code.
  v_note := public.ops_add_case_note(v_case, 'Llamó desde el 8888-6284, sin respuesta.');
  assert v_note is not null, 'a note with a phone is kept';
  select e ->> 'body' into v_body
  from jsonb_array_elements(public.ops_case(v_case) -> 'entries') e
  where (e ->> 'id')::bigint = v_note;
  assert v_body = 'Llamó desde el 8888-6284, sin respuesta.', format('the staff note as written: %s', v_body);
  assert not exists (select 1 from jsonb_array_elements(public.ops_case(v_case) -> 'entries') e
                     where e ->> 'author' is not null and e ->> 'body' like '%••••%'),
    'no staff entry is ever shown masked';
  perform pg_temp.logout();
  select count(*) into v_refused from private.audit_log a join auth.users u on u.id = a.actor_id
  where u.email = 'notas197@yuntera.example' and a.action = 'REFUSED_CODE';
  assert v_refused = 1, format('one refusal on the trail, not %s', v_refused);
  assert (select sum(k.numbers) from private.case_number_checks k join auth.users u on u.id = k.actor_id
          where u.email = 'notas197@yuntera.example') = 1,
    'the refused slash note counted its number (the phone counts none)';
end $$;

-- A phone that ends in the live code and one that ends in another number
-- give the same answer, the same rows, the same counters and the same text
-- on the case page (decision 61): the guard reads a phone whole, so the
-- writer learns nothing about which four digits are a code. The same holds
-- for every common way to write a phone: with a dash, a space, a dot, in
-- pairs, and after +506 (the second outside check of part 3 found the space,
-- the dot and the pairs split into two numbers, so the live one was refused).
create function pg_temp.note_counts(p_case uuid, p_writer uuid) returns int[]
language sql as $$
  select array[
    (select count(*)::int from private.case_entries where case_id = p_case),
    (select coalesce(sum(numbers), 0)::int from private.case_number_checks where actor_id = p_writer),
    (select count(*)::int from private.audit_log where actor_id = p_writer),
    (select count(*)::int from private.audit_log where actor_id = p_writer and action = 'REFUSED_CODE')]
$$;

do $$
declare
  v_case uuid := (select id from private.cases where complaint_id = current_setting('t.complaint')::uuid);
  v_writer uuid := (select id from auth.users where email = 'notas197@yuntera.example');
  v_text text;
  v_id bigint;
  v_before int[];
  v_after int[];
  v_body text;
  v_kind text;
  v_seen text[] := '{}';
begin
  foreach v_text in array array[
    'Llamar al 8899-6284 mañana temprano.', 'Llamar al 8899-6285 mañana temprano.',
    'Llamar al 8899 6284 mañana temprano.', 'Llamar al 8899 6285 mañana temprano.',
    'Llamar al 8899.6284 mañana temprano.', 'Llamar al 8899.6285 mañana temprano.',
    'Llamar al 88 99 62 84 mañana temprano.', 'Llamar al 88 99 62 85 mañana temprano.',
    'Llamar al 6284 8899 mañana temprano.', 'Llamar al 6285 8899 mañana temprano.',
    'Llamar al +506 88 99 62 84 mañana temprano.', 'Llamar al +506 88 99 62 85 mañana temprano.'] loop
    v_before := pg_temp.note_counts(v_case, v_writer);
    perform pg_temp.act('notas197@yuntera.example');
    v_id := public.ops_add_case_note(v_case, v_text);
    select e ->> 'body' into v_body from jsonb_array_elements(public.ops_case(v_case) -> 'entries') e
    where (e ->> 'id')::bigint = v_id;
    perform pg_temp.logout();
    v_after := pg_temp.note_counts(v_case, v_writer);
    select kind || ' by the writer: ' || (author_id = v_writer)::text into v_kind
    from private.case_entries where id = v_id;
    assert v_body = v_text, format('%s is shown as written: %s', v_text, v_body);
    -- The answer (an id or null), the rows it added, the counters it moved.
    v_seen := v_seen || format('answer %s; %s; entries +%s, numbers +%s, trail +%s, refusals +%s',
      case when v_id is null then 'null' else 'an id' end, v_kind,
      v_after[1] - v_before[1], v_after[2] - v_before[2], v_after[3] - v_before[3], v_after[4] - v_before[4]);
  end loop;
  -- Each pair (the code, another number) gives the same, and every format
  -- gives a kept note with nothing counted.
  for i in 1 .. cardinality(v_seen) loop
    assert v_seen[i] = 'answer an id; note by the writer: true; entries +1, numbers +0, trail +0, refusals +0',
      format('a kept note, nothing counted, the same for the code and another number (text %s): %s', i, v_seen);
  end loop;
  assert cardinality(v_seen) = 12, format('six formats, two numbers each: %s', cardinality(v_seen));
end $$;

-- An answer kept from before 084700 (no author) is still masked.
do $$
declare
  v_case uuid := (select id from private.cases where complaint_id = current_setting('t.complaint')::uuid);
  v_body text;
begin
  insert into private.case_entries (case_id, kind, body) values (v_case, 'answer', 'Su código es 6284.');
  perform pg_temp.act('notas197@yuntera.example');
  select e ->> 'body' into v_body
  from jsonb_array_elements(public.ops_case(v_case) -> 'entries') e
  where e ->> 'author' is null and e ->> 'kind' = 'answer' order by (e ->> 'id')::bigint desc limit 1;
  perform pg_temp.logout();
  assert v_body = 'Su código es ••••.', format('an old answer without an author is masked: %s', v_body);
end $$;

-- ── Atención lists for each role what table 4.1 lets it read ───────────────

do $$
declare
  q jsonb;
  v_role text;
  v_email text;
  v_report uuid;
begin
  perform pg_temp.act('cliente197@yuntera.example');
  v_report := public.report_content('product', (select id from public.products where slug = 'libreta-tapa-dura-a5'),
    'misleading', 'La foto no es la del producto.', null);
  perform pg_temp.logout();
  for v_role, v_email in values ('support', 'soporte197@yuntera.example'), ('ops', 'ops197@yuntera.example'),
                               ('finance', 'finanzas197@yuntera.example'), ('catalog', 'catalogo197@yuntera.example') loop
    perform pg_temp.act(v_email);
    q := public.ops_care_queues();
    -- The complaint is about an order (ops, support); the return is a
    -- payment matter (finance, ops, support); the report a listing (catalog, support).
    assert (q -> 'complaints' @> jsonb_build_array(jsonb_build_object('id', current_setting('t.complaint'))))
           = (v_role in ('support', 'ops')), format('%s and the complaint: %s', v_role, q -> 'complaints');
    assert (q -> 'returns' @> jsonb_build_array(jsonb_build_object('id', current_setting('t.return_b'))))
           = (v_role in ('support', 'ops', 'finance')), format('%s and the return', v_role);
    assert (q -> 'reports' @> jsonb_build_array(jsonb_build_object('id', v_report)))
           = (v_role in ('support', 'catalog')), format('%s and the report', v_role);
    assert q::text !~ 'Refusal', format('%s reads no surname: %s', v_role, q);
    assert (q #>> '{totals,complaints}')::int = jsonb_array_length(q -> 'complaints')
           or jsonb_array_length(q -> 'complaints') = 100, format('%s: the total counts what it lists', v_role);
  end loop;
  perform pg_temp.act('soporte197@yuntera.example');
  assert public.ops_care_queues() -> 'returns' @> jsonb_build_array(jsonb_build_object(
    'id', current_setting('t.return_b'), 'customer', 'Dalia')), 'the customer by first name';
  perform pg_temp.logout();
end $$;

-- ── A locked-out writer still does what puts no typed text on a case ───────
-- The lock-out (three refusals in an hour) stops a person probing with what
-- they type. The actions that write only a fixed system text to a return
-- through the trigger (a cancellation closing the order's open returns, a
-- shopper withdrawing their own return) or no text at all (deciding,
-- receiving and refunding without a note, assigning, reopening) still go
-- through for a locked-out support or ops account. A typed text is still
-- refused, with or without the code, so the lock-out tells nothing.

select pg_temp.shopper('bloqueo197s@yuntera.example', 'Bruno Bloqueado');
select pg_temp.shopper('bloqueo197o@yuntera.example', 'Olga Bloqueada');
insert into public.staff_members (user_id, role)
select u.id, x.role::public.staff_role
from (values ('bloqueo197s@yuntera.example', 'support'), ('bloqueo197o@yuntera.example', 'ops')) x (email, role)
join auth.users u on u.email = x.email;

-- An order of the customer still being prepared, with two open returns (the
-- state the rules before 082900 let through, made here as the owner), and a
-- delivered order of the support writer themself, with a return of theirs.
select pg_temp.remember('order_c', pg_temp.place('cliente197@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:2'), 'card', 'refusal-197-c')::text);
select pg_temp.pay(current_setting('t.order_c')::uuid);
with r as (
  insert into public.return_requests (order_item_id, user_id, kind, quantity, reason, status)
  values (pg_temp.item(current_setting('t.order_c')::uuid, 'libreta-tapa-dura-a5'),
          current_setting('t.user_d')::uuid, 'damaged', 1, 'Primera.', 'requested')
  returning id)
select pg_temp.remember('return_c1', (select id::text from r));
select pg_temp.remember('order_s', pg_temp.place('bloqueo197s@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'refusal-197-s')::text);
select pg_temp.pay(current_setting('t.order_s')::uuid);
select pg_temp.deliver(current_setting('t.order_s')::uuid);

do $$
declare
  v_case uuid := (select id from private.cases where complaint_id = current_setting('t.complaint')::uuid);
  v_email text;
begin
  perform pg_temp.act('bloqueo197s@yuntera.example');
  perform pg_temp.remember('return_s', public.request_return(
    pg_temp.item(current_setting('t.order_s')::uuid, 'libreta-tapa-dura-a5'), 'damaged', 1, 'Se rompió.')::text);
  -- Both writers lock themselves out with three notes holding the live code.
  foreach v_email in array array['bloqueo197s@yuntera.example', 'bloqueo197o@yuntera.example'] loop
    perform pg_temp.act(v_email);
    for i in 1 .. 3 loop
      assert public.ops_add_case_note(v_case, 'Probar el 6284 otra vez.') is null, 'refused';
    end loop;
    perform pg_temp.refused(format('select public.ops_add_case_note(%L, %L)', v_case, 'Nota sin números.'),
      'too_many_refusals');
  end loop;
  perform pg_temp.logout();
end $$;

do $$
declare
  v_counted bigint := (select count(*) from private.case_number_checks k join auth.users u on u.id = k.actor_id
                       where u.email in ('bloqueo197s@yuntera.example', 'bloqueo197o@yuntera.example'));
  v_case uuid;
begin
  -- A text reaching a return through the trigger (no door checked it): one
  -- that holds a number meets the lock-out, code or not (the same answer);
  -- a text without a number cannot hold a code, so it is not refused.
  perform pg_temp.act('bloqueo197o@yuntera.example');
  perform pg_temp.refused(format('update public.return_requests set resolution_note = %L where id = %L',
    'Revisada, el 6284.', current_setting('t.return_c1')), 'too_many_refusals');
  perform pg_temp.refused(format('update public.return_requests set resolution_note = %L where id = %L',
    'Revisada, el 1357.', current_setting('t.return_c1')), 'too_many_refusals');
  update public.return_requests set resolution_note = 'Revisada por bodega.'
  where id = current_setting('t.return_c1')::uuid;

  -- Ops cancels the order: its open return closes with the fixed text.
  assert public.cancel_order(current_setting('t.order_c')::uuid, 'Sin existencias') ->> 'status' in ('cancelled', 'refunded'),
    'a locked-out ops account cancels an order with an open return';
  assert (select status || ' / ' || resolution_note from public.return_requests
          where id = current_setting('t.return_c1')::uuid) = 'rejected / Cerrada: el pedido se canceló.',
    'the open return closed with the fixed text';
  assert (select status from private.cases where return_id = current_setting('t.return_c1')::uuid) = 'closed',
    'and its case closed';

  -- Ops decides and receives a return without a note.
  assert public.ops_decide_return(current_setting('t.return_b')::uuid, true, null), 'approved without a note';
  assert public.ops_receive_return(current_setting('t.return_b')::uuid, true, null), 'received without a note';

  -- Support refunds it, assigns and reopens cases, and withdraws their own return.
  perform pg_temp.act('bloqueo197s@yuntera.example');
  assert (public.ops_complete_return(current_setting('t.return_b')::uuid, null) ->> 'refund_minor')::bigint > 0,
    'refunded without a note';
  v_case := (select id from private.cases where return_id = current_setting('t.return_b')::uuid);
  assert (select status from private.cases where id = v_case) = 'closed', 'the refunded return''s case closed';
  assert public.ops_reopen_case(v_case) ->> 'status' = 'open', 'reopened';
  assert public.ops_assign_case(v_case) is not null, 'assigned';
  assert public.withdraw_return_request(current_setting('t.return_s')::uuid) ->> 'status' = 'rejected',
    'a locked-out staff member withdraws a return of their own';
  -- What they type is still refused, with or without a number.
  perform pg_temp.refused(format('select public.ops_answer_case(%L, %L, false)', v_case,
    'Le escribimos mañana sin falta.'), 'too_many_refusals');
  perform pg_temp.refused(format('select public.ops_answer_case(%L, %L, false)', v_case,
    'Le escribimos por el 6284.'), 'too_many_refusals');
  perform pg_temp.logout();

  assert (select count(*) from private.case_number_checks k join auth.users u on u.id = k.actor_id
          where u.email in ('bloqueo197s@yuntera.example', 'bloqueo197o@yuntera.example')) = v_counted,
    'nothing of this counted a number';
  assert (select count(*) from private.audit_log a join auth.users u on u.id = a.actor_id
          where u.email in ('bloqueo197s@yuntera.example', 'bloqueo197o@yuntera.example')
            and a.action = 'REFUSED_CODE') = 6, 'no refusal was added';
end $$;

select 'ok' as atencion_refusals;
rollback;
