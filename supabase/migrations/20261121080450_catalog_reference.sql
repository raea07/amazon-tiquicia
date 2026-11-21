-- Reference data for the catalogue: the launch category tree, commission rates
-- and the search vocabulary. Production needs these, so they are a migration,
-- not seed data.
--
-- Commission rates mirror DEFAULT_FEE_SCHEDULE in packages/core/src/fees.ts and
-- are working assumptions until validated with pilot sellers.

insert into public.categories (slug, name_es, name_en, referral_bps, default_tax_rate_bps, sort) values
  ('hecho-en-cr', 'Hecho en Costa Rica', 'Made in Costa Rica', 1000, 1300, 1),
  ('electronica', 'Electrónica', 'Electronics', 800, 1300, 2),
  ('computacion', 'Computación', 'Computers', 800, 1300, 3),
  ('celulares', 'Celulares y accesorios', 'Phones & accessories', 800, 1300, 4),
  ('electrodomesticos', 'Electrodomésticos', 'Appliances', 1000, 1300, 5),
  ('hogar', 'Hogar y cocina', 'Home & kitchen', 1200, 1300, 6),
  ('ferreteria', 'Ferretería y herramientas', 'Hardware & tools', 1200, 1300, 7),
  ('deportes', 'Deportes y aire libre', 'Sports & outdoors', 1200, 1300, 8),
  ('moda', 'Moda', 'Fashion', 1500, 1300, 9),
  ('belleza', 'Belleza y cuidado personal', 'Beauty & personal care', 1300, 1300, 10),
  ('mascotas', 'Mascotas', 'Pets', 1200, 1300, 11),
  ('juguetes', 'Juguetes y juegos', 'Toys & games', 1200, 1300, 12),
  ('libros', 'Libros y oficina', 'Books & office', 1200, 1300, 13),
  ('abarrotes', 'Abarrotes y café', 'Groceries & coffee', 800, 1300, 14);

-- Second level, inheriting the parent's commission.
insert into public.categories (parent_id, slug, name_es, name_en, default_tax_rate_bps, sort)
select p.id, c.slug, c.name_es, c.name_en, c.tax, c.sort
from (values
  ('electronica', 'audio', 'Audio y audífonos', 'Audio & headphones', 1300, 1),
  ('electronica', 'televisores', 'Televisores', 'TVs', 1300, 2),
  ('computacion', 'laptops', 'Laptops', 'Laptops', 1300, 1),
  ('computacion', 'perifericos', 'Teclados y periféricos', 'Keyboards & peripherals', 1300, 2),
  ('celulares', 'cargadores', 'Cargadores y cables', 'Chargers & cables', 1300, 1),
  ('electrodomesticos', 'cocina-electrica', 'Cocina eléctrica', 'Kitchen appliances', 1300, 1),
  ('electrodomesticos', 'ventilacion', 'Abanicos y ventilación', 'Fans & cooling', 1300, 2),
  ('hogar', 'cocina', 'Cocina y mesa', 'Kitchen & dining', 1300, 1),
  ('hogar', 'descanso', 'Descanso y hamacas', 'Rest & hammocks', 1300, 2),
  ('ferreteria', 'herramientas-electricas', 'Herramientas eléctricas', 'Power tools', 1300, 1),
  ('ferreteria', 'iluminacion', 'Iluminación', 'Lighting', 1300, 2),
  ('deportes', 'aire-libre', 'Aire libre', 'Outdoors', 1300, 1),
  ('deportes', 'futbol', 'Fútbol', 'Football', 1300, 2),
  ('moda', 'ropa', 'Ropa', 'Clothing', 1300, 1),
  ('moda', 'bolsos', 'Bolsos y salveques', 'Bags & backpacks', 1300, 2),
  ('abarrotes', 'cafe', 'Café', 'Coffee', 100, 1),
  ('hecho-en-cr', 'artesania', 'Artesanía', 'Crafts', 1300, 1)
) as c (parent_slug, slug, name_es, name_en, tax, sort)
join public.categories p on p.slug = c.parent_slug;

-- Everyday Costa Rican words mapped to catalogue vocabulary. Terms are stored
-- folded (lowercase, no accents). Curated over time from zero-result searches.
insert into public.search_synonyms (term, expansions) values
  ('compu', '{computadora,laptop}'),
  ('laptop', '{computadora portatil}'),
  ('tele', '{televisor,pantalla}'),
  ('pantalla', '{televisor}'),
  ('refri', '{refrigeradora}'),
  ('cel', '{celular,telefono}'),
  ('abanico', '{ventilador}'),
  ('ventilador', '{abanico}'),
  ('tenis', '{zapatos deportivos,zapatillas}'),
  ('jacket', '{chaqueta,abrigo}'),
  ('sueta', '{sueter,abrigo}'),
  ('coffee', '{cafe}'),
  ('coffee maker', '{cafetera}'),
  ('chorreador', '{cafetera}'),
  ('olla', '{cacerola}'),
  ('audifonos', '{auriculares,headphones}'),
  ('parlante', '{bocina,altavoz}'),
  ('bocina', '{parlante}'),
  ('cargador', '{adaptador}'),
  ('salveque', '{mochila}'),
  ('mochila', '{salveque}'),
  ('bulto', '{mochila,salveque}'),
  ('foco', '{linterna}'),
  ('bombillo', '{foco,lampara led}'),
  ('bola', '{balon}'),
  ('balon', '{bola}'),
  ('zacate', '{cesped}');
