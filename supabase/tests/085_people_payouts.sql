-- People management and seller payouts. Each function is checked for the right
-- caller, the wrong callers (a shopper, another seller, staff of the wrong
-- role) and what it leaves behind.

begin;
\ir _helpers.sql
\ir _money_helpers.sql
-- An open payout run of a used database is set aside (_helpers.sql).
select pg_temp.set_aside_payout_runs();
select pg_temp.remember('tecnocasa_payouts_before', (select count(*)::text from public.payouts p
  join public.sellers x on x.id = p.seller_id where x.slug = 'tecnocasa'));
select pg_temp.allow_inspection();

select pg_temp.remember('tecnocasa', (select id::text from public.sellers where slug = 'tecnocasa'));
select pg_temp.remember('cafetal', (select id::text from public.sellers where slug = 'cafetal-los-santos'));
select pg_temp.remember('sendero', (select id::text from public.sellers where slug = 'tienda-sendero'));
select pg_temp.remember('ferreteria', (select id::text from public.sellers where slug = 'ferreteria-el-higueron'));
select pg_temp.remember('depot', (select id::text from public.warehouses where code = 'SJO1'));
select pg_temp.remember('seller_site', (select id::text from public.warehouses where code = 'HIG-HER'));
select pg_temp.remember('today', private.cr_local(now())::date::text);
select pg_temp.remember('users_before', (select count(*)::text from auth.users));
-- What a database that has been used already holds (staff added, payout runs
-- made, requests waiting): the assertions below count from here, not from an
-- empty database.
select pg_temp.remember('staff_before', (select count(*)::text from public.staff_members));
select pg_temp.remember('staff_audit_before', (
  select count(*)::text from private.audit_log l
  where l.table_name = 'staff_members'
    and l.actor_id = (select id from auth.users where email = 'central@yuntera.example')));
select pg_temp.remember('depot_staff_before', (
  select count(*)::text from public.warehouse_staff
  where warehouse_id = (select id from public.warehouses where code = 'SJO1')));
select pg_temp.remember('requests_waiting_before', (
  select count(*)::text from public.payout_detail_requests where status = 'pending'));
select pg_temp.remember('audit_id_before', (select coalesce(max(id), 0)::text from private.audit_log));
select pg_temp.remember('runs_before', (select count(*)::text from public.payout_runs));
select pg_temp.remember('payouts_before', (select count(*)::text from public.payouts));
select pg_temp.remember('payout_tx_before', (
  select count(*)::text from public.ledger_transactions where kind = 'payout'));

-- The three parts of every seller's balance add up to what the ledger says the
-- platform owes them, which is also what the seller centre's summary shows.
-- Called after every step that moves money. (Runs as the test's superuser and
-- borrows an administrator's identity for the one call that needs a caller.)
create function pg_temp.check_balances(p_label text) returns void
language plpgsql as $$
declare
  b record;
  v_ledger bigint;
  v_claims text := current_setting('request.jwt.claims', true);
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', (select user_id from public.staff_members where role = 'admin' and active limit 1),
    'role', 'authenticated', 'aal', 'aal2')::text, true);
  for b in
    select s.slug, x.*
    from private.seller_balances(private.cr_local(now())::date, private.payout_hold_days()) x
    join public.sellers s on s.id = x.seller_id
  loop
    select coalesce(-sum(e.amount_minor), 0) into v_ledger
    from public.ledger_entries e join public.ledger_accounts a on a.id = e.account_id
    where a.seller_id = b.seller_id;
    assert b.available_minor + b.pending_minor + b.in_transit_minor = v_ledger,
      format('%s — %s: %s available + %s pending + %s in transit is not the ledger''s %s',
             p_label, b.slug, b.available_minor, b.pending_minor, b.in_transit_minor, v_ledger);
    assert b.payable_minor = v_ledger, format('%s — %s: payable', p_label, b.slug);
    assert (public.seller_overview(b.seller_id) ->> 'payable_minor')::bigint = v_ledger,
      format('%s — %s: the seller centre''s summary disagrees', p_label, b.slug);
    assert (public.seller_payouts(b.seller_id) ->> 'payable_minor')::bigint = v_ledger
       and (public.seller_payouts(b.seller_id) ->> 'available_minor')::bigint = b.available_minor,
      format('%s — %s: the seller''s money screen disagrees', p_label, b.slug);
  end loop;
  assert (select coalesce(sum(amount_minor), 0) from public.ledger_entries) = 0,
    format('%s: the ledger does not sum to zero', p_label);
  assert not exists (
    select 1 from public.ledger_entries group by transaction_id having sum(amount_minor) <> 0
  ), format('%s: a transaction is out of balance', p_label);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
end;
$$;

-- Payouts, requests and whole account numbers can no longer be read from their
-- tables by any API role, so a test acting as a user cannot look at them
-- either. This reads one value as the database owner, for assertions only. It
-- exists inside this test's transaction and is rolled back with it.
create schema probe;
create function probe.value(p_sql text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v text;
begin
  execute p_sql into v;
  return v;
end;
$$;
grant usage on schema probe to authenticated;
grant execute on function probe.value(text) to authenticated;

select pg_temp.check_balances('seed');

-- ═══ Staff ═════════════════════════════════════════════════════════════════

-- Nobody but an administrator: a shopper, a seller, a driver.
do $$
declare
  v_email text;
  t record;
begin
  foreach v_email in array array[
    'comprador@yuntera.example', 'vendedor@yuntera.example', 'repartidor@yuntera.example'
  ] loop
    perform set_config('request.jwt.claims', json_build_object(
      'sub', (select id from auth.users where email = v_email), 'role', 'authenticated', 'aal', 'aal2')::text, true);
    set local role authenticated;
    for t in select * from (values
      ('select public.ops_staff()'),
      ('select public.ops_set_staff(''comprador2@yuntera.example'', ''admin'', true)'),
      ('select public.ops_set_staff(''central@yuntera.example'', ''admin'', false)')
    ) v (stmt) loop
      begin
        execute t.stmt;
        raise exception 'accepted';
      exception when others then
        if sqlerrm <> 'forbidden' then
          raise exception '% as %: % (expected forbidden)', t.stmt, v_email, sqlerrm;
        end if;
      end;
    end loop;
    reset role;
  end loop;
end
$$;

select pg_temp.login('central@yuntera.example');
do $$
declare
  s jsonb := public.ops_staff();
begin
  assert jsonb_array_length(s) = current_setting('t.staff_before')::integer, 'every staff member is listed';
  assert exists (
    select 1 from jsonb_array_elements(s) x
    where x ->> 'email' = 'central@yuntera.example' and x ->> 'role' = 'admin'
      and (x ->> 'active')::boolean and (x ->> 'is_you')::boolean
      and x ->> 'full_name' = 'Gabriela Soto Marín' and x ->> 'since' is not null),
    format('name, e-mail, role, active, since: %s', s);

  -- An e-mail with no account is refused, and no account is made for it.
  begin
    perform public.ops_set_staff('nadie@yuntera.example', 'support', true);
    raise exception 'gave a role to an e-mail with no account';
  exception when others then
    if sqlerrm <> 'account_not_found' then raise; end if;
  end;

  -- Someone who is not staff cannot be "deactivated".
  begin
    perform public.ops_set_staff('comprador2@yuntera.example', 'support', false);
    raise exception 'deactivated someone who is not staff';
  exception when others then
    if sqlerrm <> 'staff_not_found' then raise; end if;
  end;

  -- The e-mail is matched whatever its case or the spaces around it.
  perform public.ops_set_staff('  Comprador2@Yuntera.Example ', 'support', true);
  s := public.ops_staff();
  assert jsonb_array_length(s) = current_setting('t.staff_before')::integer + 1, 'the new staff member is listed';
  assert exists (
    select 1 from jsonb_array_elements(s) x
    where x ->> 'email' = 'comprador2@yuntera.example' and x ->> 'role' = 'support'
      and (x ->> 'active')::boolean and x ->> 'full_name' = 'Andrés Mora Chaves'
      and not (x ->> 'is_you')::boolean
  ), 'with their name and role';
end
$$;
reset role;

do $$
begin
  assert (select count(*) from auth.users) = current_setting('t.users_before')::bigint,
    'no account was created for the unknown e-mail';
end
$$;

-- The new role works at once, and only as far as that role goes.
select pg_temp.login('comprador2@yuntera.example');
do $$
begin
  assert public.my_roles() ->> 'staff_role' = 'support', 'the console now lets them in';
  perform public.ops_care_queues();
  begin
    perform public.ops_payout_preview();
    raise exception 'support staff previewed payouts';
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
  -- Staff of the wrong role cannot manage staff.
  begin
    perform public.ops_staff();
    raise exception 'support staff listed the staff';
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
  begin
    perform public.ops_set_staff('comprador2@yuntera.example', 'admin', true);
    raise exception 'support staff promoted themselves';
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
end
$$;
reset role;

select pg_temp.login('central@yuntera.example');
select public.ops_set_staff('comprador2@yuntera.example', 'finance', true);
reset role;

select pg_temp.login('comprador2@yuntera.example');
do $$
begin
  assert public.ops_payout_preview() ->> 'cutoff_on' = current_setting('t.today'),
    'a change of role applies to the next request';
end
$$;
reset role;

-- Deactivated: refused immediately, with the very same session.
select pg_temp.login('central@yuntera.example');
select public.ops_set_staff('comprador2@yuntera.example', 'finance', false);
reset role;

select pg_temp.login('comprador2@yuntera.example');
do $$
begin
  assert public.my_roles() ->> 'staff_role' is null, 'the console no longer lets them in';
  begin
    perform public.ops_payout_preview();
    raise exception 'a deactivated staff member previewed payouts';
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
  begin
    perform public.ops_care_queues();
    raise exception 'a deactivated staff member read the care queues';
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
  assert (select count(*) from public.orders) = (select count(*) from public.orders where user_id = auth.uid()),
    'and reads tables as an ordinary shopper again';
end
$$;
reset role;

-- The platform always keeps one active administrator.
select pg_temp.login('central@yuntera.example');
do $$
declare
  t record;
begin
  for t in select * from (values
    ('select public.ops_set_staff(''central@yuntera.example'', ''admin'', false)'),
    ('select public.ops_set_staff(''central@yuntera.example'', ''ops'', true)'),
    -- The rule is on the table, so a write that does not go through the
    -- function cannot get round it either. The API roles cannot write the
    -- table at all; these run as its owner, with the administrator's identity.
    ('set local role postgres; update public.staff_members set active = false where role = ''admin'''),
    ('set local role postgres; delete from public.staff_members where role = ''admin''')
  ) v (stmt) loop
    begin
      execute t.stmt;
      raise exception 'accepted';
    exception when others then
      if sqlerrm <> 'last_admin' then
        raise exception '%: % (expected last_admin)', t.stmt, sqlerrm;
      end if;
    end;
  end loop;
  assert (select role = 'admin' and active from public.staff_members where user_id = auth.uid()),
    'the last administrator is untouched';

  -- With a second administrator, the first can step down.
  perform public.ops_set_staff('comprador2@yuntera.example', 'admin', true);
  perform public.ops_set_staff('central@yuntera.example', 'ops', true);
  assert (select role from public.staff_members where user_id = auth.uid()) = 'ops', 'stepped down';
  begin
    perform public.ops_staff();
    raise exception 'a former administrator still manages staff';
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
end
$$;
reset role;

-- The audit trail has every change, with the name of who made it and of whom.
select pg_temp.login('comprador2@yuntera.example');
do $$
declare
  n integer;
  r record;
begin
  -- support, finance, deactivated, admin (reactivated) for Andrés; ops for Gabriela.
  select count(*) into n from public.audit_entries('staff_members', 100)
  where actor_name = 'Gabriela Soto Marín';
  assert n - current_setting('t.staff_audit_before')::integer = 5,
    format('five changes by the administrator, found %s', n - current_setting('t.staff_audit_before')::integer);

  select * into r from public.audit_entries('staff_members', 100)
  where id > current_setting('t.audit_id_before')::bigint order by id limit 1;
  assert r.action = 'INSERT' and r.actor_name = 'Gabriela Soto Marín'
     and r.subject = 'Andrés Mora Chaves' and r.new_row ->> 'role' = 'support',
    format('who gave whom which role: %s', to_jsonb(r));
  assert exists (
    select 1 from public.audit_entries('staff_members', 100)
    where action = 'UPDATE' and subject = 'Andrés Mora Chaves'
      and old_row ->> 'active' = 'true' and new_row ->> 'active' = 'false'
  ), 'the deactivation is recorded';

  -- Hand the keys back so the rest of the file runs as the seed's administrator.
  perform public.ops_set_staff('central@yuntera.example', 'admin', true);
  perform public.ops_set_staff('comprador2@yuntera.example', 'support', true);
end
$$;
reset role;

-- ═══ Drivers ═══════════════════════════════════════════════════════════════

-- A shopper, a seller and staff who are not operations (support) are refused.
do $$
declare
  v_email text;
  t record;
begin
  foreach v_email in array array[
    'comprador@yuntera.example', 'vendedor@yuntera.example', 'comprador2@yuntera.example'
  ] loop
    perform set_config('request.jwt.claims', json_build_object(
      'sub', (select id from auth.users where email = v_email), 'role', 'authenticated', 'aal', 'aal2')::text, true);
    set local role authenticated;
    for t in select * from (values
      ('select public.ops_save_driver(''Sofía Vargas Rojas'', ''+50661113456'', ''fisica'', ''109870123'', ''motorcycle'', ''MOT-123456'', 40, ''A2'', current_date + 300, current_date + 200, current_date + 100, ''comprador3@yuntera.example'')'),
      ('select public.ops_warehouse_staff()'),
      (format('select public.ops_set_warehouse_staff(%L, ''comprador3@yuntera.example'', ''associate'')',
              current_setting('t.depot')))
    ) v (stmt) loop
      begin
        execute t.stmt;
        raise exception 'accepted';
      exception when others then
        if sqlerrm <> 'forbidden' then
          raise exception '% as %: % (expected forbidden)', t.stmt, v_email, sqlerrm;
        end if;
      end;
    end loop;
    reset role;
  end loop;
end
$$;

select pg_temp.login('central@yuntera.example');
do $$
declare
  v_id uuid;
  d jsonb;
  t record;
begin
  -- Every format rule, one bad value at a time.
  for t in select * from (values
    ('''Sof'', ''+50661113456'', ''fisica'', ''109870123'', ''motorcycle'', ''MOT-123456'', 40, ''A2'', current_date + 300, current_date + 200, current_date + 100',
     'invalid_driver_name'),
    ('''Sofía Vargas Rojas'', ''+50622223333'', ''fisica'', ''109870123'', ''motorcycle'', ''MOT-123456'', 40, ''A2'', current_date + 300, current_date + 200, current_date + 100',
     'invalid_driver_phone'),
    ('''Sofía Vargas Rojas'', ''61113456'', ''fisica'', ''109870123'', ''motorcycle'', ''MOT-123456'', 40, ''A2'', current_date + 300, current_date + 200, current_date + 100',
     'invalid_driver_phone'),
    ('''Sofía Vargas Rojas'', ''+50661113456'', ''fisica'', ''10987012'', ''motorcycle'', ''MOT-123456'', 40, ''A2'', current_date + 300, current_date + 200, current_date + 100',
     'invalid_driver_identification'),
    ('''Sofía Vargas Rojas'', ''+50661113456'', ''juridica'', ''3101700202'', ''motorcycle'', ''MOT-123456'', 40, ''A2'', current_date + 300, current_date + 200, current_date + 100',
     'invalid_driver_identification'),
    ('''Sofía Vargas Rojas'', ''+50661113456'', ''fisica'', ''109870123'', ''motorcycle'', ''???'', 40, ''A2'', current_date + 300, current_date + 200, current_date + 100',
     'invalid_driver_vehicle'),
    ('''Sofía Vargas Rojas'', ''+50661113456'', ''fisica'', ''109870123'', ''car'', null, 250, ''B1'', current_date + 300, current_date + 200, current_date + 100',
     'invalid_driver_vehicle'),
    ('''Sofía Vargas Rojas'', ''+50661113456'', ''fisica'', ''109870123'', ''motorcycle'', ''MOT-123456'', 0, ''A2'', current_date + 300, current_date + 200, current_date + 100',
     'invalid_driver_vehicle'),
    ('''Sofía Vargas Rojas'', ''+50661113456'', ''fisica'', ''109870123'', ''motorcycle'', ''MOT-123456'', 40, ''Z9'', current_date + 300, current_date + 200, current_date + 100',
     'invalid_driver_documents'),
    ('''Sofía Vargas Rojas'', ''+50661113456'', ''fisica'', ''109870123'', ''motorcycle'', ''MOT-123456'', 40, ''A2'', null, current_date + 200, current_date + 100',
     'invalid_driver_documents'),
    ('''Sofía Vargas Rojas'', ''+50661113456'', ''fisica'', ''109870123'', ''motorcycle'', ''MOT-123456'', 40, ''A2'', current_date + 300, date ''1990-01-01'', current_date + 100',
     'invalid_driver_documents')
  ) v (args, code) loop
    begin
      execute format('select public.ops_save_driver(%s, ''comprador3@yuntera.example'')', t.args);
      raise exception 'accepted';
    exception when others then
      if sqlerrm <> t.code then
        raise exception 'ops_save_driver(%): % (expected %)', t.args, sqlerrm, t.code;
      end if;
    end;
  end loop;

  begin
    perform public.ops_save_driver('Persona Sin Cuenta', '+50661113456', 'fisica', '109870123',
      'motorcycle', 'MOT-123456', 40, 'A2', current_date + 300, current_date + 200,
      current_date + 100, 'nadie@yuntera.example');
    raise exception 'made a driver of an e-mail with no account';
  exception when others then
    if sqlerrm <> 'account_not_found' then raise; end if;
  end;
  begin
    perform public.ops_save_driver('Carlos Méndez Porras', '+50688110011', 'fisica', '112340567',
      'motorcycle', 'MOT-482913', 40, 'A2', current_date + 300, current_date + 200,
      current_date + 100, 'repartidor@yuntera.example');
    raise exception 'made a second driver record for one account';
  exception when others then
    if sqlerrm <> 'driver_already_exists' then raise; end if;
  end;

  -- A new driver, written the way it would be typed, starts pending.
  v_id := public.ops_save_driver('  Sofía   Vargas Rojas ', '+50661113456', 'fisica', '109870123',
    'motorcycle', 'mot 123456', 40, 'a2', current_date + 300, current_date + 200,
    current_date + 100, 'comprador3@yuntera.example');
  perform set_config('t.sofia', v_id::text, true);
  d := (select x from jsonb_array_elements(public.ops_drivers()) x where (x ->> 'id')::uuid = v_id);
  assert d ->> 'status' = 'pending', 'a new driver waits for approval';
  assert d ->> 'full_name' = 'Sofía Vargas Rojas' and d ->> 'plate' = 'MOT123456'
     and d ->> 'license_class' = 'A2' and d ->> 'email' = 'comprador3@yuntera.example'
     and d ->> 'id_type' = 'fisica' and d ->> 'id_number' = '109870123'
     and (d ->> 'capacity_kg')::numeric = 40 and not (d ->> 'documents_expired')::boolean,
    format('saved as typed, tidied: %s', d);
  assert not exists (
    select 1 from jsonb_array_elements(public.ops_dispatch_board() -> 'drivers') x
    where (x ->> 'id')::uuid = v_id), 'a pending driver is not offered routes';

  -- The existing function activates them.
  perform public.ops_set_driver_status(v_id, 'active');
  assert exists (
    select 1 from jsonb_array_elements(public.ops_dispatch_board() -> 'drivers') x
    where (x ->> 'id')::uuid = v_id), 'once active they can be given a route';

  -- An edit changes the record and nothing else: not the account, not the status.
  perform public.ops_save_driver('Sofía Vargas Rojas', '+50661119999', 'dimex', '155812345678',
    'bicycle', 'MOT-123456', 15, null, null, null, null, null, v_id);
  d := (select x from jsonb_array_elements(public.ops_drivers()) x where (x ->> 'id')::uuid = v_id);
  assert d ->> 'phone' = '+50661119999' and d ->> 'vehicle_type' = 'bicycle' and d ->> 'plate' is null
     and d ->> 'id_type' = 'dimex' and d ->> 'license_expires_on' is null
     and d ->> 'status' = 'active' and d ->> 'email' = 'comprador3@yuntera.example',
    format('a bicycle needs no plate or papers: %s', d);

  begin
    perform public.ops_save_driver('Sofía Vargas Rojas', '+50661119999', 'fisica', '109870123',
      'bicycle', null, 15, null, null, null, null, null, gen_random_uuid());
    raise exception 'edited a driver that does not exist';
  exception when others then
    if sqlerrm <> 'driver_not_found' then raise; end if;
  end;

  -- Creation, activation and the edit are all in the audit trail.
  assert (select count(*) from public.audit_entries('drivers', 50)
          where subject = 'Sofía Vargas Rojas' and actor_name = 'Gabriela Soto Marín') = 3,
    'every change to a driver is recorded';
end
$$;
reset role;

-- The new driver's own session sees the record.
select pg_temp.login('comprador3@yuntera.example');
do $$
begin
  assert public.my_roles() #>> '{driver,status}' = 'active', 'the driver app lets them in';
  assert public.driver_today() #>> '{driver,full_name}' = 'Sofía Vargas Rojas', 'with their day';
end
$$;
reset role;

-- ═══ Warehouse workers ═════════════════════════════════════════════════════

select pg_temp.login('central@yuntera.example');
do $$
declare
  v_depot uuid := current_setting('t.depot')::uuid;
  w jsonb := public.ops_warehouse_staff();
  t record;
begin
  assert jsonb_array_length(w) = 1 and w #>> '{0,code}' = 'SJO1',
    'Yuntera''s own warehouses only, not sellers'' locations';
  assert jsonb_array_length(w #> '{0,staff}') = 1
     and w #>> '{0,staff,0,full_name}' = 'Kattia Rodríguez Salas'
     and w #>> '{0,staff,0,role}' = 'lead' and w #>> '{0,staff,0,email}' = 'bodega@yuntera.example',
    format('the seed''s lead: %s', w);

  for t in select * from (values
    (format('select public.ops_set_warehouse_staff(%L, ''comprador2@yuntera.example'', ''associate'')',
            current_setting('t.seller_site')), 'warehouse_not_found'),
    (format('select public.ops_set_warehouse_staff(%L, ''comprador2@yuntera.example'', ''associate'')',
            gen_random_uuid()), 'warehouse_not_found'),
    (format('select public.ops_set_warehouse_staff(%L, ''comprador2@yuntera.example'', ''boss'')',
            v_depot), 'invalid_warehouse_role'),
    (format('select public.ops_set_warehouse_staff(%L, ''nadie@yuntera.example'', ''associate'')',
            v_depot), 'account_not_found'),
    (format('select public.ops_set_warehouse_staff(%L, ''comprador2@yuntera.example'', null)',
            v_depot), 'warehouse_staff_not_found')
  ) v (stmt, code) loop
    begin
      execute t.stmt;
      raise exception 'accepted';
    exception when others then
      if sqlerrm <> t.code then
        raise exception '%: % (expected %)', t.stmt, sqlerrm, t.code;
      end if;
    end;
  end loop;

  perform public.ops_set_warehouse_staff(v_depot, 'Comprador3@yuntera.example', 'associate');
  w := public.ops_warehouse_staff();
  assert jsonb_array_length(w #> '{0,staff}') = 2
     and w #>> '{0,staff,1,full_name}' = 'Sofía Vargas Rojas' and w #>> '{0,staff,1,role}' = 'associate',
    'the new worker is listed after the lead';
end
$$;
reset role;

-- The assignment is what lets them onto the floor.
select pg_temp.login('comprador3@yuntera.example');
do $$
begin
  assert public.wms_board(current_setting('t.depot')::uuid) #>> '{warehouse,code}' = 'SJO1',
    'a worker reads the board of their warehouse';
end
$$;
reset role;

select pg_temp.login('central@yuntera.example');
do $$
declare
  v_depot uuid := current_setting('t.depot')::uuid;
begin
  perform public.ops_set_warehouse_staff(v_depot, 'comprador3@yuntera.example', 'lead');
  assert (select x ->> 'role' from jsonb_array_elements(public.ops_warehouse_staff() #> '{0,staff}') x
          where x ->> 'email' = 'comprador3@yuntera.example') = 'lead', 'role changed';
  perform public.ops_set_warehouse_staff(v_depot, 'comprador3@yuntera.example', null);
  assert jsonb_array_length(public.ops_warehouse_staff() #> '{0,staff}')
         = current_setting('t.depot_staff_before')::integer, 'removed';
  assert (select count(*) from public.audit_entries('warehouse_staff', 50)
          where subject = 'Sofía Vargas Rojas') = 3, 'added, changed and removed are all recorded';
end
$$;
reset role;

select pg_temp.login('comprador3@yuntera.example');
do $$
begin
  perform public.wms_board(current_setting('t.depot')::uuid);
  raise exception 'a removed worker still reads the board';
exception when others then
  if sqlerrm <> 'forbidden' then raise; end if;
end
$$;
reset role;

-- ═══ Bank details ══════════════════════════════════════════════════════════

-- The check digits. packages/core/src/cr/iban.test.ts runs the TypeScript rule
-- over the same list, so the form and the database cannot disagree.
do $$
declare
  t record;
begin
  for t in select * from (values
-- BEGIN iban_cases
    ('CR05015202001026284066', true),
    ('CR26010200009123456789', true),
    ('CR86015100020019688637', true),
    ('CR31010200009555666777', true),
    ('CR23015108410026012345', true),
    ('CR02015201000000000017', true),
    ('CR98015201000000000035', true),
    ('CR97015201000000000053', true),
    ('CR05015202001026284067', false),
    ('CR05015202001026280466', false),
    ('CR06015202001026284066', false),
    ('CR21010200009123456789', false),
    ('CR99015201000000000017', false),
    ('CR01015201000000000035', false),
    ('CR00015201000000000053', false),
    ('CR0501520200102628406', false),
    ('CR050152020010262840661', false),
    ('CR05O152O2OO1O26284O66', false),
    ('GB82WEST12345698765432', false),
    ('05015202001026284066', false),
    ('CR', false),
    ('', false)
-- END iban_cases
  ) v (iban, valid) loop
    assert private.is_valid_cr_iban(t.iban) = t.valid,
      format('IBAN %s should be %s', t.iban, case when t.valid then 'valid' else 'invalid' end);
  end loop;
  assert not private.is_valid_cr_iban(null), 'no number is not a valid number';
end
$$;

-- A member of the shop who is not its owner or administrator.
insert into public.seller_members (seller_id, user_id, role)
select current_setting('t.tecnocasa')::uuid, id, 'staff'
from auth.users where email = 'comprador3@yuntera.example';

-- The seller cannot write the payout account directly, or read it whole.
-- (Checked without the suite's inspection grant: this is about privileges.)
select pg_temp.stop_inspection();
select pg_temp.login('vendedor@yuntera.example');
do $$
declare
  t record;
begin
  for t in select * from (values
    ('update public.seller_private set payout_iban = ''CR23015108410026012345'''),
    ('update public.seller_private set payout_holder_name = ''Otra Persona'''),
    ('update public.seller_private set sinpe_movil_number = ''+50688887777'''),
    -- Nor the phone and e-mail finance calls to confirm a change of account.
    ('update public.seller_private set contact_phone = ''+50687654321'''),
    ('update public.seller_private set contact_email = ''otra@example.com'''),
    -- Since the lockdown, no column of the table is open to them at all.
    ('update public.seller_private set postal_code = ''11802'''),
    ('select legal_name from public.seller_private'),
    ('select payout_iban from public.seller_private'),
    ('select * from public.seller_private'),
    ('select 1 from public.payout_detail_requests'),
    ('select 1 from public.payouts'),
    ('select 1 from public.payout_runs'),
    ('insert into public.payout_detail_requests (seller_id, payout_iban, payout_holder_name, requested_by, status) select seller_id, ''CR23015108410026012345'', ''Otra Persona'', auth.uid(), ''approved'' from public.seller_private')
  ) v (stmt) loop
    begin
      execute t.stmt;
      raise exception 'accepted';
    exception when insufficient_privilege then
      null; -- expected
    when others then
      raise exception '%: % (expected permission denied)', t.stmt, sqlerrm;
    end;
  end loop;
  -- The fiscal details change through a request staff approve
  -- (seller_request_shop_change, in the limits migration); the direct write
  -- of postal_code above is refused like every other.
end
$$;
reset role;
select pg_temp.allow_inspection();

-- Who may ask: the shop's owner or administrator, nobody else.
do $$
declare
  v_email text;
begin
  foreach v_email in array array[
    'comprador@yuntera.example',   -- a shopper
    'cafetal@yuntera.example',     -- the owner of another shop
    'comprador3@yuntera.example',  -- a member of this shop without that rank
    'central@yuntera.example'      -- staff: they decide requests, they do not make them
  ] loop
    perform set_config('request.jwt.claims', json_build_object(
      'sub', (select id from auth.users where email = v_email), 'role', 'authenticated', 'aal', 'aal2')::text, true);
    set local role authenticated;
    begin
      perform public.seller_request_payout_details(
        current_setting('t.tecnocasa')::uuid, 'CR23015108410026012345', 'TecnoCasa de Costa Rica S.A.', null);
      raise exception 'accepted';
    exception when others then
      if sqlerrm <> 'forbidden' then
        raise exception 'request as %: % (expected forbidden)', v_email, sqlerrm;
      end if;
    end;
    reset role;
  end loop;
end
$$;

-- The shop's account on file as the seed set it: on a used database the shop
-- may have changed it through an approved request (the payouts journey does);
-- for this transaction, which rolls back, it is the seed's again.
update public.seller_private set payout_iban = 'CR26010200009123456789'
where seller_id = current_setting('t.tecnocasa')::uuid and payout_iban <> 'CR26010200009123456789';
-- Requests the shop made before this suite (none in the seed; on a used
-- database the shop may have changed its account, and the last decided
-- request is then shown).
select pg_temp.remember('tecnocasa_prior_requests', (select count(*)::text from public.payout_detail_requests
  where seller_id = current_setting('t.tecnocasa')::uuid));
select pg_temp.login('vendedor@yuntera.example');
do $$
declare
  v_seller uuid := current_setting('t.tecnocasa')::uuid;
  v_first uuid;
  v_second uuid;
  d jsonb;
  t record;
begin
  for t in select * from (values
    ('CR05015202001026284067', 'TecnoCasa de Costa Rica S.A.', '+50684440202', 'invalid_iban'),
    ('GB82WEST12345698765432', 'TecnoCasa de Costa Rica S.A.', '+50684440202', 'invalid_iban'),
    ('CR0501520200102628406', 'TecnoCasa de Costa Rica S.A.', '+50684440202', 'invalid_iban'),
    ('', 'TecnoCasa de Costa Rica S.A.', '+50684440202', 'invalid_iban'),
    ('CR23015108410026012345', 'TC', '+50684440202', 'invalid_account_holder'),
    ('CR23015108410026012345', 'TecnoCasa de Costa Rica S.A.', '+50622340202', 'invalid_sinpe_number'),
    ('CR23015108410026012345', 'TecnoCasa de Costa Rica S.A.', '84440202', 'invalid_sinpe_number')
  ) v (iban, holder, sinpe, code) loop
    begin
      perform public.seller_request_payout_details(v_seller, t.iban, t.holder, t.sinpe);
      raise exception 'accepted';
    exception when others then
      if sqlerrm <> t.code then
        raise exception 'request(%, %, %): % (expected %)', t.iban, t.holder, t.sinpe, sqlerrm, t.code;
      end if;
    end;
  end loop;

  d := public.seller_payout_details(v_seller);
  assert case when current_setting('t.tecnocasa_prior_requests')::integer = 0 then d ->> 'request' is null
              else d #>> '{request,status}' <> 'pending' end
     and (d ->> 'can_request')::boolean, 'no request waiting yet';
  assert d #>> '{current,iban_masked}' = 'CR•• •••• •••• •••• 6789', 'the current account, masked';

  -- Typed the way people type it: in groups, in lower case.
  v_first := public.seller_request_payout_details(
    v_seller, 'cr23 0151 0841 0026 0123 45', '  TecnoCasa de  Costa Rica S.A. ', '+506 8444-0202');
  d := public.seller_payout_details(v_seller);
  assert d #>> '{request,status}' = 'pending'
     and d #>> '{request,iban_masked}' = 'CR•• •••• •••• •••• 2345'
     and d #>> '{request,holder_name}' = 'TecnoCasa de Costa Rica S.A.'
     and d #>> '{request,sinpe_number}' = '+50684440202'
     and d #>> '{request,requested_by_name}' = 'Roberto Jiménez Arce'
     and d #>> '{request,note}' is null,
    format('the open request, masked: %s', d);
  assert d #>> '{current,iban_masked}' = 'CR•• •••• •••• •••• 6789', 'nothing has changed yet';
  assert probe.value(format('select payout_iban from public.seller_private where seller_id = %L', v_seller))
         = 'CR26010200009123456789', 'the account on file is untouched until finance approves';

  -- A newer request replaces the open one; the old one stays on record.
  v_second := public.seller_request_payout_details(
    v_seller, 'CR82010200009000000001', 'TecnoCasa de Costa Rica S.A.', null);
  assert probe.value(format('select status from public.payout_detail_requests where id = %L', v_first))
         = 'replaced', 'the first request was replaced';
  assert probe.value(format(
           'select count(*) from public.payout_detail_requests where seller_id = %L and status = ''pending''',
           v_seller)) = '1', 'one open request per shop';
  assert public.seller_payout_details(v_seller) #>> '{request,iban_masked}' = 'CR•• •••• •••• •••• 0001',
    'the seller sees the newest';
  perform set_config('t.request', v_second::text, true);

  -- Nothing a seller can call ever carries a whole account number.
  assert position('0200009000000001' in public.seller_payout_details(v_seller)::text) = 0
     and position('010200009123456789' in public.seller_payout_details(v_seller)::text) = 0
     and position('010200009123456789' in public.seller_overview(v_seller)::text) = 0
     and position('010200009123456789' in public.seller_payouts(v_seller)::text) = 0,
    'no full IBAN in anything the seller reads';

  -- A seller does not see finance's queue, and cannot decide.
  begin
    perform public.ops_payout_detail_requests();
    raise exception 'a seller read the finance queue';
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
  begin
    perform public.ops_decide_payout_details(v_second, true);
    raise exception 'a seller approved their own request';
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
end
$$;
reset role;

-- A member without rank sees the state, masked, and is told they cannot ask.
select pg_temp.login('comprador3@yuntera.example');
do $$
declare
  d jsonb := public.seller_payout_details(current_setting('t.tecnocasa')::uuid);
begin
  assert not (d ->> 'can_request')::boolean and d #>> '{request,status}' = 'pending', 'read only';
end
$$;
reset role;

-- Another shop's owner sees nothing of it; nor does staff of the wrong role.
do $$
declare
  v_email text;
  t record;
begin
  foreach v_email in array array[
    'comprador@yuntera.example', 'cafetal@yuntera.example', 'repartidor@yuntera.example'
  ] loop
    perform set_config('request.jwt.claims', json_build_object(
      'sub', (select id from auth.users where email = v_email), 'role', 'authenticated', 'aal', 'aal2')::text, true);
    set local role authenticated;
    for t in select * from (values
      (format('select public.seller_payout_details(%L)', current_setting('t.tecnocasa'))),
      (format('select public.seller_payouts(%L)', current_setting('t.tecnocasa'))),
      ('select public.ops_payout_detail_requests()'),
      (format('select public.ops_decide_payout_details(%L, true)', current_setting('t.request'))),
      ('select public.ops_payout_preview()'),
      ('select public.ops_create_payout_run(current_date)'),
      ('select public.ops_payout_runs()'),
      (format('select public.ops_payout_run(%L)', gen_random_uuid())),
      (format('select public.ops_mark_payout_paid(%L, ''BNCR-0001'')', gen_random_uuid())),
      (format('select public.ops_mark_payout_failed(%L, ''cuenta cerrada'')', gen_random_uuid()))
    ) v (stmt) loop
      begin
        execute t.stmt;
        raise exception 'accepted';
      exception when others then
        if sqlerrm <> 'forbidden' then
          raise exception '% as %: % (expected forbidden)', t.stmt, v_email, sqlerrm;
        end if;
      end;
    end loop;
    reset role;
  end loop;

  -- Support staff (comprador2) may read a seller's masked details to help
  -- them, and nothing of finance's.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', (select id from auth.users where email = 'comprador2@yuntera.example'),
    'role', 'authenticated', 'aal', 'aal2')::text, true);
  set local role authenticated;
  assert public.seller_payout_details(current_setting('t.tecnocasa')::uuid) #>> '{request,status}' = 'pending',
    'support sees the state of a request';
  for t in select * from (values
    (format('select public.seller_payouts(%L)', current_setting('t.tecnocasa'))),
    ('select public.ops_payout_detail_requests()'),
    (format('select public.ops_decide_payout_details(%L, true)', current_setting('t.request'))),
    ('select public.ops_payout_preview()'),
    ('select public.ops_create_payout_run(current_date)'),
    ('select public.ops_payout_runs()'),
    (format('select public.ops_payout_run(%L)', gen_random_uuid())),
    (format('select public.ops_mark_payout_paid(%L, ''BNCR-0001'')', gen_random_uuid())),
    (format('select public.ops_mark_payout_failed(%L, ''cuenta cerrada'')', gen_random_uuid()))
  ) v (stmt) loop
    begin
      execute t.stmt;
      raise exception 'accepted';
    exception when others then
      if sqlerrm <> 'forbidden' then
        raise exception '% as support staff: % (expected forbidden)', t.stmt, sqlerrm;
      end if;
    end;
  end loop;
  reset role;
end
$$;

-- Finance: the queue, a rejection that must be explained, an approval.
select pg_temp.login('central@yuntera.example');
do $$
declare
  v_seller uuid := current_setting('t.tecnocasa')::uuid;
  v_request uuid := current_setting('t.request')::uuid;
  q jsonb := public.ops_payout_detail_requests();
begin
  assert jsonb_array_length(q) = current_setting('t.requests_waiting_before')::integer + 1,
    'one request waits; the replaced one is not shown';
  assert q #>> '{0,seller,trade_name}' = 'TecnoCasa'
     and q #>> '{0,seller,contact_phone}' = '+50622340202'
     and q #>> '{0,current,iban_masked}' = 'CR•• •••• •••• •••• 6789'
     and q #>> '{0,requested,iban}' = 'CR82010200009000000001'
     and q #>> '{0,requested,holder_name}' = 'TecnoCasa de Costa Rica S.A.'
     and q #>> '{0,requested_by_name}' = 'Roberto Jiménez Arce',
    format('the shop, the current account masked, the requested one in full: %s', q);
  assert position('010200009123456789' in q::text) = 0, 'the current account is masked even for finance';
  assert not (q #>> '{0,signals,holder_differs}')::boolean
     and not (q #>> '{0,signals,first_account}')::boolean
     and not (q #>> '{0,signals,used_by_other_shop}')::boolean
     and not (q #>> '{0,signals,contact_changed_recently}')::boolean, 'nothing unusual about this one';

  begin
    perform public.ops_decide_payout_details(v_request, false, 'no');
    raise exception 'rejected without an explanation';
  exception when others then
    if sqlerrm <> 'reason_required' then raise; end if;
  end;
  begin
    perform public.ops_decide_payout_details(gen_random_uuid(), true);
    raise exception 'decided a request that does not exist';
  exception when others then
    if sqlerrm <> 'payout_request_not_found' then raise; end if;
  end;

  perform public.ops_decide_payout_details(
    v_request, false, 'No pudimos confirmar el cambio por teléfono. Llámenos al 4000-0000.');
  assert probe.value(format('select payout_iban from public.seller_private where seller_id = %L', v_seller))
         = 'CR26010200009123456789', 'a rejection changes nothing';
  assert jsonb_array_length(public.ops_payout_detail_requests())
         = current_setting('t.requests_waiting_before')::integer, 'the queue is as it was again';
  q := public.ops_payout_detail_requests('rejected');
  assert jsonb_array_length(q) = 1 and q #>> '{0,requested,iban}' is null
     and q #>> '{0,requested,iban_masked}' = 'CR•• •••• •••• •••• 0001'
     and q #>> '{0,decided_by_name}' = 'Gabriela Soto Marín',
    'once decided, the history keeps only the masked number';

  begin
    perform public.ops_decide_payout_details(v_request, true);
    raise exception 'decided the same request twice';
  exception when others then
    if sqlerrm <> 'payout_request_not_pending' then raise; end if;
  end;
end
$$;
reset role;

-- The seller reads why, and asks again.
select pg_temp.login('vendedor@yuntera.example');
do $$
declare
  v_seller uuid := current_setting('t.tecnocasa')::uuid;
  d jsonb := public.seller_payout_details(v_seller);
begin
  assert d #>> '{request,status}' = 'rejected'
     and d #>> '{request,note}' like 'No pudimos confirmar%', 'the seller reads the reason';
  perform set_config('t.request', public.seller_request_payout_details(
    v_seller, 'CR23015108410026012345', 'Roberto Jiménez Arce', '+50684440202')::text, true);
end
$$;
reset role;

select pg_temp.login('central@yuntera.example');
do $$
declare
  v_seller uuid := current_setting('t.tecnocasa')::uuid;
  q jsonb := public.ops_payout_detail_requests();
  r record;
begin
  assert (q #>> '{0,signals,holder_differs}')::boolean,
    'an account in someone else''s name is pointed out';

  perform public.ops_decide_payout_details(current_setting('t.request')::uuid, true, null);
  assert probe.value(format(
           'select payout_iban || ''|'' || payout_holder_name || ''|'' || sinpe_movil_number
            from public.seller_private where seller_id = %L', v_seller))
         = 'CR23015108410026012345|Roberto Jiménez Arce|+50684440202', 'approval writes the new account';
  assert probe.value(format(
           'select status || ''|'' || decided_by || ''|'' || (decided_at is not null)
            from public.payout_detail_requests where id = %L', current_setting('t.request')))
         = 'approved|' || auth.uid() || '|true', 'and records who approved, and when';

  -- The audit trail names who approved, shows that the account changed, and
  -- never holds a whole account number.
  select * into r from public.audit_entries('seller_private', 10)
  where action = 'UPDATE' and subject = 'TecnoCasa'
    and old_row ->> 'payout_iban_masked' is distinct from new_row ->> 'payout_iban_masked'
  order by id desc limit 1;
  assert r.actor_name = 'Gabriela Soto Marín'
     and r.old_row ->> 'payout_iban_masked' = 'CR•• •••• •••• •••• 6789'
     and r.new_row ->> 'payout_iban_masked' = 'CR•• •••• •••• •••• 2345',
    format('who approved the change of account: %s', to_jsonb(r));
end
$$;
reset role;

-- Asking for exactly what is already on file is not a change.
select pg_temp.login('vendedor@yuntera.example');
do $$
begin
  perform public.seller_request_payout_details(
    current_setting('t.tecnocasa')::uuid, 'CR23 0151 0841 0026 0123 45', 'Roberto Jiménez Arce', '+50684440202');
  raise exception 'accepted a request that changes nothing';
exception when others then
  if sqlerrm <> 'payout_details_unchanged' then raise; end if;
end
$$;
reset role;

do $$
begin
  assert not exists (
    select 1 from private.audit_log a
    where a.old_row::text ~ 'CR[0-9]{20}' or a.new_row::text ~ 'CR[0-9]{20}'
  ), 'no whole account number anywhere in the audit log';
end
$$;

-- Nobody approves a change they asked for themselves.
insert into public.staff_members (user_id, role)
select id, 'finance' from auth.users where email = 'vendedor@yuntera.example';

select pg_temp.login('vendedor@yuntera.example');
select set_config('t.own_request', public.seller_request_payout_details(
  current_setting('t.ferreteria')::uuid, 'CR86015100020019688637', 'Roberto Jiménez Arce', null)::text, true);
do $$
begin
  assert jsonb_array_length(public.ops_payout_detail_requests())
         = current_setting('t.requests_waiting_before')::integer + 1, 'as finance they do see the queue';
  perform public.ops_decide_payout_details(current_setting('t.own_request')::uuid, true);
  raise exception 'approved their own request';
exception when others then
  if sqlerrm <> 'cannot_decide_own_request' then raise; end if;
end
$$;
reset role;
delete from public.staff_members
where user_id = (select id from auth.users where email = 'vendedor@yuntera.example');

-- Nor does anyone who belongs to the shop: a colleague could ask on their behalf.
savepoint own_shop;
insert into public.seller_members (seller_id, user_id, role)
select current_setting('t.cafetal')::uuid, id, 'admin' from auth.users where email = 'central@yuntera.example';
select pg_temp.login('cafetal@yuntera.example');
select set_config('t.colleague_request', public.seller_request_payout_details(
  current_setting('t.cafetal')::uuid, 'CR23015108410026012345', 'Cafetal Los Santos S.R.L.', null)::text, true);
reset role;
select pg_temp.login('central@yuntera.example');
do $$
begin
  perform public.ops_decide_payout_details(current_setting('t.colleague_request')::uuid, true);
  raise exception 'approved a change for a shop they belong to';
exception when others then
  if sqlerrm <> 'cannot_decide_own_shop' then raise; end if;
end
$$;
reset role;
do $$
begin
  assert probe.value(format('select payout_iban from public.seller_private where seller_id = %L',
                            current_setting('t.cafetal'))) = 'CR05015202001026284066', 'the account did not change';
end
$$;
rollback to savepoint own_shop;

-- A contact phone or e-mail changed shortly before the request is pointed out:
-- the number finance would call may not be the shop's. (Sellers cannot change
-- it any more, as tested above; staff and the database owner still can.)
savepoint contact_changed;
update public.seller_private set contact_phone = '+50687654321', contact_email = 'otra@example.com'
where seller_id = current_setting('t.sendero')::uuid;
select pg_temp.login('sendero@yuntera.example');
select public.seller_request_payout_details(
  current_setting('t.sendero')::uuid, 'CR23015108410026012345', 'Sendero Outdoor S.R.L.', null);
reset role;
select pg_temp.login('central@yuntera.example');
do $$
declare
  q jsonb := public.ops_payout_detail_requests();
  r jsonb;
begin
  r := (select x from jsonb_array_elements(q) x where x #>> '{seller,trade_name}' = 'Tienda Sendero');
  assert (r #>> '{signals,contact_changed_recently}')::boolean, format('the recent change is flagged: %s', r);
  assert not (select bool_or((x #>> '{signals,contact_changed_recently}')::boolean)
              from jsonb_array_elements(q) x where x #>> '{seller,trade_name}' <> 'Tienda Sendero'),
    'and no other shop is';
end
$$;
reset role;
rollback to savepoint contact_changed;

select pg_temp.check_balances('after bank details');

-- ═══ Payouts ═══════════════════════════════════════════════════════════════

do $$
begin
  assert private.setting('payout_hold_days') = '10'::jsonb
     and private.setting('payout_minimum_minor') = '500000'::jsonb, 'the two settings and their defaults';
  assert private.payout_hold_days() = 10 and private.payout_minimum_minor() = 500000, 'as numbers';
end
$$;

-- An order where one parcel was delivered and another came back never becomes
-- "delivered" as a whole. The seller whose goods were delivered must still be
-- paid once the hold is over, and the hold on the goods that came back counts
-- from their return. (YT-100012 has one item from Tienda Sendero and one from
-- TecnoCasa in one parcel; here TecnoCasa's goes into a second parcel that comes back.)
savepoint split_order;
-- It is out for delivery in the seed (seed-today-b2). On a used database it
-- may have moved on: there the same basket is placed, paid, packed and sent
-- out on a route now, as the seed did, for this savepoint only.
do $$
declare
  v_order uuid := (select o.id from public.orders o join public.shipments s on s.order_id = o.id
                   where o.idempotency_key = 'seed-today-b2' and s.status = 'out_for_delivery');
begin
  if v_order is null then
    perform pg_temp.shopper('pagos085@yuntera.example', 'Prueba Pagos Divididos');
    v_order := pg_temp.place('pagos085@yuntera.example',
      pg_temp.items('abanico-pie-volcan-18:1', 'rompecabezas-volcanes-500:1'), 'card', 'test-085-split');
    perform pg_temp.pay(v_order);
    perform pg_temp.pack(pg_temp.shipment(v_order, 'platform'));
    perform pg_temp.route(pg_temp.shipment(v_order, 'platform'));
  end if;
  perform pg_temp.remember('split_order', v_order::text);
end
$$;
select pg_temp.remember('split_sendero', (
  select (-sum(e.amount_minor))::text from public.ledger_entries e
  join public.ledger_accounts a on a.id = e.account_id
  join public.ledger_transactions t on t.id = e.transaction_id
  where t.order_id = current_setting('t.split_order')::uuid and a.seller_id = current_setting('t.sendero')::uuid));
select pg_temp.remember('split_tecnocasa', (
  select (-sum(e.amount_minor))::text from public.ledger_entries e
  join public.ledger_accounts a on a.id = e.account_id
  join public.ledger_transactions t on t.id = e.transaction_id
  where t.order_id = current_setting('t.split_order')::uuid and a.seller_id = current_setting('t.tecnocasa')::uuid));
create temp table split_before on commit drop as
select * from private.seller_balances(private.cr_local(now())::date, 10);
do $$
declare
  v_order uuid := current_setting('t.split_order')::uuid;
  v_first uuid := (select id from public.shipments where order_id = v_order);
  v_second uuid;
begin
  assert current_setting('t.split_sendero')::bigint > 0 and current_setting('t.split_tecnocasa')::bigint > 0,
    'both shops earned on the order';
  insert into public.shipments (order_id, tracking_code, origin_warehouse_id, status, promise_latest)
  select order_id, 'YT599012', origin_warehouse_id, 'returned', promise_latest
  from public.shipments where id = v_first
  returning id into v_second;
  update public.shipment_items set shipment_id = v_second
  where shipment_id = v_first
    and order_item_id in (select id from public.order_items
                          where order_id = v_order and seller_id = current_setting('t.tecnocasa')::uuid);
  update public.shipments set status = 'delivered', delivered_at = now() - interval '20 days'
  where id = v_first;
  perform private.sync_order_status(v_order);
  -- Since 20261121083200_followups.sql such an order is delivered (nothing
  -- more can happen to it); its payouts are still decided per seller below.
  assert (select status = 'delivered' from public.orders where id = v_order),
    'one parcel delivered and the other back: the order has ended';
end
$$;
do $$
declare
  v_today date := current_setting('t.today')::date;
  a record;
  b record;
begin
  select * into b from split_before where seller_id = current_setting('t.sendero')::uuid;
  select * into a from private.seller_balances(v_today, 10, current_setting('t.sendero')::uuid);
  assert a.pending_minor = b.pending_minor - current_setting('t.split_sendero')::bigint
     and a.available_minor = b.available_minor + current_setting('t.split_sendero')::bigint,
    format('Sendero''s share, delivered 20 days ago, is available: %s then %s', row_to_json(b), row_to_json(a));
  -- TecnoCasa's share came back today: still pending, and it says until when.
  select * into b from split_before where seller_id = current_setting('t.tecnocasa')::uuid;
  select * into a from private.seller_balances(v_today, 10, current_setting('t.tecnocasa')::uuid);
  assert a.pending_minor = b.pending_minor and a.available_minor = b.available_minor,
    'TecnoCasa''s share, returned today, stays pending';
end
$$;
select pg_temp.login('vendedor@yuntera.example');
do $$
declare
  v jsonb := public.seller_payouts(current_setting('t.tecnocasa')::uuid);
begin
  assert exists (select 1 from jsonb_array_elements(v -> 'releases') x
                 where (x ->> 'on')::date = current_setting('t.today')::date + 10
                   and (x ->> 'amount_minor')::bigint >= current_setting('t.split_tecnocasa')::bigint),
    format('with a release day ten days after the return: %s', v -> 'releases');
  assert (select coalesce(sum((x ->> 'amount_minor')::bigint), 0) from jsonb_array_elements(v -> 'releases') x)
         + (v ->> 'awaiting_delivery_minor')::bigint = (v ->> 'pending_minor')::bigint,
    'releases + undelivered = pending';
end
$$;
reset role;
select pg_temp.login('sendero@yuntera.example');
do $$
declare
  v jsonb := public.seller_payouts(current_setting('t.sendero')::uuid);
begin
  assert (select coalesce(sum((x ->> 'amount_minor')::bigint), 0) from jsonb_array_elements(v -> 'releases') x)
         + (v ->> 'awaiting_delivery_minor')::bigint = (v ->> 'pending_minor')::bigint,
    'Sendero: releases + undelivered = pending';
end
$$;
reset role;
select pg_temp.check_balances('split order, one parcel returned');
rollback to savepoint split_order;

-- An account kept from before requests existed that fails the IBAN check is
-- not paid; the seller is told to ask for the account again.
savepoint invalid_account;
update public.seller_private set payout_iban = 'CR21010200009123456789'
where seller_id = current_setting('t.tecnocasa')::uuid;
-- Payouts the shop already had (none in the seed; a used database may have some).
select pg_temp.remember('tecnocasa_payouts', (select count(*)::text from public.payouts
  where seller_id = current_setting('t.tecnocasa')::uuid));
select pg_temp.login('central@yuntera.example');
do $$
declare
  s jsonb := (select x from jsonb_array_elements(public.ops_payout_preview() -> 'sellers') x
              where (x ->> 'seller_id')::uuid = current_setting('t.tecnocasa')::uuid);
  r jsonb;
begin
  -- (On a used database the shop may also have too little left to pay: that
  -- reason may come too, never instead.)
  assert (s -> 'reasons') - 'below_minimum' = '["invalid_bank_details"]'::jsonb and not (s ->> 'will_pay')::boolean,
    format('an account that fails the check is not paid: %s', s);
  begin
    r := public.ops_create_payout_run(current_setting('t.today')::date);
  exception when others then
    -- Only where nobody at all is due a payout (a used database whose money was paid out).
    if sqlerrm <> 'nothing_to_pay' or exists (
         select 1 from jsonb_array_elements(public.ops_payout_preview() -> 'sellers') x
         where (x ->> 'will_pay')::boolean) then
      raise;
    end if;
  end;
  assert probe.value(format('select count(*) from public.payouts where seller_id = %L',
                            current_setting('t.tecnocasa'))) = current_setting('t.tecnocasa_payouts'),
    'and the run leaves it out';
  assert (public.seller_payouts(current_setting('t.tecnocasa')::uuid) -> 'blocked_by')
         ? 'invalid_bank_details', 'the seller''s screen says why';
end
$$;
reset role;
rollback to savepoint invalid_account;

-- What the seed's history should give, worked out from the orders themselves:
-- per seller, what was earned on orders delivered at least ten days ago.
select pg_temp.remember('expected_tecnocasa', (
  select coalesce(sum(f.payout_minor), 0)::text
  from public.seller_order_fees f join public.orders o on o.id = f.order_id
  where f.seller_id = current_setting('t.tecnocasa')::uuid
    and private.cr_local(o.delivered_at)::date + 10 <= private.cr_local(now())::date));
select pg_temp.remember('expected_cafetal', (
  select coalesce(sum(f.payout_minor), 0)::text
  from public.seller_order_fees f join public.orders o on o.id = f.order_id
  where f.seller_id = current_setting('t.cafetal')::uuid
    and private.cr_local(o.delivered_at)::date + 10 <= private.cr_local(now())::date));

select pg_temp.remember('shops_with_money', (
  select count(*)::text from private.seller_balances(current_setting('t.today')::date, 10) b
  where b.payable_minor <> 0 or b.in_transit_minor <> 0 or b.available_minor <> 0));

select pg_temp.login('central@yuntera.example');
do $$
declare
  v_today date := current_setting('t.today')::date;
  p jsonb := public.ops_payout_preview();
  s jsonb;
begin
  assert p ->> 'cutoff_on' = v_today::text and (p ->> 'hold_days')::integer = 10
     and (p ->> 'minimum_minor')::bigint = 500000
     and p ->> 'delivered_through' = (v_today - 10)::text and p ->> 'run' is null,
    format('today''s cut-off with its rules: %s', p - 'sellers');
  -- Every shop with money in play is listed, and no other (on the seed, four:
  -- the one with no sales is not). Counted from the ledger rather than fixed,
  -- so the suite also passes on a shared preview where people have ordered since.
  assert jsonb_array_length(p -> 'sellers') = current_setting('t.shops_with_money')::integer
     and jsonb_array_length(p -> 'sellers') >= 4, 'every shop with a balance';

  s := (select x from jsonb_array_elements(p -> 'sellers') x
        where (x ->> 'seller_id')::uuid = current_setting('t.tecnocasa')::uuid);
  assert (s ->> 'available_minor')::bigint = current_setting('t.expected_tecnocasa')::bigint
     and (s ->> 'available_minor')::bigint > 500000
     and (s ->> 'will_pay')::boolean and jsonb_array_length(s -> 'reasons') = 0
     and s ->> 'iban_masked' = 'CR•• •••• •••• •••• 2345' and (s ->> 'in_transit_minor')::bigint = 0,
    format('TecnoCasa is paid what its old-enough orders earned: %s', s);
  assert (s ->> 'available_minor')::bigint + (s ->> 'pending_minor')::bigint = (s ->> 'payable_minor')::bigint,
    'and the rest is pending';
  assert position('015108410026012345' in p::text) = 0, 'the preview masks account numbers';

  -- Everything Ferretería El Higuerón has earned is on an order not yet delivered.
  s := (select x from jsonb_array_elements(p -> 'sellers') x
        where (x ->> 'seller_id')::uuid = current_setting('t.ferreteria')::uuid);
  assert (s ->> 'available_minor')::bigint = 0 and (s ->> 'pending_minor')::bigint > 0
     and not (s ->> 'will_pay')::boolean and s -> 'reasons' = '["below_minimum"]'::jsonb
     and (s ->> 'details_request_pending')::boolean,
    format('nothing available yet, and a change of account is waiting: %s', s);

  assert (p ->> 'to_pay_count')::integer = (
           select count(*) from jsonb_array_elements(p -> 'sellers') x where (x ->> 'will_pay')::boolean)
     and (p ->> 'to_pay_count')::integer >= 3
     and (p ->> 'to_pay_minor')::bigint = (
       select sum((x ->> 'available_minor')::bigint) from jsonb_array_elements(p -> 'sellers') x
       where (x ->> 'will_pay')::boolean), 'the totals are of those who would be paid';

  -- An earlier cut-off releases less; a later one than today is refused.
  assert (public.ops_payout_preview(v_today - 9) ->> 'to_pay_minor')::bigint < (p ->> 'to_pay_minor')::bigint,
    'an earlier cut-off pays less';
  assert (public.ops_payout_preview(v_today - 60) ->> 'to_pay_count')::integer = 0,
    'before any delivery, nobody';
  begin
    perform public.ops_payout_preview(v_today + 1);
    raise exception 'previewed a cut-off in the future';
  exception when others then
    if sqlerrm <> 'invalid_cutoff' then raise; end if;
  end;
  begin
    perform public.ops_create_payout_run(v_today + 1);
    raise exception 'created a run for a cut-off in the future';
  exception when others then
    if sqlerrm <> 'invalid_cutoff' then raise; end if;
  end;
  begin
    perform public.ops_create_payout_run(v_today - 60);
    raise exception 'created a run that pays nobody';
  exception when others then
    if sqlerrm <> 'nothing_to_pay' then raise; end if;
  end;
  assert jsonb_array_length(public.ops_payout_runs()) = current_setting('t.runs_before')::integer,
    'and it left no empty run behind';
end
$$;
reset role;

-- The three reasons a shop is left out. Cafetal loses its account; Sendero is suspended.
update public.seller_private set payout_iban = null, payout_holder_name = null
where seller_id = current_setting('t.cafetal')::uuid;

select pg_temp.login('central@yuntera.example');
select public.ops_set_seller_status(current_setting('t.sendero')::uuid, 'suspended', 'Revisión de documentos.');
do $$
declare
  p jsonb := public.ops_payout_preview();
  v_reasons jsonb;
begin
  select x -> 'reasons' into v_reasons from jsonb_array_elements(p -> 'sellers') x
  where (x ->> 'seller_id')::uuid = current_setting('t.cafetal')::uuid;
  assert v_reasons = '["no_bank_details"]'::jsonb, format('no approved account: %s', v_reasons);
  select x -> 'reasons' into v_reasons from jsonb_array_elements(p -> 'sellers') x
  where (x ->> 'seller_id')::uuid = current_setting('t.sendero')::uuid;
  assert v_reasons = '["shop_suspended"]'::jsonb, format('suspended: %s', v_reasons);
  assert (p ->> 'to_pay_count')::integer = 1, 'only TecnoCasa can be paid now';
end
$$;
reset role;

-- A higher minimum leaves out a shop that has less than that.
update public.app_settings set value = '900000000' where key = 'payout_minimum_minor';
select pg_temp.login('central@yuntera.example');
do $$
declare
  p jsonb := public.ops_payout_preview();
begin
  assert (p ->> 'to_pay_count')::integer = 0 and (p ->> 'minimum_minor')::bigint = 900000000,
    'nobody reaches a minimum of nine million colones';
  assert (select x -> 'reasons' from jsonb_array_elements(p -> 'sellers') x
          where (x ->> 'seller_id')::uuid = current_setting('t.tecnocasa')::uuid)
         = '["below_minimum"]'::jsonb, 'and the preview says so';
  assert (select x -> 'reasons' from jsonb_array_elements(p -> 'sellers') x
          where (x ->> 'seller_id')::uuid = current_setting('t.sendero')::uuid)
         = '["shop_suspended", "below_minimum"]'::jsonb, 'every reason is listed, not just the first';
end
$$;
reset role;
update public.app_settings set value = '500000' where key = 'payout_minimum_minor';
-- A setting that is not a number falls back to the default instead of breaking the screen.
update public.app_settings set value = '"mucho"' where key = 'payout_hold_days';
do $$
begin
  assert private.payout_hold_days() = 10, 'a broken setting falls back to ten days';
end
$$;
update public.app_settings set value = '10' where key = 'payout_hold_days';

-- The run: one payout per shop that can be paid, amounts frozen, ledger untouched.
select pg_temp.remember('payable_before', (
  select (-sum(e.amount_minor))::text from public.ledger_entries e
  join public.ledger_accounts a on a.id = e.account_id
  where a.seller_id = current_setting('t.tecnocasa')::uuid));
select pg_temp.remember('ledger_tx_before', (select count(*)::text from public.ledger_transactions));

select pg_temp.login('central@yuntera.example');
do $$
declare
  v_today date := current_setting('t.today')::date;
  v_tecnocasa uuid := current_setting('t.tecnocasa')::uuid;
  v_expected bigint := current_setting('t.expected_tecnocasa')::bigint;
  r jsonb := public.ops_create_payout_run(v_today);
  again jsonb;
  d jsonb;
  s jsonb;
begin
  assert (r ->> 'created')::integer = 1 and (r ->> 'total_minor')::bigint = v_expected
     and r ->> 'code' = 'PV-' || to_char(v_today, 'YYYYMMDD'),
    format('one payout, for TecnoCasa: %s', r);
  perform set_config('t.run', r ->> 'run_id', true);

  -- Calling again for the same cut-off schedules nothing more.
  again := public.ops_create_payout_run(v_today);
  assert again ->> 'run_id' = r ->> 'run_id' and (again ->> 'created')::integer = 0
     and (again ->> 'total_minor')::bigint = 0, format('the same run, nothing added: %s', again);
  assert probe.value('select count(*) from public.payout_runs')::integer = current_setting('t.runs_before')::integer + 1
     and probe.value('select count(*) from public.payouts')::integer = current_setting('t.payouts_before')::integer + 1,
    'one run, one payout';

  d := public.ops_payout_run((r ->> 'run_id')::uuid);
  assert d #>> '{run,code}' = r ->> 'code' and d #>> '{run,cutoff_on}' = v_today::text
     and (d #>> '{run,hold_days}')::integer = 10 and d #>> '{run,created_by_name}' = 'Gabriela Soto Marín',
    format('the run: %s', d -> 'run');
  -- The list for the bank: account in full, holder, amount, reference text.
  assert jsonb_array_length(d -> 'payouts') = 1
     and d #>> '{payouts,0,iban}' = 'CR23015108410026012345'
     and d #>> '{payouts,0,holder_name}' = 'Roberto Jiménez Arce'
     and (d #>> '{payouts,0,amount_minor}')::bigint = v_expected
     and d #>> '{payouts,0,reference}' = 'YUNTERA ' || (r ->> 'code') || '-001'
     and d #>> '{payouts,0,status}' = 'scheduled' and d #>> '{payouts,0,trade_name}' = 'TecnoCasa',
    format('the transfer list: %s', d -> 'payouts');
  perform set_config('t.payout', d #>> '{payouts,0,id}', true);

  -- Nothing is in the ledger yet: the money has only moved from available to in transit.
  assert (select count(*) from public.ledger_transactions) = current_setting('t.ledger_tx_before')::bigint,
    'creating a run posts nothing to the ledger';
  s := (select x from jsonb_array_elements(public.ops_payout_preview() -> 'sellers') x
        where (x ->> 'seller_id')::uuid = v_tecnocasa);
  assert (s ->> 'in_transit_minor')::bigint = v_expected and (s ->> 'available_minor')::bigint = 0
     and (s ->> 'payable_minor')::bigint = current_setting('t.payable_before')::bigint
     and not (s ->> 'will_pay')::boolean,
    format('scheduled money is in transit, not available: %s', s);
  assert public.ops_payout_preview() #>> '{run,code}' = r ->> 'code', 'the preview points to the run';

  -- A run keeps the rules it was created with, whatever the setting says later.
  assert jsonb_array_length(public.ops_payout_runs()) = current_setting('t.runs_before')::integer + 1
     and exists (select 1 from jsonb_array_elements(public.ops_payout_runs()) x
                 where x ->> 'code' = r ->> 'code' and (x ->> 'scheduled')::integer = 1
                   and (x ->> 'scheduled_minor')::bigint = v_expected and (x ->> 'paid')::integer = 0),
    'the list of runs';

  begin
    perform public.ops_payout_run(gen_random_uuid());
    raise exception 'opened a run that does not exist';
  exception when others then
    if sqlerrm <> 'payout_run_not_found' then raise; end if;
  end;
end
$$;
reset role;

select pg_temp.check_balances('after creating a run');

-- If the shop's approved account changes after a payout was scheduled, the run
-- says so: the transfer on the list would still go to the account frozen on it.
select pg_temp.login('central@yuntera.example');
do $$
begin
  assert not (public.ops_payout_run(current_setting('t.run')::uuid) #>> '{payouts,0,account_changed}')::boolean,
    'the frozen account is still the approved one';
end
$$;
reset role;
update public.seller_private set payout_iban = 'CR82010200009000000001'
where seller_id = current_setting('t.tecnocasa')::uuid;
select pg_temp.login('central@yuntera.example');
do $$
declare
  d jsonb := public.ops_payout_run(current_setting('t.run')::uuid);
begin
  assert (d #>> '{payouts,0,account_changed}')::boolean, 'a changed account is pointed out';
  assert d #>> '{payouts,0,iban}' = 'CR23015108410026012345', 'and the list still shows the frozen one';
end
$$;
reset role;
update public.seller_private set payout_iban = 'CR23015108410026012345'
where seller_id = current_setting('t.tecnocasa')::uuid;

-- Marking it paid: this is when the ledger changes. Once only.
select pg_temp.login('central@yuntera.example');
do $$
declare
  v_tecnocasa uuid := current_setting('t.tecnocasa')::uuid;
  v_payout uuid := current_setting('t.payout')::uuid;
  v_expected bigint := current_setting('t.expected_tecnocasa')::bigint;
  v_tx uuid;
  t record;
begin
  for t in select * from (values
    (format('select public.ops_mark_payout_paid(%L, ''12'')', v_payout), 'invalid_bank_reference'),
    (format('select public.ops_mark_payout_paid(%L, null)', v_payout), 'invalid_bank_reference'),
    (format('select public.ops_mark_payout_paid(%L, ''BNCR-2026-0001'')', gen_random_uuid()), 'payout_not_found'),
    (format('select public.ops_mark_payout_failed(%L, ''no'')', v_payout), 'reason_required'),
    (format('select public.ops_mark_payout_failed(%L, ''cuenta cerrada'')', gen_random_uuid()), 'payout_not_found')
  ) v (stmt, code) loop
    begin
      execute t.stmt;
      raise exception 'accepted';
    exception when others then
      if sqlerrm <> t.code then
        raise exception '%: % (expected %)', t.stmt, sqlerrm, t.code;
      end if;
    end;
  end loop;

  perform public.ops_mark_payout_paid(v_payout, '  BNCR-2026-0001 ');
  set constraints all immediate; -- the balance check on ledger entries runs now
  set constraints all deferred;

  v_tx := probe.value(format('select ledger_transaction_id from public.payouts where id = %L', v_payout))::uuid;
  assert probe.value(format(
           'select status || ''|'' || bank_reference || ''|'' || (paid_at is not null) || ''|'' || paid_by
            from public.payouts where id = %L', v_payout))
         = 'paid|BNCR-2026-0001|true|' || auth.uid(),
    'paid, with the bank''s reference and who recorded it';
  assert (select kind = 'payout' and created_by = auth.uid() from public.ledger_transactions where id = v_tx),
    'a payout transaction in the ledger';
  assert (select count(*) = 2 and sum(amount_minor) = 0 from public.ledger_entries where transaction_id = v_tx),
    'two entries that balance';
  assert (select amount_minor from public.ledger_entries e join public.ledger_accounts a on a.id = e.account_id
          where e.transaction_id = v_tx and a.seller_id = v_tecnocasa) = v_expected,
    'the seller''s account is debited: they are owed that much less';
  assert (select amount_minor from public.ledger_entries e join public.ledger_accounts a on a.id = e.account_id
          where e.transaction_id = v_tx and a.code = 'bank_operating' and a.kind = 'asset') = -v_expected,
    'and the operating bank account is credited: that much has left it';
  assert (public.seller_overview(v_tecnocasa) ->> 'payable_minor')::bigint
         = current_setting('t.payable_before')::bigint - v_expected,
    'the seller centre''s summary went down by the payout';

  -- A payout is paid once.
  begin
    perform public.ops_mark_payout_paid(v_payout, 'BNCR-2026-0002');
    raise exception 'paid the same payout twice';
  exception when others then
    if sqlerrm <> 'payout_not_scheduled' then raise; end if;
  end;
  assert (select count(*) from public.ledger_transactions where kind = 'payout')
         = current_setting('t.payout_tx_before')::bigint + 1,
    'and the ledger has it once';
end
$$;
reset role;

select pg_temp.check_balances('after paying');

-- A refund after the payout was paid leaves the shop with less (here: a
-- negative amount) available, recovered from its next sales. The paid amount
-- does not move. (A refund between scheduling and paying stops the payment
-- instead, since 21 November 2026: see 115_integrity.sql, INT-10.)
select pg_temp.login('comprador@yuntera.example');
select set_config('t.return', public.request_return((
  select i.id from public.order_items i join public.orders o on o.id = i.order_id
  where o.idempotency_key = 'seed-h01' and i.seller_id = current_setting('t.tecnocasa')::uuid
  limit 1), 'damaged', 1, 'La caja llegó abierta y el producto golpeado.')::text, true);
reset role;

select pg_temp.login('central@yuntera.example');
do $$
declare
  v_tecnocasa uuid := current_setting('t.tecnocasa')::uuid;
  v_debit bigint;
  s jsonb;
begin
  perform public.ops_decide_return(current_setting('t.return')::uuid, true, null);
  perform public.ops_receive_return(current_setting('t.return')::uuid, true, null);
  v_debit := (public.ops_complete_return(current_setting('t.return')::uuid) ->> 'seller_debit_minor')::bigint;
  assert v_debit > 0, 'the seller gives back what they were paid for the returned unit';
  assert probe.value(format('select amount_minor from public.payouts where id = %L', current_setting('t.payout')))
         = current_setting('t.expected_tecnocasa'), 'the scheduled amount did not move';
  s := (select x from jsonb_array_elements(public.ops_payout_preview() -> 'sellers') x
        where (x ->> 'seller_id')::uuid = v_tecnocasa);
  assert (s ->> 'available_minor')::bigint = -v_debit
     and (s ->> 'payable_minor')::bigint = current_setting('t.payable_before')::bigint
                                          - current_setting('t.expected_tecnocasa')::bigint - v_debit,
    format('the refund comes out of what is available: %s', s);
  perform set_config('t.debit', v_debit::text, true);
end
$$;
reset role;

select pg_temp.check_balances('after a refund on a paid-out order');

-- Money that becomes available after a shop was paid in a run is paid by the
-- same run when it is called again, as the preview says: a second payout for
-- that shop, with its own reference. (Here a credit not tied to any order.)
savepoint second_in_run;
do $$
declare
  v_tx uuid;
begin
  insert into public.ledger_transactions (kind, memo) values ('adjustment', 'Ajuste de prueba')
  returning id into v_tx;
  insert into public.ledger_entries (transaction_id, account_id, amount_minor)
  select v_tx, id, -(600000 + current_setting('t.debit')::bigint)
  from public.ledger_accounts where seller_id = current_setting('t.tecnocasa')::uuid;
  insert into public.ledger_entries (transaction_id, account_id, amount_minor)
  select v_tx, id, 600000 + current_setting('t.debit')::bigint
  from public.ledger_accounts where code = 'cash_over_short';
end
$$;
select pg_temp.login('central@yuntera.example');
do $$
declare
  v_tecnocasa uuid := current_setting('t.tecnocasa')::uuid;
  s jsonb := (select x from jsonb_array_elements(public.ops_payout_preview() -> 'sellers') x
              where (x ->> 'seller_id')::uuid = current_setting('t.tecnocasa')::uuid);
  r jsonb;
begin
  assert (s ->> 'will_pay')::boolean and (s ->> 'available_minor')::bigint = 600000,
    format('the preview offers to pay it: %s', s);
  r := public.ops_create_payout_run(current_setting('t.today')::date);
  assert r ->> 'run_id' = current_setting('t.run') and (r ->> 'created')::integer = 1
     and (r ->> 'total_minor')::bigint = 600000, format('and the run does: %s', r);
  assert probe.value(format(
           'select count(*) || ''|'' || count(distinct reference) from public.payouts where run_id = %L and seller_id = %L',
           current_setting('t.run'), v_tecnocasa)) = '2|2', 'two payouts for the shop, each with its reference';
end
$$;
reset role;
select pg_temp.check_balances('a second payout in the same run');
rollback to savepoint second_in_run;

-- The seller sees it.
select pg_temp.login('vendedor@yuntera.example');
do $$
declare
  v_tecnocasa uuid := current_setting('t.tecnocasa')::uuid;
  v_expected bigint := current_setting('t.expected_tecnocasa')::bigint;
  v jsonb := public.seller_payouts(v_tecnocasa);
begin
  assert (v ->> 'available_minor')::bigint + (v ->> 'pending_minor')::bigint + (v ->> 'in_transit_minor')::bigint
         = (v ->> 'payable_minor')::bigint, 'the three balances add up';
  assert (v ->> 'in_transit_minor')::bigint = 0 and (v ->> 'available_minor')::bigint = -current_setting('t.debit')::bigint,
    format('nothing in transit any more: %s', v - 'payouts' - 'releases');
  assert (v ->> 'hold_days')::integer = 10 and v ->> 'as_of' = current_setting('t.today')
     and v ->> 'delivered_through' = (current_setting('t.today')::date - 10)::text
     and (v ->> 'minimum_minor')::bigint = 500000, 'the hold, with its dates';
  -- The pending part is explained to the last céntimo: by release day, or still on its way.
  assert (select coalesce(sum((x ->> 'amount_minor')::bigint), 0) from jsonb_array_elements(v -> 'releases') x)
         + (v ->> 'awaiting_delivery_minor')::bigint = (v ->> 'pending_minor')::bigint,
    format('releases + undelivered = pending: %s', v - 'payouts');
  assert jsonb_array_length(v -> 'releases') > 0
     and (select bool_and((x ->> 'on')::date > current_setting('t.today')::date)
          from jsonb_array_elements(v -> 'releases') x), 'every release day is in the future';
  assert v -> 'blocked_by' = '["below_minimum"]'::jsonb, 'and why no payout is due right now';
  assert v #>> '{account,iban_masked}' = 'CR•• •••• •••• •••• 2345', 'where they are paid, masked';

  assert jsonb_array_length(v -> 'payouts') = current_setting('t.tecnocasa_payouts_before')::integer + 1
     and v #>> '{payouts,0,status}' = 'paid' and (v #>> '{payouts,0,amount_minor}')::bigint = v_expected
     and v #>> '{payouts,0,bank_reference}' = 'BNCR-2026-0001'
     and v #>> '{payouts,0,reference}' like 'YUNTERA PV-%-001'
     and v #>> '{payouts,0,cutoff_on}' = current_setting('t.today')
     and v #>> '{payouts,0,iban_masked}' = 'CR•• •••• •••• •••• 2345'
     and v #>> '{payouts,0,paid_at}' is not null,
    format('the payout, with the bank reference: %s', v -> 'payouts');
  assert position('015108410026012345' in v::text) = 0, 'and never the whole account number';

  -- Their other shop has its own numbers; a shop that is not theirs is closed to them.
  assert jsonb_array_length(public.seller_payouts(current_setting('t.ferreteria')::uuid) -> 'payouts') = 0,
    'no payouts for the other shop';
  begin
    perform public.seller_payouts(current_setting('t.cafetal')::uuid);
    raise exception 'read another seller''s payouts';
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
  -- Sellers cannot run any of finance's steps on their own payout.
  begin
    perform public.ops_mark_payout_failed(current_setting('t.payout')::uuid, 'No me llegó el dinero.');
    raise exception 'a seller reversed their own payout';
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
end
$$;
reset role;

-- A payout that does not go through returns to "available" and is picked up again.
update public.seller_private
set payout_iban = 'CR05015202001026284066', payout_holder_name = 'Cafetal Los Santos S.R.L.'
where seller_id = current_setting('t.cafetal')::uuid;

select pg_temp.login('central@yuntera.example');
do $$
declare
  v_today date := current_setting('t.today')::date;
  v_cafetal uuid := current_setting('t.cafetal')::uuid;
  v_expected bigint := current_setting('t.expected_cafetal')::bigint;
  v_tx_before bigint := (select count(*) from public.ledger_transactions);
  r jsonb;
  v_first uuid;
  v_second uuid;
  s jsonb;
begin
  -- Cafetal has an account again, so the same cut-off now adds it — and only it.
  r := public.ops_create_payout_run(v_today);
  assert r ->> 'run_id' = current_setting('t.run') and (r ->> 'created')::integer = 1
     and (r ->> 'total_minor')::bigint = v_expected, format('Cafetal joins the run: %s', r);
  v_first := probe.value(format(
    'select id from public.payouts where seller_id = %L and status = ''scheduled''', v_cafetal))::uuid;
  assert probe.value(format('select reference from public.payouts where id = %L', v_first))
         like 'YUNTERA PV-%-002', 'numbered after the first';

  perform public.ops_mark_payout_failed(v_first, 'El banco rechazó la cuenta: está cerrada.');
  assert probe.value(format(
           'select status || ''|'' || (failed_at is not null) || ''|'' || failed_by || ''|'' || failure_reason
            from public.payouts where id = %L', v_first))
         = 'failed|true|' || auth.uid() || '|El banco rechazó la cuenta: está cerrada.',
    'failed, with the reason and who recorded it';
  assert (select count(*) from public.ledger_transactions) = v_tx_before,
    'a payout that was never paid leaves the ledger alone';
  s := (select x from jsonb_array_elements(public.ops_payout_preview() -> 'sellers') x
        where (x ->> 'seller_id')::uuid = v_cafetal);
  assert (s ->> 'available_minor')::bigint = v_expected and (s ->> 'in_transit_minor')::bigint = 0
     and (s ->> 'will_pay')::boolean, format('the amount is available again: %s', s);

  -- Failed is final for that payout: it cannot be paid or failed again.
  begin
    perform public.ops_mark_payout_paid(v_first, 'BNCR-2026-0003');
    raise exception 'paid a failed payout';
  exception when others then
    if sqlerrm <> 'payout_not_scheduled' then raise; end if;
  end;
  begin
    perform public.ops_mark_payout_failed(v_first, 'Otra vez el mismo motivo.');
    raise exception 'failed a payout twice';
  exception when others then
    if sqlerrm <> 'payout_not_scheduled' then raise; end if;
  end;

  -- The next call schedules a fresh payout for it.
  r := public.ops_create_payout_run(v_today);
  assert (r ->> 'created')::integer = 1, 'a new payout replaces the failed one';
  v_second := probe.value(format(
    'select id from public.payouts where seller_id = %L and status = ''scheduled''', v_cafetal))::uuid;
  assert v_second <> v_first
     and probe.value(format('select reference from public.payouts where id = %L', v_second))
         like 'YUNTERA PV-%-003', 'with its own reference';

  -- One bank transfer settles one payout.
  begin
    perform public.ops_mark_payout_paid(v_second, 'BNCR-2026-0001');
    raise exception 'reused a bank reference';
  exception when others then
    if sqlerrm <> 'bank_reference_used' then raise; end if;
  end;
  assert probe.value(format('select status from public.payouts where id = %L', v_second)) = 'scheduled',
    'and nothing was recorded';

  -- Paid, then returned by the bank the next day: the ledger entry is reversed.
  perform public.ops_mark_payout_paid(v_second, 'BNCR-2026-0004');
  s := (select x from jsonb_array_elements(public.ops_payout_preview() -> 'sellers') x
        where (x ->> 'seller_id')::uuid = v_cafetal);
  assert (s ->> 'available_minor')::bigint = 0 and (s ->> 'in_transit_minor')::bigint = 0
     and (s ->> 'payable_minor')::bigint = (s ->> 'pending_minor')::bigint,
    format('paid: only what is still pending is owed: %s', s);
  perform public.ops_mark_payout_failed(v_second, 'El banco devolvió la transferencia al día siguiente.');
  set constraints all immediate;
  set constraints all deferred;
  s := (select x from jsonb_array_elements(public.ops_payout_preview() -> 'sellers') x
        where (x ->> 'seller_id')::uuid = v_cafetal);
  assert (s ->> 'available_minor')::bigint = v_expected and (s ->> 'in_transit_minor')::bigint = 0,
    format('a returned transfer is owed again: %s', s);
  assert (select coalesce(sum(e.amount_minor), 0) from public.ledger_entries e
          join public.ledger_accounts a on a.id = e.account_id where a.code = 'bank_operating')
         = -current_setting('t.expected_tecnocasa')::bigint,
    'the bank account shows only the one transfer that stayed sent';

  assert exists (select 1 from jsonb_array_elements(public.ops_payout_runs()) x
                 where x ->> 'id' = current_setting('t.run') and (x ->> 'paid')::integer = 1
                   and (x ->> 'failed')::integer = 2 and (x ->> 'scheduled')::integer = 0),
    'the run''s tally';
end
$$;
reset role;

select pg_temp.check_balances('after a failed and a returned payout');

-- Finance staff cannot write payouts except through the functions.
insert into public.staff_members (user_id, role)
select id, 'finance' from auth.users where email = 'comprador3@yuntera.example';
select pg_temp.stop_inspection();
select pg_temp.login('comprador3@yuntera.example');
do $$
declare
  t record;
begin
  assert jsonb_array_length(public.ops_payout_runs()) = current_setting('t.runs_before')::integer + 1,
    'finance (not only an administrator) reads the runs';
  for t in select * from (values
    ('update public.payouts set status = ''paid'''),
    ('insert into public.payouts (seller_id, amount_minor) select id, 100 from public.sellers limit 1'),
    ('select payout_iban from public.payouts'),
    ('select payout_iban from public.seller_private'),
    ('update public.payout_detail_requests set status = ''approved''')
  ) v (stmt) loop
    begin
      execute t.stmt;
      raise exception 'accepted';
    exception when insufficient_privilege then
      null; -- expected
    when others then
      raise exception '%: % (expected permission denied)', t.stmt, sqlerrm;
    end;
  end loop;
end
$$;
reset role;
select pg_temp.allow_inspection();

-- With no hold, only what is still on its way is pending.
update public.app_settings set value = '0' where key = 'payout_hold_days';
do $$
declare
  b record;
begin
  for b in select * from private.seller_balances(private.cr_local(now())::date, private.payout_hold_days()) loop
    assert b.pending_minor = (
      select coalesce(-sum(e.amount_minor), 0)
      from public.ledger_entries e
      join public.ledger_accounts a on a.id = e.account_id
      join public.ledger_transactions t on t.id = e.transaction_id
      join public.orders o on o.id = t.order_id
      where a.seller_id = b.seller_id and o.delivered_at is null),
      'without a hold, pending is exactly the undelivered orders';
  end loop;
end
$$;
select pg_temp.check_balances('with no hold');

rollback;
