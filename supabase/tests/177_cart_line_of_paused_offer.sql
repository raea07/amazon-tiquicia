-- What public.cart_lines (20261121084600) gives for a cart line whose offer
-- the caller can no longer see. The product's own facts come through whenever
-- the caller may see the product; the offer's own facts never do.
--
--   right caller: a visitor and a shopper read the name, variant and photo of
--                 an active product whose offer was paused, and that it
--                 cannot be bought; the offer's own seller still reads all of
--                 it;
--   wrong caller: neither reads the paused offer's shop, price or stock, and
--                 neither reads anything of a listing awaiting review (an
--                 offer of a seller awaiting approval);
--   left behind:  nothing (a read; the paused offer is put back by rollback).

begin;
\ir _helpers.sql
select pg_temp.allow_inspection();
\ir _money_helpers.sql

select pg_temp.remember('paused', (
  select o.id::text from public.offers o
  join public.skus k on k.id = o.sku_id join public.products p on p.id = k.product_id
  join public.sellers s on s.id = o.seller_id
  where p.slug = 'libreta-tapa-dura-a5' and o.status = 'active' and s.status = 'active'
  order by o.id limit 1));
select pg_temp.remember('pending', (
  select o.id::text from public.offers o
  join public.skus k on k.id = o.sku_id join public.products p on p.id = k.product_id
  join public.sellers s on s.id = o.seller_id
  where p.slug = 'lampara-mesa-bambu' and s.status <> 'active'
  order by o.id limit 1));
update public.offers set status = 'paused' where id = current_setting('t.paused')::uuid;

do $$
declare
  v_paused uuid := current_setting('t.paused')::uuid;
  v_pending uuid := current_setting('t.pending')::uuid;
  v_title text := (select p.title from public.offers o join public.skus k on k.id = o.sku_id
                   join public.products p on p.id = k.product_id where o.id = v_paused);
  v_variant text := (select k.variant_name from public.offers o join public.skus k on k.id = o.sku_id
                     where o.id = v_paused);
  v_owner text := (select u.email from public.offers o
                   join public.seller_members m on m.seller_id = o.seller_id
                   join auth.users u on u.id = m.user_id where o.id = v_paused
                   order by u.email limit 1);
  r record;
  who text;
begin
  assert v_paused is not null and v_pending is not null, 'seed: both offers found';

  foreach who in array array['', 'comprador@yuntera.example'] loop
    if who = '' then perform pg_temp.logout(); else perform pg_temp.act(who); end if;
    select * into r from public.cart_lines(array[v_paused]);
    assert r.offer_id = v_paused and not r.buyable,
      format('%s: the paused offer cannot be bought', coalesce(nullif(who, ''), 'visitor'));
    assert r.title = v_title and r.product_slug = 'libreta-tapa-dura-a5'
           and r.variant_name is not distinct from v_variant,
      format('%s: the line names its product, got %s', coalesce(nullif(who, ''), 'visitor'), r.title);
    assert r.seller_name is null and r.price_minor is null and r.list_price_minor is null
           and r.available = 0 and r.fulfillment is null and r.handling_days is null,
      format('%s: nothing of the paused offer itself', coalesce(nullif(who, ''), 'visitor'));

    select * into r from public.cart_lines(array[v_pending]);
    assert r.offer_id = v_pending and not r.buyable and r.product_slug is null and r.title is null
           and r.image_path is null and r.seller_name is null and r.price_minor is null,
      format('%s: nothing of a listing awaiting review', coalesce(nullif(who, ''), 'visitor'));
    perform pg_temp.logout();
  end loop;

  -- The offer's own seller still reads the whole line.
  if v_owner is not null then
    perform pg_temp.act(v_owner);
    select * into r from public.cart_lines(array[v_paused]);
    assert not r.buyable and r.title = v_title and r.seller_name is not null and r.price_minor is not null,
      'own seller: the whole line, not buyable';
    perform pg_temp.logout();
  end if;
end $$;

select 'ok' as cart_line_of_paused_offer;
rollback;
