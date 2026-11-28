-- The delivery phone only on request (owner decision D55, 27 November 2026;
-- 20261121085000_wave8_followups.sql, point 6: public.get_order and
-- public.ops_order_contact).
--
--   the order:    get_order gives the recipient's phone to the order's own
--                 shopper only; to every staff role it is '' (a string, as
--                 the console of 12ec48c parses it), and nothing else of the
--                 address changes;
--   right caller: support, operations and administrators read the phone of
--                 any order with ops_order_contact and a reason of 10 to 300
--                 characters;
--   wrong caller: finance, catalogue staff, the order's own shopper, another
--                 shopper, a seller and a visitor are refused 'forbidden',
--                 whether the order exists or not; a missing or short reason
--                 is 'reason_required'; an unknown order 'order_not_found';
--   left behind:  one VIEW_CONTACT row per look on the audit trail, with the
--                 order, the actor and the reason and never the phone; a
--                 refused look leaves no row; an order whose account was
--                 deleted answers no phone.

begin;
\ir _helpers.sql
\ir _money_helpers.sql

create function pg_temp.outcome(p_email text, p_sql text) returns text
language plpgsql as $$
begin
  if p_email is null then
    perform pg_temp.logout();
  else
    perform pg_temp.act(p_email);
  end if;
  execute p_sql;
  return 'ok';
exception
  when insufficient_privilege then return 'forbidden';
  when others then return sqlerrm;
end;
$$;

-- ── Fixtures ───────────────────────────────────────────────────────────────

select pg_temp.shopper('cliente199@yuntera.example', 'Delia Cliente Contacto');
select pg_temp.shopper('otro199@yuntera.example', 'Ernesto Otro Cliente');
select pg_temp.shopper('admin199@yuntera.example', 'Adela Administra');
select pg_temp.shopper('soporte199@yuntera.example', 'Sara Soporte');
select pg_temp.shopper('ops199@yuntera.example', 'Omar Operaciones');
select pg_temp.shopper('finanzas199@yuntera.example', 'Flor Finanzas');
select pg_temp.shopper('catalogo199@yuntera.example', 'Camilo Catálogo');
insert into public.staff_members (user_id, role)
select u.id, x.role::public.staff_role
from (values ('admin199@yuntera.example', 'admin'), ('soporte199@yuntera.example', 'support'),
             ('ops199@yuntera.example', 'ops'), ('finanzas199@yuntera.example', 'finance'),
             ('catalogo199@yuntera.example', 'catalog')) x (email, role)
join auth.users u on u.email = x.email;

select pg_temp.remember('order', pg_temp.place('cliente199@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'contacto-199')::text);
select pg_temp.pay(current_setting('t.order')::uuid);
-- A phone of its own, so the checks below can look for it anywhere.
update public.orders set ship_phone = '+50687776655' where id = current_setting('t.order')::uuid;
select pg_temp.remember('number', (select order_number from public.orders where id = current_setting('t.order')::uuid));

-- ── The order page's answer ────────────────────────────────────────────────

do $$
declare
  v_number text := current_setting('t.number');
  v_email text;
  v_order jsonb;
begin
  perform pg_temp.act('cliente199@yuntera.example');
  v_order := public.get_order(v_number);
  assert v_order -> 'address' ->> 'phone' = '+50687776655', 'the shopper reads their own delivery phone';

  foreach v_email in array array['admin199@yuntera.example', 'soporte199@yuntera.example',
                                 'ops199@yuntera.example', 'finanzas199@yuntera.example'] loop
    perform pg_temp.act(v_email);
    v_order := public.get_order(v_number);
    assert v_order -> 'address' ->> 'phone' = '',
      format('%s reads no phone on the order: %s', v_email, v_order -> 'address' ->> 'phone');
    assert jsonb_typeof(v_order -> 'address' -> 'phone') = 'string',
      'the phone is still a string, as the console of 12ec48c parses it';
    assert v_order::text not like '%87776655%', format('%s: the phone is nowhere in the answer', v_email);
    assert v_order -> 'address' ->> 'recipient_name' = 'Delia Cliente Contacto'
           and v_order -> 'address' ->> 'senas' is not null
           and v_order -> 'address' ->> 'district' is not null,
      format('%s still reads the recipient, the señas and the district', v_email);
  end loop;
  perform pg_temp.logout();
end $$;

-- ── Who may look ───────────────────────────────────────────────────────────

do $$
declare
  v_number text := current_setting('t.number');
  v_reason text := 'Llamar por la entrega de hoy, no contesta.';
  r record;
  v_got text;
  v_wrong text := '';
  v_before integer := (select count(*) from private.audit_log where action = 'VIEW_CONTACT');
begin
  for r in
    select * from (values
      ('admin199@yuntera.example', format('select public.ops_order_contact(%L, %L)', v_number, v_reason), 'ok'),
      ('soporte199@yuntera.example', format('select public.ops_order_contact(%L, %L)', v_number, v_reason), 'ok'),
      ('ops199@yuntera.example', format('select public.ops_order_contact(%L, %L)', v_number, v_reason), 'ok'),
      ('finanzas199@yuntera.example', format('select public.ops_order_contact(%L, %L)', v_number, v_reason), 'forbidden'),
      ('catalogo199@yuntera.example', format('select public.ops_order_contact(%L, %L)', v_number, v_reason), 'forbidden'),
      ('cliente199@yuntera.example', format('select public.ops_order_contact(%L, %L)', v_number, v_reason), 'forbidden'),
      ('otro199@yuntera.example', format('select public.ops_order_contact(%L, %L)', v_number, v_reason), 'forbidden'),
      ('sendero@yuntera.example', format('select public.ops_order_contact(%L, %L)', v_number, v_reason), 'forbidden'),
      (null, format('select public.ops_order_contact(%L, %L)', v_number, v_reason), 'forbidden'),
      -- The same answer for an order that does not exist.
      ('finanzas199@yuntera.example', format('select public.ops_order_contact(%L, %L)', 'YT-999999999', v_reason), 'forbidden'),
      ('otro199@yuntera.example', format('select public.ops_order_contact(%L, %L)', 'YT-999999999', v_reason), 'forbidden'),
      (null, format('select public.ops_order_contact(%L, %L)', 'YT-999999999', v_reason), 'forbidden'),
      ('soporte199@yuntera.example', format('select public.ops_order_contact(%L, %L)', 'YT-999999999', v_reason), 'order_not_found'),
      -- A reason is required: missing, empty, spaces, nine characters, 301 characters,
      -- and white space of any kind (line breaks, tabs, wide spaces) is not a reason.
      ('soporte199@yuntera.example', format('select public.ops_order_contact(%L, %L)', v_number, repeat(E'\n', 11)), 'reason_required'),
      ('ops199@yuntera.example', format('select public.ops_order_contact(%L, %L)', v_number, repeat(E'\t', 11)), 'reason_required'),
      ('admin199@yuntera.example', format('select public.ops_order_contact(%L, %L)', v_number, E'\r\n\t \u00a0\u2003\u3000\ufeff\u2028\u000b\f'), 'reason_required'),
      ('ops199@yuntera.example', format('select public.ops_order_contact(%L, %L)', v_number, E'\n\t Llamarlo.\n\t '), 'reason_required'),
      ('soporte199@yuntera.example', format('select public.ops_order_contact(%L, null)', v_number), 'reason_required'),
      ('ops199@yuntera.example', format('select public.ops_order_contact(%L, %L)', v_number, ''), 'reason_required'),
      ('ops199@yuntera.example', format('select public.ops_order_contact(%L, %L)', v_number, '           '), 'reason_required'),
      ('admin199@yuntera.example', format('select public.ops_order_contact(%L, %L)', v_number, 'Llamarlo.'), 'reason_required'),
      ('soporte199@yuntera.example', format('select public.ops_order_contact(%L, %L)', v_number, repeat('a', 301)), 'reason_required')
    ) x (email, sql, expected)
  loop
    v_got := pg_temp.outcome(r.email, r.sql);
    if v_got is distinct from r.expected then
      v_wrong := v_wrong || format(E'\n  %s: expected %s, got %s', coalesce(r.email, 'a visitor'), r.expected, v_got);
    end if;
  end loop;
  perform pg_temp.logout();
  assert v_wrong = '', format('the callers do not hold:%s', v_wrong);
  -- Three looks went through (admin, support, ops); every refusal left nothing.
  assert (select count(*) from private.audit_log where action = 'VIEW_CONTACT') = v_before + 3,
    'one audit row per look, none for a refused one';
end $$;

-- ── What a look answers and leaves ─────────────────────────────────────────

do $$
declare
  v_number text := current_setting('t.number');
  v_order uuid := current_setting('t.order')::uuid;
  v_ops uuid := (select id from auth.users where email = 'ops199@yuntera.example');
  v_answer jsonb;
  v_row private.audit_log%rowtype;
begin
  perform pg_temp.act('ops199@yuntera.example');
  v_answer := public.ops_order_contact(v_number, '  Avisar que el repartidor va tarde.  ');
  perform pg_temp.logout();
  assert v_answer = jsonb_build_object('order_number', v_number, 'phone', '+50687776655'),
    format('the look answers the order and its phone: %s', v_answer);

  select * into v_row from private.audit_log where action = 'VIEW_CONTACT' order by id desc limit 1;
  assert v_row.actor_id = v_ops, 'the row names the actor';
  assert v_row.table_name = 'orders' and v_row.row_key = v_order::text, 'the row names the order';
  assert v_row.old_row is null
         and v_row.new_row = jsonb_build_object('order_number', v_number,
                                                'reason', 'Avisar que el repartidor va tarde.'),
    format('the row holds the order number and the trimmed reason, nothing else: %s', v_row.new_row);
  assert not exists (select 1 from private.audit_log a
                     where a.action = 'VIEW_CONTACT' and (a.new_row::text like '%87776655%'
                                                          or a.row_key like '%87776655%')),
    'no audit row holds the phone';

  -- Administrators read the trail with the actor's name and the reason.
  perform pg_temp.act('admin199@yuntera.example');
  assert exists (select 1 from public.audit_entries('orders', 50) e
                 where e.action = 'VIEW_CONTACT' and e.actor_name = 'Omar Operaciones'
                   and e.new_row ->> 'order_number' = v_number),
    'Auditoría lists the look';
  perform pg_temp.logout();

  -- An order whose account was deleted keeps no phone, and answers none.
  update public.orders set ship_phone = '' where id = v_order;
  perform pg_temp.act('soporte199@yuntera.example');
  v_answer := public.ops_order_contact(v_number, 'Llamar por la entrega de hoy.');
  perform pg_temp.logout();
  assert v_answer -> 'phone' = 'null'::jsonb, format('no phone left: %s', v_answer);
end $$;

-- ── Grants ─────────────────────────────────────────────────────────────────

do $$
begin
  assert not has_function_privilege('anon', 'public.ops_order_contact(text, text)', 'execute'),
    'visitors cannot call ops_order_contact';
  assert has_function_privilege('authenticated', 'public.ops_order_contact(text, text)', 'execute'),
    'signed-in users can call it (the function checks the role)';
  assert (select p.prosecdef and p.proconfig = array['search_path=""']
          from pg_proc p where p.oid = 'public.ops_order_contact(text, text)'::regprocedure),
    'security definer with an empty search path';
end $$;

select 'ok' as order_contact;
rollback;
