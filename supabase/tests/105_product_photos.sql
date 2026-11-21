-- Product photos: the rules on the two storage buckets, as every kind of
-- caller, for reading, adding, replacing, moving and deleting; every photo
-- function for the right and the wrong caller; the rule that a published
-- listing's photos change only through review; the limits; and the end of
-- direct writes to product_images.
--
-- Storage operations are written the way the storage service performs them:
-- as the caller's role, with their claims, on storage.objects, with the
-- operation's name in storage.operation and the request's headers in
-- request.headers. An upload is an insert, a download or a signed link needs
-- the row to be visible (select), a removal is a delete, and a move or an
-- overwrite is an update.

begin;
\ir _helpers.sql

create function pg_temp.logout() returns void
language sql as $$ select set_config('request.jwt.claims', '', true) $$;

-- A statement that must fail with the given application code.
create function pg_temp.refused(p_sql text, p_code text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'not refused: %', p_sql;
exception when others then
  if sqlerrm <> p_code then
    raise exception 'expected % but got "%" for: %', p_code, sqlerrm, p_sql;
  end if;
end;
$$;

-- A statement that the database's privileges or row-level security must stop.
create function pg_temp.denied(p_sql text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'not denied: %', p_sql;
exception when insufficient_privilege then
  null;
end;
$$;

-- How many rows a statement touched (0 when the rules hide them).
create function pg_temp.touched(p_sql text) returns integer
language plpgsql as $$
declare
  n integer;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- The storage operation running now, as the storage service sets it.
create function pg_temp.op(p_operation text) returns void
language sql as $$ select set_config('storage.operation', p_operation, true) $$;

-- The request's headers, as the storage service passes them.
create function pg_temp.headers(p_headers text) returns void
language sql as $$ select set_config('request.headers', p_headers, true) $$;

-- Uploads one file the way the storage service records it, as the caller.
create function pg_temp.put(
  p_bucket text, p_path text, p_type text default 'image/jpeg', p_size bigint default 120000
) returns void
language sql as $$
  select pg_temp.op('storage.object.upload');
  insert into storage.objects (bucket_id, name, owner_id, metadata, version)
  values (p_bucket, p_path, auth.uid()::text,
          jsonb_build_object('mimetype', p_type, 'size', p_size, 'cacheControl', 'max-age=604800',
                             'eTag', '"' || md5(random()::text) || '"'),
          gen_random_uuid()::text);
$$;

-- What a second upload under the same name does to the row: a new version.
create function pg_temp.reupload(p_path text) returns void
language sql as $$
  update storage.objects
  set version = gen_random_uuid()::text,
      metadata = metadata || jsonb_build_object('eTag', '"' || md5(random()::text) || '"')
  where bucket_id = 'product-photos-pending' and name = p_path;
$$;

-- Uploads every file of a reserved photo (the answer of seller_reserve_photo).
create function pg_temp.put_all(p_reserved jsonb, p_bucket text default 'product-photos-pending')
returns void
language sql as $$
  select pg_temp.put(p_bucket, f ->> 'path') from jsonb_array_elements(p_reserved -> 'files') f;
$$;

-- Reserves, uploads and finishes a photo as the current user; returns its id.
create function pg_temp.add_photo(p_product uuid, p_alt text) returns uuid
language plpgsql as $$
declare
  r jsonb := public.seller_reserve_photo(p_product);
begin
  perform pg_temp.put_all(r);
  perform public.seller_finish_photo((r ->> 'photo_id')::uuid, p_alt, 1600, 1200);
  return (r ->> 'photo_id')::uuid;
end;
$$;

-- Counts objects the current caller can see in a bucket under a prefix, during
-- a download unless another operation is named.
create function pg_temp.visible(
  p_bucket text, p_prefix text, p_operation text default 'storage.object.get_authenticated'
) returns integer
language sql as $$
  select pg_temp.op(p_operation);
  select count(*)::integer from storage.objects where bucket_id = p_bucket and name like p_prefix || '%';
$$;

-- Deletes as the storage service does when asked to remove files.
create function pg_temp.remove_like(p_bucket text, p_prefix text) returns integer
language plpgsql as $$
declare
  n integer;
begin
  perform pg_temp.op('storage.object.delete_many');
  delete from storage.objects where bucket_id = p_bucket and name like p_prefix || '%';
  get diagnostics n = row_count;
  return n;
end;
$$;

-- These helpers are called while impersonating.
do $$
begin
  execute format('grant usage on schema %I to authenticated, anon',
                 (select nspname from pg_namespace where oid = pg_my_temp_schema()));
end
$$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- Two more members of staff: one who reviews the catalogue, one in finance.
insert into public.staff_members (user_id, role)
select id, 'catalog' from auth.users where email = 'comprador2@yuntera.example';
insert into public.staff_members (user_id, role)
select id, 'finance' from auth.users where email = 'comprador3@yuntera.example';

select pg_temp.remember('tecnocasa', (select id::text from public.sellers where slug = 'tecnocasa'));
select pg_temp.remember('laptop', (select id::text from public.products where slug = 'laptop-14-nimbo-libro'));

-- ═══ The buckets exist with their limits ════════════════════════════════════

do $$
begin
  assert (select not public and file_size_limit = 2097152
                 and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
          from storage.buckets where id = 'product-photos-pending'), 'private bucket for waiting photos';
  assert (select public and file_size_limit = 2097152
                 and not ('image/svg+xml' = any (allowed_mime_types))
          from storage.buckets where id = 'product-photos'), 'public bucket for approved photos';
  assert private.photo_path('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
                            '00000000-0000-4000-8000-000000000003', 800, 'jpeg')
         = '00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002/00000000-0000-4000-8000-000000000003/800.jpg',
         'path layout';
end
$$;

-- ═══ A draft listing gets two photos ════════════════════════════════════════

select pg_temp.login('vendedor@yuntera.example');
do $$
declare
  created jsonb;
  r jsonb;
  prefix text;
begin
  created := public.seller_create_listing(
    current_setting('t.tecnocasa')::uuid, 'Cafetera de goteo Nimbo 12 tazas', 'hogar',
    'Cafetera con jarra de vidrio.', array['12 tazas'], 2500000, 'seller', 1::smallint,
    1800, 30, 20, 35, false);
  perform pg_temp.remember('draft', created ->> 'product_id');

  r := public.seller_reserve_photo((created ->> 'product_id')::uuid);
  assert r ->> 'bucket' = 'product-photos-pending' and r ->> 'content_type' = 'image/jpeg', 'where to upload';
  assert jsonb_array_length(r -> 'files') = 3, 'three sizes';
  prefix := current_setting('t.tecnocasa') || '/' || (created ->> 'product_id') || '/' || (r ->> 'photo_id') || '/';
  assert (select array_agg(f ->> 'path' order by (f ->> 'size')::int) from jsonb_array_elements(r -> 'files') f)
         = array[prefix || '400.jpg', prefix || '800.jpg', prefix || '1600.jpg'], 'paths of the three sizes';
  perform pg_temp.remember('photo1', r ->> 'photo_id');
  perform pg_temp.remember('prefix1', prefix);
end
$$;
reset role; select pg_temp.logout();

-- Adding files: only the owning shop, only for its open reservation, only its paths.
select pg_temp.login_anon();
select pg_temp.denied(format($q$select pg_temp.put('product-photos-pending', %L)$q$, current_setting('t.prefix1') || '400.jpg'));
reset role;
select pg_temp.login('comprador@yuntera.example');
select pg_temp.denied(format($q$select pg_temp.put('product-photos-pending', %L)$q$, current_setting('t.prefix1') || '400.jpg'));
reset role; select pg_temp.logout();
select pg_temp.login('cafetal@yuntera.example');
select pg_temp.denied(format($q$select pg_temp.put('product-photos-pending', %L)$q$, current_setting('t.prefix1') || '400.jpg'));
reset role; select pg_temp.logout();
select pg_temp.login('comprador2@yuntera.example'); -- catalogue staff
select pg_temp.denied(format($q$select pg_temp.put('product-photos-pending', %L)$q$, current_setting('t.prefix1') || '400.jpg'));
reset role; select pg_temp.logout();
select pg_temp.login('comprador3@yuntera.example'); -- finance staff
select pg_temp.denied(format($q$select pg_temp.put('product-photos-pending', %L)$q$, current_setting('t.prefix1') || '400.jpg'));
reset role; select pg_temp.logout();

select pg_temp.login('vendedor@yuntera.example');
-- not one of the three sizes, not its type, a made-up photo, the public bucket
select pg_temp.denied(format($q$select pg_temp.put('product-photos-pending', %L)$q$, current_setting('t.prefix1') || '500.jpg'));
select pg_temp.denied(format($q$select pg_temp.put('product-photos-pending', %L)$q$, current_setting('t.prefix1') || '400.png'));
select pg_temp.denied(format($q$select pg_temp.put('product-photos-pending', %L)$q$, current_setting('t.prefix1') || '400.svg'));
select pg_temp.denied(format($q$select pg_temp.put('product-photos-pending', %L)$q$,
  current_setting('t.tecnocasa') || '/' || current_setting('t.draft') || '/' || gen_random_uuid() || '/400.jpg'));
select pg_temp.denied(format($q$select pg_temp.put('product-photos-pending', %L)$q$, 'otra-carpeta/400.jpg'));
select pg_temp.denied(format($q$select pg_temp.put('product-photos', %L)$q$, current_setting('t.prefix1') || '400.jpg'));
reset role; select pg_temp.logout();
-- Storage does not run the Data API's check_request: its rules refuse an ended
-- session, and a password-only session of an account with a second factor.
select set_config('request.jwt.claims', json_build_object(
  'sub', (select id from auth.users where email = 'vendedor@yuntera.example'),
  'role', 'authenticated', 'aal', 'aal1', 'session_id', gen_random_uuid())::text, true);
set local role authenticated;
select pg_temp.denied(format($q$select pg_temp.put('product-photos-pending', %L)$q$, current_setting('t.prefix1') || '400.jpg'));
reset role; select pg_temp.logout();
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
select gen_random_uuid(), id, 'Prueba', 'totp', 'verified', now(), now(), 'JBSWY3DPEHPK3PXP'
from auth.users where email = 'vendedor@yuntera.example';
select pg_temp.login('vendedor@yuntera.example');
select pg_temp.denied(format($q$select pg_temp.put('product-photos-pending', %L)$q$, current_setting('t.prefix1') || '400.jpg'));
reset role; select pg_temp.logout();
delete from auth.mfa_factors f using auth.users u
where u.id = f.user_id and u.email = 'vendedor@yuntera.example';
select pg_temp.login('vendedor@yuntera.example');
-- its own files
select pg_temp.put('product-photos-pending', current_setting('t.prefix1') || '400.jpg');
select pg_temp.put('product-photos-pending', current_setting('t.prefix1') || '800.jpg');
-- the same name twice is a duplicate, never an overwrite
do $$
begin
  perform pg_temp.put('product-photos-pending', current_setting('t.prefix1') || '400.jpg');
  raise exception 'uploaded the same file twice';
exception when unique_violation then null;
end
$$;
-- finishing before every size is there
select pg_temp.refused(format('select public.seller_finish_photo(%L, %L, 1600, 1200)',
  current_setting('t.photo1'), 'Cafetera vista de frente'), 'photo_upload_incomplete');
select pg_temp.put('product-photos-pending', current_setting('t.prefix1') || '1600.jpg');
-- text is required, and the pixel size must be a real rendition
select pg_temp.refused(format('select public.seller_finish_photo(%L, %L, 1600, 1200)',
  current_setting('t.photo1'), '  a '), 'photo_alt_required');
select pg_temp.refused(format('select public.seller_finish_photo(%L, %L, 400, 300)',
  current_setting('t.photo1'), 'Cafetera vista de frente'), 'invalid_photo');
select pg_temp.refused(format('select public.seller_finish_photo(%L, %L, 3000, 2000)',
  current_setting('t.photo1'), 'Cafetera vista de frente'), 'invalid_photo');
reset role; select pg_temp.logout();

select pg_temp.login('cafetal@yuntera.example');
select pg_temp.refused(format('select public.seller_finish_photo(%L, %L, 1600, 1200)',
  current_setting('t.photo1'), 'Cafetera vista de frente'), 'photo_not_found');
select pg_temp.refused(format('select public.seller_photos(%L)', current_setting('t.draft')), 'listing_not_found');
select pg_temp.refused(format('select public.seller_reserve_photo(%L)', current_setting('t.draft')), 'listing_not_found');
reset role; select pg_temp.logout();

select pg_temp.login('vendedor@yuntera.example');
do $$
declare
  ph jsonb;
  r jsonb;
begin
  ph := public.seller_finish_photo(current_setting('t.photo1')::uuid, '  Cafetera   vista de frente ', 1600, 1200);
  assert ph ->> 'state' = 'pending' and ph ->> 'alt' = 'Cafetera vista de frente', format('finished: %s', ph);
  -- finishing twice is refused
  begin
    perform public.seller_finish_photo(current_setting('t.photo1')::uuid, 'Otra vez', 1600, 1200);
    raise exception 'finished twice';
  exception when others then
    if sqlerrm <> 'photo_not_found' then raise; end if;
  end;

  -- A file whose declared type is not the photo's is not accepted.
  r := public.seller_reserve_photo(current_setting('t.draft')::uuid);
  perform pg_temp.put('product-photos-pending', r -> 'files' -> 0 ->> 'path', 'image/png');
  perform pg_temp.put('product-photos-pending', r -> 'files' -> 1 ->> 'path');
  perform pg_temp.put('product-photos-pending', r -> 'files' -> 2 ->> 'path');
  begin
    perform public.seller_finish_photo((r ->> 'photo_id')::uuid, 'Una foto con tipo cambiado', 1600, 1200);
    raise exception 'accepted a file of the wrong type';
  exception when others then
    if sqlerrm <> 'invalid_photo' then raise; end if;
  end;
  -- The seller takes it away; its files are no longer needed and may be deleted.
  assert public.seller_remove_photo((r ->> 'photo_id')::uuid) ->> 'outcome' = 'removed', 'removed at once';
  assert jsonb_array_length(public.photo_files_to_delete(current_setting('t.draft')::uuid)) = 3,
    'the removed photo''s three files are listed for deletion';
  -- Nobody but staff can read them any more: not to download, not to sign a link.
  assert pg_temp.visible('product-photos-pending', split_part(r -> 'files' -> 0 ->> 'path', '/400', 1)) = 0,
    'a removed photo''s files cannot be downloaded by the seller';
  assert pg_temp.visible('product-photos-pending', split_part(r -> 'files' -> 0 ->> 'path', '/400', 1),
                         'storage.object.sign') = 0, 'nor signed';
  -- Outside the storage service (no operation) the seller reads nothing.
  assert pg_temp.visible('product-photos-pending', split_part(r -> 'files' -> 0 ->> 'path', '/400', 1), '') = 0,
    'no operation, no reading';
  assert pg_temp.remove_like('product-photos-pending', split_part(r -> 'files' -> 0 ->> 'path', '/400', 1)) = 3,
    'the seller deletes them';

  -- The second photo.
  perform pg_temp.remember('photo2', pg_temp.add_photo(current_setting('t.draft')::uuid, 'Cafetera con la jarra servida')::text);
  assert jsonb_array_length(public.seller_photos(current_setting('t.draft')::uuid) -> 'photos') = 2, 'two photos';
end
$$;

-- Nothing in the private bucket can be overwritten or moved, even by its owner,
-- and a waiting photo's files cannot be deleted out from under the review.
do $$
begin
  assert pg_temp.touched(format(
    $q$update storage.objects set name = replace(name, '400.jpg', '401.jpg') where name = %L$q$,
    current_setting('t.prefix1') || '400.jpg')) = 0, 'owner cannot move';
  assert pg_temp.touched(format(
    $q$update storage.objects set metadata = '{}' where name = %L$q$,
    current_setting('t.prefix1') || '400.jpg')) = 0, 'owner cannot replace';
  assert pg_temp.touched(format(
    $q$delete from storage.objects where name = %L$q$, current_setting('t.prefix1') || '400.jpg')) = 0,
    'owner cannot delete a waiting photo''s file';
  assert pg_temp.remove_like('product-photos-pending', current_setting('t.prefix1')) = 0,
    'not even as a removal through storage';
  assert pg_temp.visible('product-photos-pending', current_setting('t.prefix1')) = 3, 'owner downloads its files';
  assert pg_temp.visible('product-photos-pending', current_setting('t.prefix1'), 'object.get_authenticated_info') = 3,
    'and reads their details';
  -- but never makes a link anyone could open, and never lists or copies them
  assert pg_temp.visible('product-photos-pending', current_setting('t.prefix1'), 'storage.object.sign') = 0,
    'owner cannot sign a link to a waiting photo';
  assert pg_temp.visible('product-photos-pending', current_setting('t.prefix1'), 'storage.object.sign_many') = 0,
    'nor several';
  assert pg_temp.visible('product-photos-pending', current_setting('t.prefix1'), 'storage.object.list') = 0, 'nor list';
  assert pg_temp.visible('product-photos-pending', current_setting('t.prefix1'), 'storage.object.copy') = 0, 'nor copy';
  assert pg_temp.visible('product-photos-pending', current_setting('t.prefix1'), 'storage.object.move') = 0, 'nor move';
end
$$;
-- An upload, or a signed upload address, that asks to replace the file if it
-- exists is refused outright: the upsert probe would otherwise pass while the
-- path is free and the address could replace the file later.
do $$
declare
  r jsonb := public.seller_reserve_photo(current_setting('t.draft')::uuid);
begin
  perform pg_temp.headers('{"x-upsert": "true", "content-type": "image/jpeg"}');
  begin
    perform pg_temp.put('product-photos-pending', r -> 'files' -> 0 ->> 'path');
    raise exception 'accepted an upsert';
  exception when insufficient_privilege then null;
  end;
  begin
    perform pg_temp.op('storage.object.sign_upload_url');
    insert into storage.objects (bucket_id, name, owner_id, metadata, version)
    values ('product-photos-pending', r -> 'files' -> 0 ->> 'path', auth.uid()::text, '{}', gen_random_uuid()::text)
    on conflict (bucket_id, name) do update set version = excluded.version;
    raise exception 'the upsert probe of a signed upload address passed';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.headers('not json');
  begin
    perform pg_temp.put('product-photos-pending', r -> 'files' -> 0 ->> 'path');
    raise exception 'accepted an upload with unreadable headers';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.headers('{"x-upsert": "false"}');
  perform pg_temp.put('product-photos-pending', r -> 'files' -> 0 ->> 'path');
  perform pg_temp.headers('');
  -- The seller centre gives a reservation back when its upload fails.
  perform public.seller_remove_photo((r ->> 'photo_id')::uuid);
  assert pg_temp.remove_like('product-photos-pending',
                             split_part(r -> 'files' -> 0 ->> 'path', '/400', 1)) = 1, 'its file is deleted';
end
$$;
reset role; select pg_temp.logout();

-- Reading the waiting files: the shop and catalogue staff, nobody else.
select pg_temp.login_anon();
do $$ begin assert pg_temp.visible('product-photos-pending', current_setting('t.prefix1')) = 0, 'visitor reads nothing'; end $$;
reset role;
select pg_temp.login('comprador@yuntera.example');
do $$ begin assert pg_temp.visible('product-photos-pending', current_setting('t.prefix1')) = 0, 'shopper reads nothing'; end $$;
reset role; select pg_temp.logout();
select pg_temp.login('cafetal@yuntera.example');
do $$
begin
  assert pg_temp.visible('product-photos-pending', current_setting('t.prefix1')) = 0, 'other seller reads nothing';
  assert pg_temp.visible('product-photos-pending', current_setting('t.prefix1'), 'storage.object.sign') = 0,
    'other seller signs nothing';
  assert pg_temp.remove_like('product-photos-pending', current_setting('t.prefix1')) = 0,
    'other seller removes nothing';
  assert pg_temp.touched(format($q$delete from storage.objects where name like %L$q$, current_setting('t.prefix1') || '%')) = 0,
    'other seller deletes nothing';
  assert pg_temp.touched(format($q$update storage.objects set name = 'x' where name like %L$q$, current_setting('t.prefix1') || '%')) = 0,
    'other seller moves nothing';
end
$$;
reset role; select pg_temp.logout();
select pg_temp.login('comprador3@yuntera.example');
do $$ begin assert pg_temp.visible('product-photos-pending', current_setting('t.prefix1')) = 0, 'finance staff reads nothing'; end $$;
reset role; select pg_temp.logout();
select pg_temp.login('comprador2@yuntera.example');
do $$
begin
  assert pg_temp.visible('product-photos-pending', current_setting('t.prefix1')) = 3, 'catalogue staff read waiting files';
  assert pg_temp.visible('product-photos-pending', current_setting('t.prefix1'), 'storage.object.sign') = 3,
    'and may sign links to them, for the review';
  assert pg_temp.touched(format($q$update storage.objects set name = 'x' where name like %L$q$, current_setting('t.prefix1') || '%')) = 0,
    'staff move nothing';
  assert pg_temp.touched(format($q$delete from storage.objects where name like %L$q$, current_setting('t.prefix1') || '%')) = 0,
    'staff cannot delete a waiting photo''s files';
end
$$;
-- Before approval not even catalogue staff can put a photo in the public bucket.
select pg_temp.denied(format($q$select pg_temp.put('product-photos', %L)$q$, current_setting('t.prefix1') || '400.jpg'));
reset role; select pg_temp.logout();

-- ═══ Limits ═════════════════════════════════════════════════════════════════

select pg_temp.login('vendedor@yuntera.example');
do $$
declare
  n integer := 0;
  r jsonb;
begin
  -- Two photos are there; six more reservations fit, the ninth photo does not.
  loop
    begin
      r := public.seller_reserve_photo(current_setting('t.draft')::uuid);
      n := n + 1;
      perform pg_temp.remember('last_reserved', r ->> 'photo_id');
      perform pg_temp.remember('last_reserved_path', r -> 'files' -> 0 ->> 'path');
    exception when others then
      if sqlerrm <> 'photo_limit_reached' then raise; end if;
      exit;
    end;
    exit when n > 20;
  end loop;
  assert n = 6, format('reservations before the limit: %s', n);
  -- An unknown format is refused.
  begin
    perform public.seller_reserve_photo(current_setting('t.draft')::uuid, 'svg');
    raise exception 'reserved an svg';
  exception when others then
    if sqlerrm not in ('invalid_photo', 'photo_limit_reached') then raise; end if;
  end;
end
$$;
reset role; select pg_temp.logout();

-- An abandoned reservation stops counting after its window, and its window
-- for uploads is closed.
update public.product_photos set created_at = now() - interval '3 hours'
where product_id = current_setting('t.draft')::uuid and state = 'uploading';
select pg_temp.login('vendedor@yuntera.example');
select pg_temp.denied(format($q$select pg_temp.put('product-photos-pending', %L)$q$, current_setting('t.last_reserved_path')));
do $$
declare
  r jsonb;
begin
  r := public.seller_reserve_photo(current_setting('t.draft')::uuid, 'webp');
  assert r -> 'files' -> 0 ->> 'path' like '%/400.webp' and r ->> 'content_type' = 'image/webp', 'webp reservation';
  assert (select state from public.product_photos where id = current_setting('t.last_reserved')::uuid) = 'removed',
    'abandoned reservations are marked removed';
  perform public.seller_remove_photo((r ->> 'photo_id')::uuid);
end
$$;
reset role; select pg_temp.logout();

-- A shop cannot pile up photos nobody reviews: at most 40 waiting across all
-- its listings, files of removed photos counting until they are deleted, and
-- at most 100 new photos a day.
insert into public.product_photos (product_id, seller_id, state, alt, width, height, created_at)
select current_setting('t.laptop')::uuid, current_setting('t.tecnocasa')::uuid, 'pending',
       'Relleno para contar el límite', 1600, 1200, now() - interval '2 days'
from generate_series(1, 39);
select pg_temp.login('vendedor@yuntera.example');
select pg_temp.refused(format('select public.seller_reserve_photo(%L)', current_setting('t.draft')),
  'photo_shop_limit_reached');
reset role; select pg_temp.logout();
-- Removed, but their files are still stored: they still count.
update public.product_photos set state = 'removed'
where alt = 'Relleno para contar el límite';
insert into storage.objects (bucket_id, name, metadata, version)
select 'product-photos-pending', private.photo_path(seller_id, product_id, id, 400, 'jpeg'),
       '{"mimetype": "image/jpeg", "size": 1000}', gen_random_uuid()::text
from public.product_photos where alt = 'Relleno para contar el límite';
select pg_temp.login('vendedor@yuntera.example');
select pg_temp.refused(format('select public.seller_reserve_photo(%L)', current_setting('t.draft')),
  'photo_shop_limit_reached');
reset role; select pg_temp.logout();
-- Once their files are gone, they stop counting; but a day's new photos are capped.
delete from storage.objects
where name in (select private.photo_path(seller_id, product_id, id, 400, 'jpeg')
               from public.product_photos where alt = 'Relleno para contar el límite');
update public.product_photos set created_at = now() where alt = 'Relleno para contar el límite';
insert into public.product_photos (product_id, seller_id, state, alt, created_at)
select current_setting('t.laptop')::uuid, current_setting('t.tecnocasa')::uuid, 'removed',
       'Relleno para contar el límite', now()
from generate_series(1, 100 - (select count(*)::int from public.product_photos
                               where seller_id = current_setting('t.tecnocasa')::uuid
                                 and created_at > now() - interval '1 day'));
select pg_temp.login('vendedor@yuntera.example');
select pg_temp.refused(format('select public.seller_reserve_photo(%L)', current_setting('t.draft')),
  'photo_daily_limit_reached');
reset role; select pg_temp.logout();
delete from public.product_photos where alt = 'Relleno para contar el límite';

-- ═══ Review of a new listing, and promotion ═════════════════════════════════

select pg_temp.login('vendedor@yuntera.example');
-- Order and text: [photo2, photo1].
select public.seller_save_photos(current_setting('t.draft')::uuid, jsonb_build_array(
  jsonb_build_object('photo_id', current_setting('t.photo2'), 'alt', 'Cafetera con la jarra servida'),
  jsonb_build_object('photo_id', current_setting('t.photo1'), 'alt', 'Cafetera vista de frente')));
select pg_temp.refused(format('select public.seller_save_photos(%L, %L)', current_setting('t.draft'),
  jsonb_build_array(jsonb_build_object('photo_id', current_setting('t.photo1'), 'alt', 'Solo una'))), 'photos_changed');
select pg_temp.refused(format('select public.seller_save_photos(%L, %L)', current_setting('t.draft'),
  jsonb_build_array(jsonb_build_object('photo_id', current_setting('t.photo2'), 'alt', 'ab'),
                    jsonb_build_object('photo_id', current_setting('t.photo1'), 'alt', 'Cafetera vista de frente'))),
  'photo_alt_required');
-- send the listing to review
select public.seller_update_listing(current_setting('t.draft')::uuid, 'Cafetera de goteo Nimbo 12 tazas', 'hogar',
  'Cafetera con jarra de vidrio.', array['12 tazas'], 1800, 30, 20, 35);
-- Changing the photos while the listing waits sends it back to draft, so staff
-- cannot publish a photo added after they looked: adding one,
do $$
declare
  r jsonb := public.seller_reserve_photo(current_setting('t.draft')::uuid);
  ph jsonb;
begin
  assert (select status from public.products where id = current_setting('t.draft')::uuid) = 'pending_review',
    'reserving alone changes nothing staff see';
  perform pg_temp.put_all(r);
  ph := public.seller_finish_photo((r ->> 'photo_id')::uuid, 'Foto agregada durante la revisión', 1600, 1200);
  assert ph ->> 'listing_status' = 'draft', format('back to draft: %s', ph);
  assert (select status from public.products where id = current_setting('t.draft')::uuid) = 'draft', 'draft';
  perform pg_temp.remember('late_photo', r ->> 'photo_id');
end
$$;
reset role; select pg_temp.logout();
select pg_temp.login('comprador2@yuntera.example');
select pg_temp.refused(format('select public.ops_review_product(%L, true)', current_setting('t.draft')),
  'product_not_reviewable');
reset role; select pg_temp.logout();
select pg_temp.login('vendedor@yuntera.example');
-- removing one,
select public.seller_remove_photo(current_setting('t.late_photo')::uuid);
select public.seller_update_listing(current_setting('t.draft')::uuid, 'Cafetera de goteo Nimbo 12 tazas', 'hogar',
  'Cafetera con jarra de vidrio.', array['12 tazas'], 1800, 30, 20, 35);
do $$
begin
  assert public.seller_save_photos(current_setting('t.draft')::uuid, jsonb_build_array(
    jsonb_build_object('photo_id', current_setting('t.photo2'), 'alt', 'Cafetera con la jarra servida'),
    jsonb_build_object('photo_id', current_setting('t.photo1'), 'alt', 'Cafetera vista de frente')))
    ->> 'listing_status' = 'pending_review', 'saving the same order and text changes nothing';
  -- or changing a text.
  assert public.seller_save_photos(current_setting('t.draft')::uuid, jsonb_build_array(
    jsonb_build_object('photo_id', current_setting('t.photo2'), 'alt', 'Cafetera con la jarra servida en taza'),
    jsonb_build_object('photo_id', current_setting('t.photo1'), 'alt', 'Cafetera vista de frente')))
    ->> 'listing_status' = 'draft', 'a new text sends it back to draft';
end
$$;
select public.seller_save_photos(current_setting('t.draft')::uuid, jsonb_build_array(
  jsonb_build_object('photo_id', current_setting('t.photo2'), 'alt', 'Cafetera con la jarra servida'),
  jsonb_build_object('photo_id', current_setting('t.photo1'), 'alt', 'Cafetera vista de frente')));
select public.seller_update_listing(current_setting('t.draft')::uuid, 'Cafetera de goteo Nimbo 12 tazas', 'hogar',
  'Cafetera con jarra de vidrio.', array['12 tazas'], 1800, 30, 20, 35);
reset role; select pg_temp.logout();

select pg_temp.login('comprador3@yuntera.example');
select pg_temp.refused('select public.ops_photos_for_review()', 'forbidden');
select pg_temp.refused(format('select public.ops_reject_photo(%L, %L)', current_setting('t.photo1'), 'No se ve bien'), 'forbidden');
reset role; select pg_temp.logout();
select pg_temp.login('vendedor@yuntera.example');
select pg_temp.refused('select public.ops_photos_for_review()', 'forbidden');
select pg_temp.refused(format('select public.ops_confirm_photos_published(%L)', current_setting('t.draft')), 'forbidden');
reset role; select pg_temp.logout();

select pg_temp.login('comprador2@yuntera.example');
do $$
declare
  item jsonb;
begin
  select i into item from jsonb_array_elements(public.ops_photos_for_review()) i
  where i ->> 'product_id' = current_setting('t.draft');
  assert item ->> 'kind' = 'new', format('queued as a new listing: %s', item);
  assert jsonb_array_length(item -> 'after') = 2 and jsonb_array_length(item -> 'before') = 0, 'two waiting, none live';
  assert item -> 'after' -> 0 ->> 'photo_id' = current_setting('t.photo2'), 'in the seller''s order';
  -- staff publish the listing, which approves its photos
  perform public.ops_review_product(current_setting('t.draft')::uuid, true);
  assert (select count(*) from public.product_photos
          where product_id = current_setting('t.draft')::uuid and state = 'approved' and published_at is null) = 2,
    'approved, not yet published';
  -- the shop shows nothing until the files are confirmed
  assert not exists (select 1 from public.product_images where product_id = current_setting('t.draft')::uuid),
    'no image before the files are public';
  assert jsonb_array_length(public.ops_photo_files_to_publish(current_setting('t.draft')::uuid)) = 2, 'two to publish';
  assert (public.ops_confirm_photos_published(current_setting('t.draft')::uuid) ->> 'published')::int = 0,
    'nothing published while the files are missing';
end
$$;
-- The copy, as staff: read from the private bucket, add to the public one.
do $$
declare
  f jsonb;
  p text;
begin
  for f in select jsonb_array_elements(public.ops_photo_files_to_publish(current_setting('t.draft')::uuid)) loop
    for p in select jsonb_array_elements_text(f -> 'paths') loop
      assert exists (select 1 from storage.objects where bucket_id = 'product-photos-pending' and name = p),
        'staff read the source';
      perform pg_temp.put('product-photos', p);
    end loop;
  end loop;
  assert (public.ops_confirm_photos_published(current_setting('t.draft')::uuid) ->> 'published')::int = 2, 'published';
  -- a path that is not an approved photo's is still refused
end
$$;
select pg_temp.denied(format($q$select pg_temp.put('product-photos', %L)$q$,
  current_setting('t.tecnocasa') || '/' || current_setting('t.draft') || '/' || gen_random_uuid() || '/400.jpg'));
-- staff may now delete the waiting copies of published photos
do $$
begin
  assert jsonb_array_length(public.photo_files_to_delete()) >= 6, 'waiting copies are listed for deletion';
  assert pg_temp.touched(format($q$delete from storage.objects where bucket_id = 'product-photos-pending' and name like %L$q$,
    current_setting('t.prefix1') || '%')) = 3, 'staff delete the waiting copies';
  assert pg_temp.touched(format($q$delete from storage.objects where bucket_id = 'product-photos' and name like %L$q$,
    current_setting('t.prefix1') || '%')) = 0, 'but not the public copies of a live photo';
end
$$;
reset role; select pg_temp.logout();

-- Only staff may add to the public bucket, even for an approved photo.
select pg_temp.login('vendedor@yuntera.example');
select pg_temp.denied(format($q$select pg_temp.put('product-photos', %L)$q$,
  replace(current_setting('t.prefix1'), current_setting('t.photo1'), current_setting('t.photo2')) || '400.jpg'));
reset role; select pg_temp.logout();
select pg_temp.login('comprador3@yuntera.example');
select pg_temp.denied(format($q$select pg_temp.put('product-photos', %L)$q$,
  replace(current_setting('t.prefix1'), current_setting('t.photo1'), current_setting('t.photo2')) || '400.jpg'));
reset role; select pg_temp.logout();

-- The shop shows both photos, in the seller's order, with their text.
select pg_temp.login_anon();
do $$
declare
  images jsonb := public.get_product((select slug from public.products where id = current_setting('t.draft')::uuid)) -> 'images';
begin
  assert jsonb_array_length(images) = 2, format('two images: %s', images);
  assert images -> 0 ->> 'alt' = 'Cafetera con la jarra servida', 'first photo first, with its text';
  assert images -> 0 ->> 'path' = current_setting('t.tecnocasa') || '/' || current_setting('t.draft') || '/'
                                  || current_setting('t.photo2') || '/{w}.jpg', 'its template';
  -- rows of the public bucket are not listable by visitors (the files are served by address)
  assert pg_temp.visible('product-photos', current_setting('t.tecnocasa')) = 0, 'visitor lists nothing';
  -- visitors cannot call the photo functions at all
  begin
    perform public.seller_photos(current_setting('t.draft')::uuid);
    raise exception 'a visitor read a listing''s photos';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;

-- ═══ A published listing changes only through review ═══════════════════════

-- The laptop is published, with a placeholder drawing. Give it one live photo
-- first (through the same steps), then change it.
select pg_temp.login('vendedor@yuntera.example');
do $$
declare
  r jsonb;
  before jsonb;
begin
  before := public.get_product('laptop-14-nimbo-libro') -> 'images';
  perform pg_temp.remember('laptop_images', before::text);
  perform pg_temp.remember('photo3', pg_temp.add_photo(current_setting('t.laptop')::uuid, 'Laptop abierta vista de frente')::text);
  assert public.seller_photos(current_setting('t.laptop')::uuid) ->> 'change_waiting' = 'true', 'a change waits';
  assert public.get_product('laptop-14-nimbo-libro') -> 'images' = before, 'the shop is unchanged';
end
$$;
reset role; select pg_temp.logout();

select pg_temp.login('comprador2@yuntera.example');
do $$
declare
  item jsonb;
begin
  select i into item from jsonb_array_elements(public.ops_photos_for_review()) i
  where i ->> 'product_id' = current_setting('t.laptop');
  assert item ->> 'kind' = 'change', format('queued as a change: %s', item);
  begin
    perform public.ops_review_photo_change(current_setting('t.laptop')::uuid, 'not-the-revision', true);
    raise exception 'approved photos nobody looked at';
  exception when others then
    if sqlerrm <> 'photos_changed' then raise; end if;
  end;
  begin
    perform public.ops_review_photo_change(current_setting('t.laptop')::uuid, item ->> 'revision', false, 'no');
    raise exception 'rejected without a reason';
  exception when others then
    if sqlerrm <> 'reason_required' then raise; end if;
  end;
  perform public.ops_review_photo_change(current_setting('t.laptop')::uuid, item ->> 'revision', true);
  for item in select jsonb_array_elements(public.ops_photo_files_to_publish(current_setting('t.laptop')::uuid)) loop
    perform pg_temp.put('product-photos', p) from jsonb_array_elements_text(item -> 'paths') p;
  end loop;
  perform public.ops_confirm_photos_published(current_setting('t.laptop')::uuid);
end
$$;
reset role; select pg_temp.logout();

select pg_temp.login('vendedor@yuntera.example');
do $$
declare
  shop jsonb;
  saved jsonb;
begin
  shop := public.get_product('laptop-14-nimbo-libro') -> 'images';
  assert shop -> 0 ->> 'alt' = 'Laptop abierta vista de frente', format('the photo leads: %s', shop);
  perform pg_temp.remember('laptop_shop', shop::text);

  -- Now add a photo, remove the live one and change nothing else.
  perform pg_temp.remember('photo4', pg_temp.add_photo(current_setting('t.laptop')::uuid, 'Teclado de la laptop de cerca')::text);
  assert public.seller_remove_photo(current_setting('t.photo3')::uuid) ->> 'outcome' = 'in_review', 'removal waits';
  assert (select state = 'approved' and live_position is not null from public.product_photos
          where id = current_setting('t.photo3')::uuid), 'still live';
  assert public.get_product('laptop-14-nimbo-libro') -> 'images' = shop, 'the shop still shows the approved set';
  -- reordering or retexting the working set of a published listing also waits
  saved := public.seller_save_photos(current_setting('t.laptop')::uuid, jsonb_build_array(
    jsonb_build_object('photo_id', current_setting('t.photo4'), 'alt', 'Teclado retroiluminado de cerca')));
  assert saved ->> 'outcome' = 'in_review', format('saved: %s', saved);
  assert public.get_product('laptop-14-nimbo-libro') -> 'images' = shop, 'still the approved set';
end
$$;
-- The table API is closed: no direct writes to photos or images.
select pg_temp.denied(format($q$insert into public.product_images (product_id, path, alt) values (%L, '/x.svg', 'x')$q$, current_setting('t.laptop')));
select pg_temp.denied(format($q$update public.product_images set alt = 'x' where product_id = %L$q$, current_setting('t.laptop')));
select pg_temp.denied(format($q$delete from public.product_images where product_id = %L$q$, current_setting('t.laptop')));
select pg_temp.denied(format($q$update public.product_photos set state = 'approved' where id = %L$q$, current_setting('t.photo4')));
select pg_temp.denied(format($q$insert into public.product_photos (product_id, seller_id, state) values (%L, %L, 'approved')$q$,
  current_setting('t.laptop'), current_setting('t.tecnocasa')));
reset role; select pg_temp.logout();

-- Another seller sees none of it and can do none of it.
select pg_temp.login('cafetal@yuntera.example');
do $$
begin
  assert not exists (select 1 from public.product_photos where product_id = current_setting('t.laptop')::uuid),
    'another shop reads no photo rows';
  assert pg_temp.touched(format($q$delete from storage.objects where name like %L$q$, current_setting('t.tecnocasa') || '/%')) = 0,
    'another shop deletes no file';
end
$$;
select pg_temp.refused(format('select public.seller_remove_photo(%L)', current_setting('t.photo4')), 'photo_not_found');
select pg_temp.refused(format('select public.seller_withdraw_photo_changes(%L)', current_setting('t.laptop')), 'listing_not_found');
select pg_temp.refused(format('select public.photo_files_to_delete(%L)', current_setting('t.laptop')), 'listing_not_found');
select pg_temp.refused('select public.photo_files_to_delete()', 'forbidden');
reset role; select pg_temp.logout();

-- Staff reject one added photo with a reason; the rest still waits.
select pg_temp.login('comprador2@yuntera.example');
select pg_temp.refused(format('select public.ops_reject_photo(%L, %L)', current_setting('t.photo4'), 'no'), 'reason_required');
select public.ops_reject_photo(current_setting('t.photo4')::uuid, 'Se ve el logotipo de otra marca en la foto.');
select pg_temp.refused(format('select public.ops_reject_photo(%L, %L)', current_setting('t.photo4'), 'Otra vez el mismo motivo'), 'photo_not_found');
reset role; select pg_temp.logout();

select pg_temp.login('vendedor@yuntera.example');
do $$
declare
  mine jsonb := public.seller_photos(current_setting('t.laptop')::uuid);
begin
  assert mine -> 'rejected' -> 0 ->> 'rejection_reason' = 'Se ve el logotipo de otra marca en la foto.',
    format('the seller reads the reason: %s', mine);
  assert mine ->> 'change_waiting' = 'true', 'the removal still waits';
  -- the rejected photo's files are no longer needed
  assert jsonb_array_length(public.photo_files_to_delete(current_setting('t.laptop')::uuid)) >= 3,
    'rejected files are listed for deletion';
end
$$;
reset role; select pg_temp.logout();

-- Staff approve the rest: the removal. Its public files may then be deleted.
select pg_temp.remember('order_item', (select id::text from public.order_items order by id limit 1));
select pg_temp.remember('order_item_path', (select coalesce(image_path, '') from public.order_items
                                            where id = current_setting('t.order_item')::uuid));
update public.order_items
set image_path = current_setting('t.tecnocasa') || '/' || current_setting('t.laptop') || '/'
                 || current_setting('t.photo3') || '/{w}.jpg'
where id = current_setting('t.order_item')::uuid;
select pg_temp.login('comprador2@yuntera.example');
do $$
declare
  item jsonb;
begin
  select i into item from jsonb_array_elements(public.ops_photos_for_review()) i
  where i ->> 'product_id' = current_setting('t.laptop');
  perform public.ops_review_photo_change(current_setting('t.laptop')::uuid, item ->> 'revision', true);
  assert (select state from public.product_photos where id = current_setting('t.photo3')::uuid) = 'removed', 'removed';
  assert not exists (select 1 from public.product_images where photo_id = current_setting('t.photo3')::uuid),
    'gone from the shop';
  assert public.get_product('laptop-14-nimbo-libro') -> 'images' = current_setting('t.laptop_images')::jsonb,
    'back to the placeholder drawing';
  -- While an order shows the removed photo, its public files stay.
  assert pg_temp.remove_like('product-photos', current_setting('t.tecnocasa') || '/' || current_setting('t.laptop')
                             || '/' || current_setting('t.photo3') || '/') = 0, 'kept for the order history';
  begin
    perform public.ops_review_photo_change(current_setting('t.laptop')::uuid, public.seller_photos(current_setting('t.laptop')::uuid) ->> 'revision', true);
    raise exception 'approved a change that does not exist';
  exception when others then
    if sqlerrm <> 'photo_change_not_found' then raise; end if;
  end;
end
$$;
reset role; select pg_temp.logout();
update public.order_items set image_path = nullif(current_setting('t.order_item_path'), '')
where id = current_setting('t.order_item')::uuid;
select pg_temp.login('comprador2@yuntera.example');
do $$
begin
  assert pg_temp.remove_like('product-photos', current_setting('t.tecnocasa') || '/' || current_setting('t.laptop')
                             || '/' || current_setting('t.photo3') || '/') = 3,
    'staff delete the public files of a removed photo once no order shows it';
end
$$;
reset role; select pg_temp.logout();

-- A change rejected as a whole puts everything back; withdrawing does the same.
select pg_temp.login('vendedor@yuntera.example');
do $$
begin
  perform pg_temp.remember('photo5', pg_temp.add_photo(current_setting('t.draft')::uuid, 'Cafetera de lado con el filtro abierto')::text);
  perform public.seller_remove_photo(current_setting('t.photo1')::uuid);
end
$$;
reset role; select pg_temp.logout();
select pg_temp.login('comprador2@yuntera.example');
select public.ops_review_photo_change(current_setting('t.draft')::uuid,
  public.seller_photos(current_setting('t.draft')::uuid) ->> 'revision', false, 'La foto nueva está desenfocada.');
do $$
begin
  assert (select state || ':' || rejection_reason from public.product_photos where id = current_setting('t.photo5')::uuid)
         = 'rejected:La foto nueva está desenfocada.', 'added photo refused with the reason';
  assert (select state = 'approved' and remove_requested_at is null from public.product_photos
          where id = current_setting('t.photo1')::uuid), 'removal cancelled';
end
$$;
reset role; select pg_temp.logout();
select pg_temp.login('vendedor@yuntera.example');
do $$
begin
  perform public.seller_remove_photo(current_setting('t.photo2')::uuid);
  perform public.seller_withdraw_photo_changes(current_setting('t.draft')::uuid);
  assert (select remove_requested_at is null from public.product_photos where id = current_setting('t.photo2')::uuid),
    'withdrawn';
  begin
    perform public.seller_withdraw_photo_changes(current_setting('t.draft')::uuid);
    raise exception 'withdrew nothing';
  exception when others then
    if sqlerrm <> 'photo_change_not_found' then raise; end if;
  end;
end
$$;
reset role; select pg_temp.logout();

-- ═══ Files replaced after a photo was finished ═════════════════════════════

-- The storage service gives every upload a new version, also a second one
-- under the same name. A waiting photo whose files changed after it was
-- finished is not what anyone reviewed: it is flagged, its revision changes,
-- and approving refuses it.
select pg_temp.login('vendedor@yuntera.example');
select pg_temp.remember('photo6', pg_temp.add_photo(current_setting('t.laptop')::uuid, 'Laptop cerrada vista de lado')::text);
reset role; select pg_temp.logout();
select pg_temp.login('comprador2@yuntera.example');
select pg_temp.remember('revision6', (select i ->> 'revision' from jsonb_array_elements(public.ops_photos_for_review()) i
                                      where i ->> 'product_id' = current_setting('t.laptop')));
reset role; select pg_temp.logout();
select pg_temp.reupload(private.photo_path(current_setting('t.tecnocasa')::uuid, current_setting('t.laptop')::uuid,
                                           current_setting('t.photo6')::uuid, 800, 'jpeg'));
select pg_temp.login('comprador2@yuntera.example');
do $$
declare
  item jsonb;
begin
  select i into item from jsonb_array_elements(public.ops_photos_for_review()) i
  where i ->> 'product_id' = current_setting('t.laptop');
  assert item ->> 'revision' <> current_setting('t.revision6'), 'the revision changed';
  assert (select (x ->> 'files_changed')::boolean from jsonb_array_elements(item -> 'after') x
          where x ->> 'photo_id' = current_setting('t.photo6')), 'flagged for staff';
  begin
    perform public.ops_review_photo_change(current_setting('t.laptop')::uuid, current_setting('t.revision6'), true);
    raise exception 'approved with the revision from before the file changed';
  exception when others then
    if sqlerrm <> 'photos_changed' then raise; end if;
  end;
  perform public.ops_review_photo_change(current_setting('t.laptop')::uuid, item ->> 'revision', true);
  assert (select state || ':' || rejection_reason from public.product_photos where id = current_setting('t.photo6')::uuid)
         = 'rejected:Los archivos de esta foto cambiaron después de subirla, así que no la publicamos. Súbala de nuevo desde su teléfono o computadora.', 'refused, with a reason';
end
$$;
reset role; select pg_temp.logout();

-- A file replaced after approval but before the public copies are confirmed:
-- what the console read may not be what staff saw, so it is not published.
select pg_temp.login('vendedor@yuntera.example');
select pg_temp.remember('photo7', pg_temp.add_photo(current_setting('t.laptop')::uuid, 'Laptop con la pantalla girada')::text);
reset role; select pg_temp.logout();
select pg_temp.login('comprador2@yuntera.example');
do $$
declare
  item jsonb;
begin
  select i into item from jsonb_array_elements(public.ops_photos_for_review()) i
  where i ->> 'product_id' = current_setting('t.laptop');
  perform public.ops_review_photo_change(current_setting('t.laptop')::uuid, item ->> 'revision', true);
  select f into item from jsonb_array_elements(public.ops_photo_files_to_publish(current_setting('t.laptop')::uuid)) f
  where f ->> 'photo_id' = current_setting('t.photo7');
  assert item ->> 'source' like '%/1600.jpg' and (item ->> 'width')::int = 1600, format('what to read: %s', item);
  perform pg_temp.put('product-photos', p) from jsonb_array_elements_text(item -> 'paths') p;
end
$$;
reset role; select pg_temp.logout();
select pg_temp.reupload(private.photo_path(current_setting('t.tecnocasa')::uuid, current_setting('t.laptop')::uuid,
                                           current_setting('t.photo7')::uuid, 1600, 'jpeg'));
select pg_temp.login('comprador2@yuntera.example');
do $$
declare
  done jsonb := public.ops_confirm_photos_published(current_setting('t.laptop')::uuid);
begin
  assert (done ->> 'refused')::int = 1 and (done ->> 'published')::int = 0, format('refused: %s', done);
  assert (select state from public.product_photos where id = current_setting('t.photo7')::uuid) = 'rejected', 'rejected';
  assert not exists (select 1 from public.product_images where photo_id = current_setting('t.photo7')::uuid),
    'never in the shop';
  assert pg_temp.remove_like('product-photos', current_setting('t.tecnocasa') || '/' || current_setting('t.laptop')
                             || '/' || current_setting('t.photo7') || '/') = 3, 'its public copies are deleted';
end
$$;
reset role; select pg_temp.logout();

-- ═══ Staff take down a published photo ══════════════════════════════════════

select pg_temp.login('vendedor@yuntera.example');
select pg_temp.refused(format('select public.ops_remove_photo(%L, %L)', current_setting('t.photo2'),
  'Quitar porque sí, sin ser staff'), 'forbidden');
select pg_temp.refused('select public.ops_product_photos(''laptop-14-nimbo-libro'')', 'forbidden');
reset role; select pg_temp.logout();
select pg_temp.login('comprador3@yuntera.example');
select pg_temp.refused(format('select public.ops_remove_photo(%L, %L)', current_setting('t.photo2'),
  'Finanzas no decide sobre fotos'), 'forbidden');
select pg_temp.refused('select public.ops_product_photos(''laptop-14-nimbo-libro'')', 'forbidden');
reset role; select pg_temp.logout();

-- An order showed the photo.
update public.order_items
set image_path = current_setting('t.tecnocasa') || '/' || current_setting('t.draft') || '/'
                 || current_setting('t.photo2') || '/{w}.jpg'
where id = current_setting('t.order_item')::uuid;

select pg_temp.login('comprador2@yuntera.example');
select pg_temp.refused('select public.ops_product_photos(''no-existe-este-producto'')', 'catalog_product_not_found');
select pg_temp.refused(format('select public.ops_remove_photo(%L, %L)', current_setting('t.photo2'), 'no'),
  'reason_required');
do $$
declare
  listing jsonb := public.ops_product_photos((select slug from public.products where id = current_setting('t.draft')::uuid));
  done jsonb;
begin
  assert listing ->> 'product_id' = current_setting('t.draft') and listing ->> 'status' = 'active', format('found: %s', listing);
  assert exists (select 1 from jsonb_array_elements(listing -> 'photos') x
                 where x ->> 'photo_id' = current_setting('t.photo2') and (x ->> 'published')::boolean),
    'the live photo is listed';
  done := public.ops_remove_photo(current_setting('t.photo2')::uuid, 'Muestra datos personales en la etiqueta.');
  assert (done ->> 'was_public')::boolean, 'it was public';
  assert not exists (select 1 from public.product_images where photo_id = current_setting('t.photo2')::uuid),
    'gone from the shop at once';
  assert pg_temp.remove_like('product-photos', current_setting('t.tecnocasa') || '/' || current_setting('t.draft')
                             || '/' || current_setting('t.photo2') || '/') = 3, 'its public files are deleted';
  begin
    perform public.ops_remove_photo(current_setting('t.photo2')::uuid, 'Otra vez la misma foto');
    raise exception 'took down a photo twice';
  exception when others then
    if sqlerrm <> 'photo_not_found' then raise; end if;
  end;
end
$$;
reset role; select pg_temp.logout();
do $$
begin
  assert (select image_path is null from public.order_items where id = current_setting('t.order_item')::uuid),
    'the order shows the placeholder instead';
end
$$;
update public.order_items set image_path = nullif(current_setting('t.order_item_path'), '')
where id = current_setting('t.order_item')::uuid;
select pg_temp.login('vendedor@yuntera.example');
do $$
declare
  mine jsonb := public.seller_photos(current_setting('t.draft')::uuid);
begin
  assert exists (select 1 from jsonb_array_elements(mine -> 'rejected') x
                 where x ->> 'photo_id' = current_setting('t.photo2')
                   and x ->> 'rejection_reason' = 'Muestra datos personales en la etiqueta.'),
    format('the seller reads why: %s', mine);
end
$$;
reset role; select pg_temp.logout();

-- An archived listing takes no new photos.
select pg_temp.login('vendedor@yuntera.example');
select public.seller_archive_listing(current_setting('t.draft')::uuid);
select pg_temp.refused(format('select public.seller_reserve_photo(%L)', current_setting('t.draft')), 'listing_not_editable');
reset role; select pg_temp.logout();

rollback;
