-- Search: accents, synonyms, typos, filters, sorting, and what must never appear.

begin;
\ir _helpers.sql

select pg_temp.login_anon();

do $$
declare
  n integer;
  first record;
begin
  -- Accents and case make no difference.
  assert (select count(*) from public.search_products('café')) = (select count(*) from public.search_products('CAFE')),
    'accent- and case-insensitive';
  assert exists (select 1 from public.search_products('audifonos') where slug like 'audifonos-%'),
    '"audifonos" finds "Audífonos"';

  -- The best match for a specific query comes first.
  select * into first from public.search_products('cafe molido') limit 1;
  assert first.slug = 'cafe-molido-tarrazu-340g', format('top result for "cafe molido" was %s', first.slug);
  select * into first from public.search_products('laptop') limit 1;
  assert first.slug = 'laptop-14-nimbo-libro', format('top result for "laptop" was %s', first.slug);

  -- Everyday words reach the catalogue's vocabulary.
  assert exists (select 1 from public.search_products('ventilador') where slug = 'abanico-pie-volcan-18'),
    '"ventilador" finds the abanico';
  assert exists (select 1 from public.search_products('mochila') where slug = 'salveque-urbano-sendero-25l'),
    '"mochila" finds the salveque';
  assert exists (select 1 from public.search_products('bola') where slug = 'balon-futbol-sendero-5'),
    '"bola" finds the balón';
  assert exists (select 1 from public.search_products('compu') where slug = 'laptop-14-nimbo-libro'),
    '"compu" finds the laptop';

  -- A typo still finds the product.
  assert exists (select 1 from public.search_products('licuadra') where slug = 'licuadora-volcan-600w'),
    'typo tolerance';
  assert exists (select 1 from public.search_products('chorreadr') where slug = 'chorreador-madera-artesanal'),
    'typo tolerance on a longer word';

  -- Nonsense finds nothing rather than everything.
  assert (select count(*) from public.search_products('xqzvwk')) = 0, 'no results for nonsense';

  -- No query: the full catalogue, paged.
  select count(*) into n from public.search_products(null, null, null, null, false, false, 'relevance', 60);
  assert n = 26, format('browse returns the whole catalogue, got %s', n);
  assert (select count(*) from public.search_products(p_limit => 5)) = 5, 'limit is honoured';
  assert (select max(total_count) from public.search_products(p_limit => 5)) = 26, 'total count spans all pages';
  assert (select count(*) from public.search_products(p_limit => 500)) <= 60, 'page size is capped';
  assert not exists (
    select 1 from public.search_products(p_limit => 13, p_offset => 0) a
    join public.search_products(p_limit => 13, p_offset => 13) b using (product_id)
  ), 'pages do not overlap';
end
$$;

do $$
declare
  prices bigint[];
begin
  -- A category includes its sub-categories.
  assert (select count(*) from public.search_products(p_category_slug => 'electronica')) = 2,
    'electronica contains the audio products';
  assert (select bool_and(category_slug = 'cafe') from public.search_products(p_category_slug => 'cafe')),
    'leaf category';
  assert (select count(*) from public.search_products(p_category_slug => 'no-existe')) = 0, 'unknown category';

  -- Price range, in céntimos.
  assert (select bool_and(min_price_minor between 500000 and 1000000)
          from public.search_products(p_min_price_minor => 500000, p_max_price_minor => 1000000)),
    'price filter';

  assert (select bool_and(made_in_cr) and count(*) > 0 from public.search_products(p_made_in_cr => true)),
    'made-in-Costa-Rica filter';

  select array_agg(min_price_minor) into prices
  from public.search_products(p_sort => 'price_asc', p_limit => 60);
  assert prices = (select array_agg(p order by p) from unnest(prices) p), 'sorted by price ascending';

  select array_agg(min_price_minor) into prices
  from public.search_products(p_sort => 'price_desc', p_limit => 60);
  assert prices = (select array_agg(p order by p desc) from unnest(prices) p), 'sorted by price descending';

  assert (select bool_and(score between 0 and 1) from public.search_products('cafe')), 'scores stay in range';
end
$$;

do $$
begin
  perform public.search_products(p_sort => 'cheapest; drop table products');
  raise exception 'accepted an unknown sort';
exception when others then
  if sqlerrm <> 'invalid_sort' then raise; end if;
end
$$;

-- A listing that is not live never appears, whatever is searched for.
do $$
begin
  assert not exists (select 1 from public.search_products('lampara bambu')), 'pending listing by name';
  assert not exists (
    select 1 from public.search_products(p_limit => 60) where slug = 'lampara-mesa-bambu'
  ), 'pending listing when browsing';
  assert not exists (select 1 from public.suggest_products('lamp')), 'pending listing in suggestions';
end
$$;

do $$
begin
  assert exists (select 1 from public.suggest_products('aud') where slug like 'audifonos-%'), 'prefix suggestion';
  assert exists (select 1 from public.suggest_products('Café') where slug like 'cafe-%'), 'accented prefix';
  assert (select count(*) from public.suggest_products('a')) = 0, 'one letter is too little to suggest on';
  assert (select count(*) from public.suggest_products('c', 50)) = 0, 'and the limit cannot be abused';
end
$$;

reset role;

-- Out-of-stock products drop in the ranking and leave the in-stock filter.
update public.stock_levels l set on_hand = l.reserved
from public.skus k join public.products p on p.id = k.product_id
where p.slug = 'cafe-molido-tarrazu-340g' and l.sku_id = k.id;

select pg_temp.login_anon();
do $$
declare
  first record;
begin
  select * into first from public.search_products('cafe tarrazu') limit 1;
  assert first.slug = 'cafe-grano-tarrazu-1kg', format('in-stock coffee should lead, got %s', first.slug);
  assert not exists (
    select 1 from public.search_products('cafe', p_in_stock_only => true) where slug = 'cafe-molido-tarrazu-340g'
  ), 'in-stock filter';
  assert exists (
    select 1 from public.search_products('cafe') where slug = 'cafe-molido-tarrazu-340g' and not in_stock
  ), 'still listed, marked out of stock';
end
$$;
reset role;

rollback;
