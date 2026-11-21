-- Delivery promise and business-day arithmetic.
-- Replays the cases in packages/core/src/promise.test.ts against the SQL
-- implementation. Where a result differs from the TypeScript test it is because
-- the database knows the real holiday calendar (1 December 2026 is a holiday).

begin;

-- Builds an instant from a Costa Rican wall-clock time (UTC−6).
create function pg_temp.cr(p_local timestamp) returns timestamptz
language sql as $$ select (p_local + interval '6 hours') at time zone 'UTC' $$;

do $$
declare
  p record;
begin
  -- Monday before the cutoff: dispatched today, delivered tomorrow.
  select * into p from private.compute_promise('gam-core', 0, pg_temp.cr('2026-11-23 10:00'));
  assert p.dispatch_date = '2026-11-23' and p.earliest = '2026-11-24' and p.latest = '2026-11-24',
    format('before cutoff: %s', p);

  -- At the cutoff hour: rolls to the next day.
  select * into p from private.compute_promise('gam-core', 0, pg_temp.cr('2026-11-23 14:00'));
  assert p.dispatch_date = '2026-11-24' and p.latest = '2026-11-25', format('after cutoff: %s', p);

  -- Saturday afternoon: no Sunday service, and Tuesday 1 December is a holiday.
  select * into p from private.compute_promise('gam-core', 0, pg_temp.cr('2026-11-28 15:00'));
  assert p.dispatch_date = '2026-11-30' and p.latest = '2026-12-02', format('weekend + holiday: %s', p);

  -- Seller handling time is counted in processing days: Fri → Sat → Mon.
  select * into p from private.compute_promise('gam-core', 2, pg_temp.cr('2026-11-27 10:00'));
  assert p.dispatch_date = '2026-11-30' and p.latest = '2026-12-02', format('handling days: %s', p);

  -- A zone with variable transit gives a window, on weekdays only.
  select * into p from private.compute_promise('national', 0, pg_temp.cr('2026-11-23 09:00'));
  assert p.earliest = '2026-11-25' and p.latest = '2026-11-30', format('window: %s', p);

  -- 23:30 on Monday in Costa Rica is already Tuesday in UTC; the local date rules.
  select * into p from private.compute_promise('gam-core', 0, pg_temp.cr('2026-11-23 23:30'));
  assert p.dispatch_date = '2026-11-24' and p.latest = '2026-11-25', format('midnight: %s', p);

  -- A delivery day that is full is skipped.
  insert into public.zone_closures (zone_id, day) values ('gam-core', '2026-11-24');
  select * into p from private.compute_promise('gam-core', 0, pg_temp.cr('2026-11-23 10:00'));
  assert p.latest = '2026-11-25', format('closure: %s', p);
end
$$;

do $$
begin
  assert private.add_business_days('2026-11-27', 1) = '2026-11-30', 'Friday + 1 is Monday';
  assert private.add_business_days('2026-11-28', 1) = '2026-11-30', 'Saturday + 1 is Monday';
  -- Eight business days from Monday 23 November, skipping the 1 December holiday.
  assert private.add_business_days('2026-11-23', 8) = '2026-12-04', 'withdrawal window';
  assert private.add_business_days('2026-11-23', 0) = '2026-11-23', 'zero days';
end
$$;

-- An unknown zone is an error, not a silent null.
do $$
begin
  perform private.compute_promise('nowhere', 0);
  raise exception 'should have failed';
exception when others then
  if sqlerrm <> 'zone_not_found' then raise; end if;
end
$$;

-- The storefront estimate reports inactive zones honestly instead of hiding them.
do $$
declare
  e record;
begin
  select * into e from public.delivery_estimate('11501');
  assert e.zone_id = 'gam-core' and e.zone_active and e.cod_available, format('San Pedro: %s', e);
  select * into e from public.delivery_estimate('70101');
  assert e.zone_id = 'national' and not e.zone_active, format('Limón: %s', e);
  assert not exists (select 1 from public.delivery_estimate('99999')), 'unknown postal code';
end
$$;

rollback;
