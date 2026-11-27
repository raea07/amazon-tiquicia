-- Wave 9 as one whole: the support desk (084700), system health (084800) and
-- the wave 8 follow-ups (085000) on one database.
--
--   late cases:    for one database state, the health page's cases line, the
--                  "Hoy" line (ops_cases_due) and the clocks of /casos
--                  (ops_cases) count the same late cases, for every role,
--                  over complaints, returns, reports and recorded contacts;
--   who sees what: every staff function of the wave, called as each of the
--                  five staff roles, answers or refuses as the table in
--                  docs/03-data/access-control.md says, and each role gets
--                  its own health lines;
--   the code:      a customer's own live delivery code typed into a
--                  complaint, a return's reason or a report reaches staff
--                  masked (ops_case, ops_care_queues), while the customer's
--                  row keeps their words; another customer's number is not
--                  masked; the four-digit numbers a writer puts in texts
--                  count against one hourly allowance across the case
--                  functions and Atención;
--   deletion:      a deleted account's notes and answers are erased, status
--                  entries keep their status, an open contact closes, and no
--                  note, answer or reopening is accepted afterwards; a former
--                  staff member's answers, saved answers and phone builds
--                  keep a bare id and no name.
--
-- Everything is this suite's own (accounts, orders, cases) and rolls back.

begin;
\ir _helpers.sql
\ir _money_helpers.sql

-- 'ok', or the code a call was refused with.
create function pg_temp.outcome(p_email text, p_sql text) returns text
language plpgsql as $$
begin
  perform pg_temp.act(p_email);
  execute p_sql;
  return 'ok';
exception
  when insufficient_privilege then return 'forbidden';
  when others then return sqlerrm;
end;
$$;

-- ── Fixtures ───────────────────────────────────────────────────────────────

select pg_temp.shopper('cliente196@yuntera.example', 'Dalia Cliente Integra');
select pg_temp.shopper('otro196@yuntera.example', 'Ernesto Otro Cliente');
select pg_temp.shopper('admin196@yuntera.example', 'Adela Administra');
select pg_temp.shopper('soporte196@yuntera.example', 'Sara Soporte');
select pg_temp.shopper('soporte196b@yuntera.example', 'Silvia Soporte Dos');
select pg_temp.shopper('ops196@yuntera.example', 'Omar Operaciones');
select pg_temp.shopper('finanzas196@yuntera.example', 'Flor Finanzas');
select pg_temp.shopper('catalogo196@yuntera.example', 'Ciro Catalogo');
select pg_temp.shopper('exstaff196@yuntera.example', 'Ximena Exsoporte');
insert into public.staff_members (user_id, role)
select u.id, x.role::public.staff_role
from (values ('admin196@yuntera.example', 'admin'), ('soporte196@yuntera.example', 'support'),
             ('soporte196b@yuntera.example', 'support'), ('ops196@yuntera.example', 'ops'),
             ('finanzas196@yuntera.example', 'finance'), ('catalogo196@yuntera.example', 'catalog'),
             ('exstaff196@yuntera.example', 'admin')) x (email, role)
join auth.users u on u.email = x.email;

select pg_temp.remember('order_d', pg_temp.place('cliente196@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'integra-196-d')::text);
select pg_temp.pay(current_setting('t.order_d')::uuid);
select pg_temp.deliver(current_setting('t.order_d')::uuid);
select pg_temp.remember('order_d2', pg_temp.place('cliente196@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'integra-196-d2')::text);
select pg_temp.pay(current_setting('t.order_d2')::uuid);
select pg_temp.remember('order_e', pg_temp.place('otro196@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'integra-196-e')::text);
select pg_temp.pay(current_setting('t.order_e')::uuid);
-- Known codes: the delivered order's is spent, the second order's is live.
update private.delivery_codes set code = '5173' where order_id = current_setting('t.order_d')::uuid;
update private.delivery_codes set code = '6284' where order_id = current_setting('t.order_d2')::uuid;
update private.delivery_codes set code = '7395' where order_id = current_setting('t.order_e')::uuid;
select pg_temp.remember('number_d', (select order_number from public.orders where id = current_setting('t.order_d')::uuid));
select pg_temp.remember('number_d2', (select order_number from public.orders where id = current_setting('t.order_d2')::uuid));
select pg_temp.remember('user_d', (select id::text from auth.users where email = 'cliente196@yuntera.example'));

-- The customer types their own live code (6284) into each of their texts, and
-- the other customer's code (7395), which is not theirs, into the complaint.
do $$
declare
  v_complaint uuid;
  v_return uuid;
  v_report uuid;
begin
  perform pg_temp.act('cliente196@yuntera.example');
  v_complaint := public.file_complaint('payment',
    'Me cobraron dos veces. Mi código de entrega es 6284 y el de mi vecino 7395.', current_setting('t.number_d'));
  v_return := public.request_return(pg_temp.item(current_setting('t.order_d')::uuid, 'libreta-tapa-dura-a5'),
    'damaged', 1, 'Llegó rota. El código 6 2 8 4 no me sirvió.');
  v_report := public.report_content('product',
    (select id from public.products where slug = 'libreta-tapa-dura-a5'), 'misleading',
    'La foto engaña. Por si acaso, mi código es ６２８４.', null);
  perform pg_temp.logout();
  perform pg_temp.remember('complaint', v_complaint::text);
  perform pg_temp.remember('return', v_return::text);
  perform pg_temp.remember('report', v_report::text);
  perform pg_temp.remember('case_complaint', (select id::text from private.cases where complaint_id = v_complaint));
  perform pg_temp.remember('case_return', (select id::text from private.cases where return_id = v_return));
  perform pg_temp.remember('case_report', (select id::text from private.cases where report_id = v_report));
end $$;

-- ── The customer's own code reaches staff masked ───────────────────────────

do $$
declare
  r jsonb;
  q jsonb;
  v text;
begin
  -- What staff read on /casos/[id].
  perform pg_temp.act('soporte196@yuntera.example');
  r := public.ops_case(current_setting('t.case_complaint')::uuid);
  v := r #>> '{request,text}';
  assert v = 'Me cobraron dos veces. Mi código de entrega es •••• y el de mi vecino 7395.',
    format('complaint, as staff read it: %s', v);
  v := public.ops_case(current_setting('t.case_return')::uuid) #>> '{request,text}';
  assert v = 'Llegó rota. El código •••• no me sirvió.', format('return reason, as staff read it: %s', v);
  v := public.ops_case(current_setting('t.case_report')::uuid) #>> '{request,text}';
  assert v = 'La foto engaña. Por si acaso, mi código es ••••.', format('report, as staff read it: %s', v);
  assert public.ops_case(current_setting('t.case_complaint')::uuid)::text !~ '6284',
    'no form of the code anywhere in the case';

  -- What staff read on /atencion.
  q := public.ops_care_queues();
  assert (select e ->> 'description' from jsonb_array_elements(q -> 'complaints') e
          where e ->> 'id' = current_setting('t.complaint'))
         = 'Me cobraron dos veces. Mi código de entrega es •••• y el de mi vecino 7395.',
    'Atención: the complaint is masked';
  assert (select e ->> 'reason' from jsonb_array_elements(q -> 'returns') e
          where e ->> 'id' = current_setting('t.return')) = 'Llegó rota. El código •••• no me sirvió.',
    'Atención: the return reason is masked';
  assert (select e ->> 'details' from jsonb_array_elements(q -> 'reports') e
          where e ->> 'id' = current_setting('t.report')) = 'La foto engaña. Por si acaso, mi código es ••••.',
    'Atención: the report is masked';

  -- The customer's rows keep their words.
  perform pg_temp.logout();
  assert (select description from public.complaints where id = current_setting('t.complaint')::uuid)
         like '%6284%', 'the complaint keeps the customer''s words';
  assert (select reason from public.return_requests where id = current_setting('t.return')::uuid)
         like '%6 2 8 4%', 'the return keeps the customer''s words';

  -- A text without a live code comes back exactly as written (the spent
  -- code of a delivered order is not masked, unless it is the case's own).
  assert private.mask_shopper_codes('Pedido entregado con 5173, tel. 8888-1234.',
           null, current_setting('t.user_d')::uuid)
         = 'Pedido entregado con 5173, tel. 8888-1234.', 'nothing to mask: unchanged';
  -- A live code inside a phone is masked too.
  assert private.mask_shopper_codes('Llámeme al 8888-6284.', null, current_setting('t.user_d')::uuid)
         = 'Llámeme al 8888-••••.', 'a code inside a phone is masked';
end $$;

-- ── One hourly allowance of four-digit numbers, all entry points together ──

do $$
declare
  v_case uuid := current_setting('t.case_complaint')::uuid;
  v_n integer;
begin
  -- 3 notes of 5 numbers each (none a live code): 15 of the 20.
  perform pg_temp.act('soporte196@yuntera.example');
  for i in 0 .. 2 loop
    assert public.ops_add_case_note(v_case,
      format('Revisar %s, %s, %s, %s y %s.', 1100 + i * 5, 1101 + i * 5, 1102 + i * 5, 1103 + i * 5, 1104 + i * 5))
      is not null, format('note %s with five numbers', i);
  end loop;
  -- An answer from Atención with 4 more: 19.
  perform public.ops_resolve_complaint(current_setting('t.complaint')::uuid,
    'Revisamos los cobros 2201, 2202, 2203 y 2204; le devolvemos uno.', false);
  -- One more number anywhere passes (20), the next does not (21), whichever door.
  assert public.ops_add_case_note(v_case, 'El cobro 2205 es el repetido.') is not null, 'the twentieth number';
  perform pg_temp.refused(format('select public.ops_add_case_note(%L, %L)', v_case, 'Y el 2206 también.'),
    'too_many_numbers_hour');
  perform pg_temp.refused(format('select public.ops_resolve_complaint(%L, %L, false)',
    current_setting('t.complaint'), 'El cobro 2207 queda devuelto mañana.'), 'too_many_numbers_hour');
  perform pg_temp.refused(format('select public.ops_answer_case(%L, %L)', v_case,
    'El cobro 2208 queda devuelto mañana.'), 'too_many_numbers_hour');
  -- Texts without four-digit numbers still pass.
  assert public.ops_add_case_note(v_case, 'Sin números esta vez.') is not null, 'a note without numbers';
  -- Another writer has an allowance of their own.
  perform pg_temp.act('soporte196b@yuntera.example');
  assert public.ops_add_case_note(v_case, 'Revisar 3301.') is not null, 'another writer';
  -- Only counts and times are kept, never the numbers.
  select count(*) into v_n from private.case_number_checks k
  join auth.users u on u.id = k.actor_id where u.email = 'soporte196@yuntera.example';
  assert v_n = 5, format('five texts counted: %s', v_n);
  -- After the hour the allowance is back.
  perform pg_temp.logout();
  update private.case_number_checks set at = at - interval '61 minutes'
  where actor_id = (select id from auth.users where email = 'soporte196@yuntera.example');
  perform pg_temp.act('soporte196@yuntera.example');
  assert public.ops_add_case_note(v_case, 'El cobro 2206 también, una hora después.') is not null, 'after the hour';
  perform pg_temp.logout();
end $$;

-- ── Late cases: one answer on /salud, Hoy and /casos ───────────────────────

savepoint late;
do $$
declare
  v_role text;
  v_email text;
  v_health jsonb;
  v_due jsonb;
  v_list jsonb;
  v_line jsonb;
  v_overdue integer;
  v_kinds text;
begin
  -- Only this block's cases are open.
  update private.cases set status = 'closed', resolved_at = now() where status = 'open';
  -- Six open cases of four kinds: late on the first response, late on the
  -- resolution, and on time; and one closed case past its times.
  update private.cases set status = 'open', resolved_at = null, first_response_at = null,
         first_response_due_at = now() - interval '2 hours', due_at = now() + interval '2 days'
  where id = current_setting('t.case_complaint')::uuid;              -- complaint, late (first response)
  update private.cases set status = 'open', resolved_at = null, first_response_at = now() - interval '3 days',
         first_response_due_at = now() - interval '4 days', due_at = now() - interval '1 hour'
  where id = current_setting('t.case_return')::uuid;                 -- return, late (resolution)
  update private.cases set status = 'open', resolved_at = null, first_response_at = null,
         first_response_due_at = now() + interval '1 day', due_at = now() + interval '5 days'
  where id = current_setting('t.case_report')::uuid;                 -- report, on time
  perform pg_temp.act('soporte196@yuntera.example');
  perform pg_temp.remember('contact_late', public.ops_record_contact('whatsapp', 'delivery_today',
    'Pregunta por la hora de entrega.', current_setting('t.number_d2'))::text);
  perform pg_temp.remember('contact_ok', public.ops_record_contact('phone', 'seller',
    'Pregunta por la garantía del vendedor.', current_setting('t.number_d2'))::text);
  perform pg_temp.remember('contact_closed', public.ops_record_contact('email', 'payment',
    'Pregunta por un cobro ya aclarado.', current_setting('t.number_d2'))::text);
  perform pg_temp.logout();
  update private.cases set first_response_due_at = now() - interval '5 minutes'
  where id = current_setting('t.contact_late')::uuid;                -- contact, late (first response)
  update private.cases set first_response_due_at = now() - interval '5 minutes', due_at = now() - interval '1 minute',
         status = 'closed', resolved_at = now()
  where id = current_setting('t.contact_closed')::uuid;              -- closed: never late

  for v_role, v_email in values ('admin', 'admin196@yuntera.example'), ('support', 'soporte196@yuntera.example'),
                               ('ops', 'ops196@yuntera.example'), ('finance', 'finanzas196@yuntera.example'),
                               ('catalog', 'catalogo196@yuntera.example') loop
    perform pg_temp.act(v_email);
    v_due := public.ops_cases_due();
    v_list := public.ops_cases('open', 200, 0);
    assert (v_list ->> 'total')::int <= 200, 'every open case is in the list';
    select count(*) into v_overdue from jsonb_array_elements(v_list -> 'cases') e where e ->> 'clock' = 'overdue';
    assert (v_due ->> 'overdue')::int = v_overdue,
      format('%s: Hoy says %s late, Casos %s', v_role, v_due ->> 'overdue', v_overdue);
    v_health := public.ops_system_health();
    select e into v_line from jsonb_array_elements(v_health -> 'lines') e where e ->> 'key' = 'cases_late';
    if v_role in ('admin', 'support') then
      assert (v_line ->> 'count')::int = v_overdue,
        format('%s: Salud says %s late, Casos %s', v_role, v_line ->> 'count', v_overdue);
      assert v_overdue = 3, format('%s: three late cases of three kinds, %s', v_role, v_overdue);
      select string_agg(e ->> 'kind', ',' order by e ->> 'kind') into v_kinds
      from jsonb_array_elements(v_list -> 'cases') e where e ->> 'clock' = 'overdue';
      assert v_kinds = 'complaint,contact,return', format('%s: the late kinds, %s', v_role, v_kinds);
      assert v_line ->> 'state' = 'problem' and (v_line #>> '{parts,past_resolution}')::int = 1
             and (v_line #>> '{parts,past_first_response}')::int = 2,
        format('%s: one past its resolution, two past the first response: %s', v_role, v_line);
      assert v_line -> 'refs' ? current_setting('t.number_d') and v_line -> 'refs' ? current_setting('t.number_d2'),
        format('%s: the line names the orders, %s', v_role, v_line -> 'refs');
      assert v_line::text !~ 'cobraron|hora de entrega', 'the line carries no case text';
    else
      assert v_line is null, format('%s: no cases line on Salud', v_role);
    end if;
    -- What each role reads of the late ones (table 4.1).
    assert v_overdue = case v_role when 'ops' then 3 when 'finance' then 2 when 'catalog' then 0 else 3 end,
      format('%s reads %s late cases', v_role, v_overdue);
  end loop;
  perform pg_temp.logout();
end $$;
rollback to savepoint late;

-- ── Who sees what: every staff function of the wave, as each role ──────────

savepoint roles;
do $$
declare
  v_case text := current_setting('t.case_complaint');      -- area payment, with an order
  v_report text := current_setting('t.case_report');       -- area listing, no order
  v_user text := current_setting('t.user_d');
  v_number text := current_setting('t.number_d');
  r record;
  v_got text;
  v_wrong text := '';
begin
  for r in
    select x.fn, x.sql, e.role, e.email, e.expected
    from (values
      ('ops_cases', 'select public.ops_cases()', 'ok,ok,ok,ok,ok'),
      ('ops_cases_due', 'select public.ops_cases_due()', 'ok,ok,ok,ok,ok'),
      ('ops_case (payment)', format('select public.ops_case(%L)', v_case), 'ok,ok,ok,ok,case_not_found'),
      ('ops_case (listing)', format('select public.ops_case(%L)', v_report),
       'ok,ok,case_not_found,case_not_found,ok'),
      ('ops_add_case_note', format('select public.ops_add_case_note(%L, %L)', v_case, 'Nota de la tabla de roles.'),
       'ok,ok,ok,ok,forbidden'),
      ('ops_assign_case', format('select public.ops_assign_case(%L)', v_case), 'ok,ok,forbidden,forbidden,forbidden'),
      ('ops_answer_case', format('select public.ops_answer_case(%L, %L)', v_case, 'Respuesta de la tabla de roles.'),
       'ok,ok,forbidden,forbidden,forbidden'),
      ('ops_reopen_case', format('select public.ops_reopen_case(%L)', v_case),
       'case_open,case_open,forbidden,forbidden,forbidden'),
      ('ops_record_contact', format('select public.ops_record_contact(%L, %L, %L, %L)', 'phone', 'other',
        'Consulta de la tabla de roles.', v_number), 'ok,ok,forbidden,forbidden,forbidden'),
      ('ops_order_cases', format('select public.ops_order_cases(%L)', v_number), 'ok,ok,ok,ok,forbidden'),
      ('ops_case_report', 'select public.ops_case_report(current_date - 30, current_date + 1)',
       'ok,ok,forbidden,forbidden,forbidden'),
      ('ops_case_targets', 'select public.ops_case_targets()', 'ok,ok,forbidden,forbidden,forbidden'),
      ('ops_saved_replies', 'select public.ops_saved_replies()', 'ok,ok,forbidden,forbidden,forbidden'),
      ('ops_save_reply', 'select public.ops_save_reply(''Prueba 196 '' || gen_random_uuid(), ''Una respuesta guardada de prueba.'')',
       'ok,forbidden,forbidden,forbidden,forbidden'),
      ('ops_customer', format('select public.ops_customer(%L)', v_user), 'ok,ok,ok,ok,forbidden'),
      ('ops_customer_contact', format('select public.ops_customer_contact(%L, %L)', v_user,
        'Para confirmar la entrega por teléfono.'), 'ok,ok,forbidden,forbidden,forbidden'),
      ('ops_care_queues', 'select public.ops_care_queues()', 'ok,ok,ok,ok,ok'),
      ('ops_resolve_complaint', format('select public.ops_resolve_complaint(%L, %L, false)',
        current_setting('t.complaint'), 'Respuesta desde Atención, tabla de roles.'), 'ok,ok,ok,forbidden,forbidden'),
      ('ops_system_health', 'select public.ops_system_health()', 'ok,ok,ok,ok,ok'),
      ('ops_versions', 'select public.ops_versions()', 'ok,forbidden,forbidden,forbidden,forbidden'),
      ('ops_set_store_build', 'select public.ops_set_store_build(''warehouse'', ''ios'', ''999.999.996'', 999999996, current_date, ''internal'')',
       'ok,forbidden,forbidden,forbidden,forbidden')
    ) x (fn, sql, expected_all)
    cross join lateral (
      select y.role, y.email, split_part(x.expected_all, ',', y.n) as expected
      from (values (1, 'admin', 'admin196@yuntera.example'), (2, 'support', 'soporte196@yuntera.example'),
                   (3, 'ops', 'ops196@yuntera.example'), (4, 'finance', 'finanzas196@yuntera.example'),
                   (5, 'catalog', 'catalogo196@yuntera.example')) y (n, role, email)
    ) e
  loop
    v_got := pg_temp.outcome(r.email, r.sql);
    if v_got is distinct from r.expected then
      v_wrong := v_wrong || format(E'\n  %s as %s: expected %s, got %s', r.fn, r.role, r.expected, v_got);
    end if;
  end loop;
  perform pg_temp.logout();
  assert v_wrong = '', format('the role table does not hold:%s', v_wrong);
end $$;

-- Each role's health lines.
do $$
declare
  v_role text;
  v_email text;
  v_keys text;
  v_expected text;
begin
  for v_role, v_email, v_expected in values
    ('admin', 'admin196@yuntera.example', 'cases_late,events_failed,invoice_certificate,invoices,jobs,messages_late,'
      'messages_stopped,orders_not_released,orders_unpaid_overdue,payments_failed,payments_worker,refunds_failed,'
      'routes_open,sign_ins_failed'),
    ('support', 'soporte196@yuntera.example', 'cases_late,events_failed,messages_late,messages_stopped'),
    ('ops', 'ops196@yuntera.example', 'jobs,orders_not_released,orders_unpaid_overdue,routes_open'),
    ('finance', 'finanzas196@yuntera.example', 'invoice_certificate,invoices,payments_failed,payments_worker,refunds_failed'),
    ('catalog', 'catalogo196@yuntera.example', '') loop
    perform pg_temp.act(v_email);
    select coalesce(string_agg(e ->> 'key', ',' order by e ->> 'key'), '') into v_keys
    from jsonb_array_elements(public.ops_system_health() -> 'lines') e;
    assert v_keys = v_expected, format('%s health lines: %s', v_role, v_keys);
  end loop;
  perform pg_temp.logout();
end $$;
rollback to savepoint roles;

-- ── Account deletion across the wave ───────────────────────────────────────

do $$
declare
  v_contact uuid;
  v_build uuid;
  v_user uuid := current_setting('t.user_d')::uuid;
  v_ex uuid := (select id from auth.users where email = 'exstaff196@yuntera.example');
  r jsonb;
begin
  -- A former administrator wrote an answer, a saved answer and a phone build.
  perform pg_temp.act('exstaff196@yuntera.example');
  perform public.ops_answer_case(current_setting('t.case_report')::uuid, 'Revisamos la foto del producto.', false);
  perform public.ops_save_reply('Respuesta 196 de una exempleada', 'Gracias por escribirnos, lo revisamos.');
  v_build := (public.ops_set_store_build('seller', 'android', '999.999.995', 999999995, current_date, 'internal') ->> 'id')::uuid;
  -- Staff answer and note the customer's cases; a contact stays open.
  perform pg_temp.act('soporte196b@yuntera.example');
  perform public.ops_add_case_note(current_setting('t.case_return')::uuid, 'Dalia pidió que la llamemos.');
  v_contact := public.ops_record_contact('whatsapp', 'other', 'Dalia pregunta por su factura.',
    current_setting('t.number_d'));
  perform public.ops_add_case_note(v_contact, 'Le explicamos dónde ver la factura.');
  perform public.ops_resolve_complaint(current_setting('t.complaint')::uuid, 'Le devolvimos el cobro repetido.', true);
  perform public.ops_decide_return(current_setting('t.return')::uuid, false, 'No vemos daño en las fotos, Dalia.');
  perform pg_temp.logout();

  -- The customer's open order would hold the deletion back: it is delivered.
  perform pg_temp.deliver(current_setting('t.order_d2')::uuid);
  perform pg_temp.act('cliente196@yuntera.example');
  perform public.delete_my_account();
  perform pg_temp.logout();

  -- Notes and answers erased; a status entry keeps its status; summaries erased.
  assert not exists (select 1 from private.case_entries e join private.cases c on c.id = e.case_id
                     where c.user_id = v_user and e.kind in ('note', 'answer')
                       and e.body is distinct from private.erased_case_text()),
    'every note and answer of the account erased';
  assert exists (select 1 from private.case_entries e
                 where e.case_id = current_setting('t.case_return')::uuid and e.kind = 'status' and e.body = 'rejected'),
    'a status entry keeps its status';
  assert (select summary from private.cases where id = v_contact) = private.erased_case_text(), 'summary erased';
  assert (select status from private.cases where id = v_contact) = 'closed', 'the open contact closed';
  -- Nothing new is written on the account's cases.
  perform pg_temp.act('soporte196@yuntera.example');
  perform pg_temp.refused(format('select public.ops_add_case_note(%L, %L)', v_contact, 'Otra nota más.'),
    'case_account_deleted');
  perform pg_temp.refused(format('select public.ops_reopen_case(%L)', v_contact), 'case_account_deleted');
  perform pg_temp.refused(format('select public.ops_record_contact(%L, %L, %L, %L)', 'phone', 'other',
    'Llamó alguien por este pedido.', current_setting('t.number_d')), 'case_account_deleted');
  r := public.ops_case(v_contact);
  assert not (r #>> '{can,note}')::boolean and not (r #>> '{can,reopen}')::boolean,
    format('the case page offers nothing to write: %s', r -> 'can');
  perform pg_temp.logout();

  -- The former administrator leaves (an inactive staff row does not hold a
  -- deletion back). What they wrote stays, with a bare id and no name.
  update public.staff_members set active = false where user_id = v_ex;
  perform pg_temp.act('exstaff196@yuntera.example');
  perform public.delete_my_account();
  perform pg_temp.logout();
  assert (select count(*) from private.case_entries where author_id = v_ex and kind = 'answer') = 1,
    'their answer stays';
  assert exists (select 1 from private.saved_replies where updated_by = v_ex), 'their saved answer stays';
  assert (select recorded_by from private.store_builds where id = v_build) = v_ex, 'their phone build keeps a bare id';
  perform pg_temp.act('soporte196@yuntera.example');
  r := public.ops_case(current_setting('t.case_report')::uuid);
  assert (select e ->> 'author' from jsonb_array_elements(r -> 'entries') e where e ->> 'kind' = 'answer') is null,
    format('the answer names no one: %s', r -> 'entries');
  perform pg_temp.act('admin196@yuntera.example');
  assert public.ops_versions()::text !~ 'Ximena|Exsoporte', 'Versiones names no one';
  assert not exists (select 1 from private.audit_log a where a.table_name = 'store_builds'
                     and (a.old_row::text ~ 'Ximena' or a.new_row::text ~ 'Ximena')),
    'the trail of the phone build names no one';
  perform pg_temp.logout();
end $$;

select 'ok' as wave9_integration;
rollback;
