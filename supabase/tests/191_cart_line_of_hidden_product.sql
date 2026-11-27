-- What public.cart_lines (20261121085000) gives for an offer whose product the
-- caller may not see, and what public.checkout_quote counts of such an offer.
--
--   right caller: staff and the product's own shop read the whole line of an
--                 active offer of a product that is not public (awaiting
--                 review, rejected, archived), not buyable; anyone reads the
--                 line of a public product's active offer; a paused offer of a
--                 public product still names its product (084600);
--   wrong caller: a visitor, another shopper and another shop read nothing
--                 but the id of such an offer (buyable false, available 0,
--                 every other column null), the same as for a made-up id; a
--                 quote does not move its date for the handling days of an
--                 offer it cannot sell (the date leaked them);
--   left behind:  nothing (reads; the product's status, the paused offer and
--                 the handling days are put back by rollback).

begin;
\ir _helpers.sql
select pg_temp.allow_inspection();
\ir _money_helpers.sql

-- The notebook: created and sold by Tienda Sendero (sendero@), delivered from
-- the warehouse. Ferretería El Higuerón (vendedor@) is another shop.
select pg_temp.remember('offer', (
  select o.id::text from public.offers o
  join public.skus k on k.id = o.sku_id join public.products p on p.id = k.product_id
  join public.sellers s on s.id = o.seller_id
  where p.slug = 'libreta-tapa-dura-a5' and o.status = 'active' and s.slug = 'tienda-sendero'
  order by o.id limit 1));

do $$ begin
  assert current_setting('t.offer') <> '', 'seed: an active offer of the notebook by Tienda Sendero';
  assert (select p.status from public.products p where p.slug = 'libreta-tapa-dura-a5') = 'active',
    'seed: the notebook is public';
end $$;

-- A line is "the id alone": what a made-up id gives.
create function pg_temp.id_only(r record, p_offer uuid) returns boolean
language plpgsql as $$
begin
  return r.offer_id = p_offer and r.buyable is false
     and r.product_slug is null and r.title is null and r.variant_name is null and r.image_path is null
     and r.seller_name is null and r.price_minor is null and r.list_price_minor is null
     and r.available = 0 and r.fulfillment is null and r.handling_days is null;
end;
$$;

do $$
declare
  v_offer uuid := current_setting('t.offer')::uuid;
  v_ghost uuid := gen_random_uuid();
  v_title text := (select title from public.products where slug = 'libreta-tapa-dura-a5');
  v_shop text := (select trade_name from public.sellers where slug = 'tienda-sendero');
  r record;
  who text;
  st public.product_status;
begin
  -- A public product's active offer: the whole line, buyable, for everyone.
  foreach who in array array['', 'comprador@yuntera.example', 'vendedor@yuntera.example',
                             'sendero@yuntera.example', 'central@yuntera.example'] loop
    if who = '' then perform pg_temp.logout(); else perform pg_temp.act(who); end if;
    select * into r from public.cart_lines(array[v_offer]);
    assert r.buyable and r.title = v_title and r.seller_name = v_shop and r.price_minor > 0
           and r.available > 0 and r.fulfillment = 'platform',
      format('%s: the whole line of a public product', coalesce(nullif(who, ''), 'visitor'));
    -- A made-up id: the id alone.
    select * into r from public.cart_lines(array[v_ghost]);
    assert pg_temp.id_only(r, v_ghost),
      format('%s: a made-up id gives its id alone', coalesce(nullif(who, ''), 'visitor'));
  end loop;
  perform pg_temp.logout();

  -- The same active offer while its product is not public.
  foreach st in array array['pending_review', 'rejected', 'archived']::public.product_status[] loop
    update public.products set status = st where slug = 'libreta-tapa-dura-a5';

    -- Wrong callers: the id alone, the same answer as a made-up id.
    foreach who in array array['', 'comprador@yuntera.example', 'vendedor@yuntera.example'] loop
      if who = '' then perform pg_temp.logout(); else perform pg_temp.act(who); end if;
      select * into r from public.cart_lines(array[v_offer]);
      assert pg_temp.id_only(r, v_offer),
        format('%s, product %s: only the id, got shop %s, price %s, available %s, %s, %s days',
               coalesce(nullif(who, ''), 'visitor'), st, r.seller_name, r.price_minor, r.available,
               r.fulfillment, r.handling_days);
    end loop;

    -- Right callers: staff and the product's own shop keep what they read before.
    foreach who in array array['sendero@yuntera.example', 'central@yuntera.example'] loop
      perform pg_temp.act(who);
      select * into r from public.cart_lines(array[v_offer]);
      assert not r.buyable and r.title = v_title and r.product_slug = 'libreta-tapa-dura-a5'
             and r.seller_name = v_shop and r.price_minor > 0 and r.fulfillment = 'platform'
             and r.handling_days is not null,
        format('%s, product %s: the whole line, not buyable', who, st);
    end loop;
    perform pg_temp.logout();
  end loop;
  update public.products set status = 'active' where slug = 'libreta-tapa-dura-a5';

  -- A paused offer of a public product still names its product (084600), and
  -- nothing of the offer itself.
  update public.offers set status = 'paused' where id = v_offer;
  foreach who in array array['', 'comprador@yuntera.example', 'vendedor@yuntera.example'] loop
    if who = '' then perform pg_temp.logout(); else perform pg_temp.act(who); end if;
    select * into r from public.cart_lines(array[v_offer]);
    assert not r.buyable and r.title = v_title and r.product_slug = 'libreta-tapa-dura-a5'
           and r.seller_name is null and r.price_minor is null and r.list_price_minor is null
           and r.available = 0 and r.fulfillment is null and r.handling_days is null,
      format('%s: a paused offer of a public product names the product alone',
             coalesce(nullif(who, ''), 'visitor'));
  end loop;
  -- Its own shop still reads the whole line.
  perform pg_temp.act('sendero@yuntera.example');
  select * into r from public.cart_lines(array[v_offer]);
  assert not r.buyable and r.title = v_title and r.seller_name = v_shop and r.price_minor > 0,
    'own shop: the whole line of its paused offer';
  perform pg_temp.logout();
  update public.offers set status = 'active' where id = v_offer;

  -- Several lines keep the order asked for.
  update public.products set status = 'archived' where slug = 'libreta-tapa-dura-a5';
  assert (select array_agg(c.offer_id order by n)
          from (select x.offer_id, row_number() over () as n
                from public.cart_lines(array[v_ghost, v_offer]) x) c) = array[v_ghost, v_offer],
    'lines come back in the order asked for';
  update public.products set status = 'active' where slug = 'libreta-tapa-dura-a5';
end $$;

-- ═══ checkout_quote: the date counts only what can be sold ═════════════════

-- The bulb: delivered by Ferretería El Higuerón itself, so its handling days
-- move the date. Ten days, so the difference cannot hide in a weekend.
update public.offers o set handling_days = 10
from public.skus k, public.products p
where k.id = o.sku_id and p.id = k.product_id and p.slug = 'bombillo-led-9w-4u' and o.fulfillment = 'seller';
update public.delivery_zones set active = true where id in ('gam-core', 'gam-extended') and not active;
update public.districts set served = true where not served;

do $$
declare
  v_postal text := (select a.postal_code from public.addresses a join auth.users u on u.id = a.user_id
                    where u.email = 'comprador@yuntera.example' and a.is_default and a.deleted_at is null);
  v_notebook jsonb := jsonb_build_object('offer_id', current_setting('t.offer'), 'quantity', 1);
  v_bulb jsonb := jsonb_build_object('offer_id', (
    select o.id from public.offers o join public.skus k on k.id = o.sku_id
    join public.products p on p.id = k.product_id
    where p.slug = 'bombillo-led-9w-4u' and o.fulfillment = 'seller' order by o.id limit 1), 'quantity', 1);
  q_alone jsonb;
  q_both jsonb;
  who text;
begin
  assert v_postal is not null, 'seed: the shopper''s district';
  foreach who in array array['', 'comprador@yuntera.example'] loop
    -- Setup as the database (the status guard asks staff for a person).
    perform pg_temp.logout();
    update public.products set status = 'active' where slug = 'bombillo-led-9w-4u';
    if who <> '' then perform pg_temp.act(who); end if;
    q_alone := public.checkout_quote(jsonb_build_array(v_notebook), v_postal);
    -- Right caller: the bulb is public, so its ten days count.
    q_both := public.checkout_quote(jsonb_build_array(v_notebook, v_bulb), v_postal);
    assert q_alone ->> 'issue' is null and q_both ->> 'issue' is null, 'quote: both can be sold';
    assert (q_both #>> '{promise,latest}')::date > (q_alone #>> '{promise,latest}')::date,
      format('quote: the seller''s handling days move the date of what can be sold (%s, %s)',
             q_alone -> 'promise', q_both -> 'promise');

    -- Wrong caller: the bulb's product is archived; its days no longer count.
    perform pg_temp.logout();
    update public.products set status = 'archived' where slug = 'bombillo-led-9w-4u';
    if who <> '' then perform pg_temp.act(who); end if;
    q_both := public.checkout_quote(jsonb_build_array(v_notebook, v_bulb), v_postal);
    assert q_both ->> 'issue' = 'offer_unavailable'
           and q_both ->> 'unavailable_offer_id' = v_bulb ->> 'offer_id',
      format('quote: the archived offer cannot be sold %s', q_both);
    assert q_both -> 'promise' = q_alone -> 'promise'
           and (q_both ->> 'items_total_minor')::bigint = (q_alone ->> 'items_total_minor')::bigint,
      format('%s: the date and the total ignore the offer that cannot be sold (%s against %s)',
             coalesce(nullif(who, ''), 'visitor'), q_both -> 'promise', q_alone -> 'promise');
  end loop;
  perform pg_temp.logout();
end $$;

-- Who may call it is unchanged: visitors and signed-in people, nobody by default.
do $$ begin
  assert has_function_privilege('anon', 'public.cart_lines(uuid[])', 'execute')
         and has_function_privilege('authenticated', 'public.cart_lines(uuid[])', 'execute'),
    'grants: visitors and signed-in people call cart_lines';
  assert not has_function_privilege('anon', 'private.price_items(jsonb, integer)', 'execute')
         and not has_function_privilege('authenticated', 'private.price_items(jsonb, integer)', 'execute'),
    'grants: nobody calls private.price_items';
  assert (select p.prosecdef and p.proconfig = array['search_path=""']
          from pg_proc p where p.oid = 'public.cart_lines(uuid[])'::regprocedure),
    'cart_lines: a definer with an empty search path';
end $$;

select 'ok' as cart_line_of_hidden_product;
rollback;
