-- Product photos: upload by the seller, review by catalogue staff, display in
-- the shop. Also closes the hole where a seller could change the pictures of a
-- published listing directly through the table API, without review.
--
-- ── Where the files live, and why an unapproved photo cannot be seen ───────
--
--   product-photos-pending   PRIVATE bucket. Sellers upload here. Every read
--                            goes through the rules below: only members of the
--                            shop and catalogue staff can read a file, and the
--                            storage service answers "no such bucket" to the
--                            public address of a private bucket. So knowing
--                            the address of a waiting photo is not enough.
--   product-photos           PUBLIC bucket, served from a cacheable public
--                            address. Nobody but catalogue staff can add a
--                            file to it, and only for a photo the database
--                            already records as approved, under exactly that
--                            photo's path. Sellers cannot write to it at all.
--
-- Promotion is done by the staff member's own session right after they
-- approve (the rules allow writing to the public bucket only once the approval
-- is committed): the console reads the largest waiting copy, the one staff
-- looked at, decodes it, and writes all three public sizes made from it, so
-- the shop can only ever serve the picture that was reviewed, without the
-- metadata it carried. The shop shows a photo only after its files were
-- confirmed (published_at), so it never points at a missing file. No app holds
-- a privileged key: every step runs as the person doing it.
--
-- Paths are `<seller id>/<product id>/<photo id>/<size>.<ext>` in both buckets
-- (packages/core/src/photos.ts builds the same; photos.test.ts compares them).
-- A file can only be added for a photo that was first reserved through
-- seller_reserve_photo (that is where the per-listing, per-shop and per-day
-- limits are counted), in the last two hours, under that photo's own path and
-- one of its three sizes. Nothing can be overwritten or moved: there is no
-- UPDATE rule, and an upload (or signed upload address) asked for with
-- `x-upsert: true` is refused, because the real service's upsert probe would
-- otherwise pass on a path that does not exist yet and the address could then
-- replace the file later. As a second line, each waiting file's storage
-- version is recorded when the photo is finished; a photo whose files changed
-- afterwards is never approved or published. The buckets refuse anything over
-- 2 MiB and any declared type other than JPEG, PNG or WebP (never SVG).
--
-- Reading a waiting file. Catalogue staff may read and sign links to any of
-- them. A seller may download (never sign a link to) the files of their own
-- photos that are still being uploaded, waiting, or approved but not yet
-- public, and may delete those nothing needs any more; nothing else. The
-- storage service tells the rules which operation is running
-- (storage.operation(), set by the service for every request since 2024), and
-- that is what keeps a seller from turning a waiting photo into a link anyone
-- can open: a signed link is checked only when it is made, and then works for
-- as long as the seller asked, however long that is.
--
-- ── Review ──────────────────────────────────────────────────────────────────
--
-- Photos of a listing that is not published are reviewed with the listing:
-- publishing it approves them. Changing the photos of a listing that waits for
-- review sends it back to draft, as a change to its text does, so staff never
-- publish photos added after they looked. A published listing's photos change only
-- through review: added photos wait, a removal waits (the photo stays in the
-- shop), and a new order or new alternative text waits. The shop keeps showing
-- the approved set until staff approve the change. A rejected photo carries a
-- reason the seller reads. Catalogue staff can also take down any photo at
-- any time (ops_remove_photo), approved and public ones included.
--
-- ── Cleanup ─────────────────────────────────────────────────────────────────
--
-- Rows in storage.objects must not be deleted by SQL (the file would stay
-- behind), so files are deleted through the storage service by people who may:
--   * the seller's own actions delete their listing's waiting files that are
--     no longer needed;
--   * every catalogue decision deletes the waiting copies of decided photos
--     and the public copies of removed ones, plus a batch of anything else
--     that is no longer needed (photo_files_to_delete lists them: files of
--     rejected or removed photos, waiting copies of published photos, and
--     uploads abandoned for more than two hours).
-- What a shop can leave behind meanwhile is bounded: files of a removed or
-- abandoned photo count against the shop's limit of waiting photos until
-- they are deleted, nobody but staff can read them, and a shop can start at
-- most a set number of photos a day. A scheduled job holding a secret key
-- would delete them without anyone acting; it is not built, and nothing here
-- depends on it.
--
-- Same rules as every other function: an empty search_path, the caller checked
-- first, errors as short codes, nothing callable until it is granted below.

-- ═══ Rules ══════════════════════════════════════════════════════════════════

-- packages/core/src/photos.ts holds the same numbers (PHOTO_RULES); a unit
-- test reads the lines between the markers and compares them.
-- BEGIN photo_rules
create or replace function private.photo_rules() returns jsonb
language sql immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'sizes', jsonb_build_array(400, 800, 1600),
    'max_photos', 8,
    'max_bytes', 2097152,
    'min_edge', 500,
    'alt_min', 5,
    'alt_max', 250,
    'upload_window_minutes', 120,
    'max_waiting_per_shop', 40,
    'max_new_per_day', 100
  );
$$;
-- END photo_rules

create or replace function private.photo_sizes() returns integer[]
language sql immutable
set search_path = ''
as $$
  select array(select jsonb_array_elements_text(private.photo_rules() -> 'sizes')::integer);
$$;

create or replace function private.photo_rule(p_name text) returns integer
language sql immutable
set search_path = ''
as $$
  select (private.photo_rules() ->> p_name)::integer;
$$;

-- A cast that answers null instead of failing, for path segments that a
-- stranger may have made up.
create or replace function private.uuid_or_null(p_text text) returns uuid
language plpgsql immutable
set search_path = ''
as $$
begin
  return p_text::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

create or replace function private.photo_extension(p_format text) returns text
language sql immutable
set search_path = ''
as $$
  select case p_format when 'jpeg' then 'jpg' when 'png' then 'png' when 'webp' then 'webp' end;
$$;

create or replace function private.photo_content_type(p_format text) returns text
language sql immutable
set search_path = ''
as $$
  select case p_format when 'jpeg' then 'image/jpeg' when 'png' then 'image/png'
                       when 'webp' then 'image/webp' end;
$$;

-- BEGIN photo_path
create or replace function private.photo_path(
  p_seller_id uuid, p_product_id uuid, p_photo_id uuid, p_size integer, p_format text
) returns text
language sql immutable
set search_path = ''
as $$
  select p_seller_id::text || '/' || p_product_id::text || '/' || p_photo_id::text || '/'
         || p_size::text || '.' || private.photo_extension(p_format);
$$;
-- END photo_path

-- What the shop receives for a photo: its path with `{w}` where the size goes.
create or replace function private.photo_template(
  p_seller_id uuid, p_product_id uuid, p_photo_id uuid, p_format text
) returns text
language sql immutable
set search_path = ''
as $$
  select p_seller_id::text || '/' || p_product_id::text || '/' || p_photo_id::text || '/{w}.'
         || private.photo_extension(p_format);
$$;

-- ═══ Buckets ════════════════════════════════════════════════════════════════
-- Created here so a new environment needs no manual step. Re-running keeps
-- them in line with this file.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('product-photos-pending', 'product-photos-pending', false, 2097152,
   array['image/jpeg', 'image/png', 'image/webp']),
  ('product-photos', 'product-photos', true, 2097152,
   array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ═══ Photos ═════════════════════════════════════════════════════════════════

create table public.product_photos (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  -- The shop the files belong to; the first folder of their path.
  seller_id uuid not null references public.sellers (id) on delete cascade,
  format text not null default 'jpeg' check (format in ('jpeg', 'png', 'webp')),
  --   uploading  reserved; its files are being uploaded
  --   pending    uploaded; waiting for catalogue staff
  --   approved   approved (shown in the shop once its files are published)
  --   rejected   refused by staff, with a reason
  --   removed    taken away by the seller, by an approved change, or abandoned
  state text not null default 'uploading'
    check (state in ('uploading', 'pending', 'approved', 'rejected', 'removed')),
  -- What the seller wants: the order and alternative text of their working set.
  position smallint not null default 0,
  alt text check (char_length(alt) <= 250),
  -- Pixel size of the largest rendition (the others follow from it).
  width integer check (width between 1 and 1600),
  height integer check (height between 1 and 1600),
  bytes bigint,
  -- The storage version of each waiting file when the photo was finished,
  -- {"400": "...", "800": "...", "1600": "..."}: a file uploaded again under
  -- the same name gets a new version, so a changed file is noticed.
  file_versions jsonb,
  -- What the shop shows, for an approved photo: its place and its text. These
  -- change only when staff approve, so a published listing keeps its approved
  -- set while a change waits.
  live_position smallint,
  live_alt text,
  -- When the approved files were confirmed in the public bucket.
  published_at timestamptz,
  -- The seller asked to remove an approved photo of a published listing.
  remove_requested_at timestamptz,
  rejection_reason text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  check (state <> 'approved' or live_alt is not null or live_position is null)
);

create index product_photos_product_idx on public.product_photos (product_id, state, position);
create index product_photos_waiting_idx on public.product_photos (state)
  where state in ('uploading', 'pending') or (state = 'approved' and published_at is null);

create trigger product_photos_updated_at before update on public.product_photos
  for each row execute function private.set_updated_at();

alter table public.product_photos enable row level security;
revoke all on public.product_photos from anon, authenticated;
-- Read-only through the API, and only for the shop and catalogue staff; every
-- change goes through the functions below.
grant select on public.product_photos to authenticated;
create policy "shop members, or catalogue staff" on public.product_photos
  for select to authenticated
  using ((select private.is_seller_member(product_photos.seller_id))
         or (select private.has_staff_role('catalog')));

-- ═══ product_images: no more direct writes ══════════════════════════════════
-- Before this migration a seller could insert, change and delete rows here for
-- any of their listings, published or not, and the shop showed them at once.
-- Now nothing writes here through the API. The table keeps the placeholder
-- drawings of the demo catalogue and, maintained by the functions below, one
-- row per photo the shop shows (its path is the photo's template), so every
-- screen that already reads a product's first image shows its first photo.

drop policy if exists "listing owner writes" on public.product_images;
revoke insert, update, delete on public.product_images from anon, authenticated;

alter table public.product_images
  add column photo_id uuid unique references public.product_photos (id) on delete cascade;

-- Rewrites a product's photo rows from its live, published photos. Photos sort
-- before drawings (whose sort starts at 0).
create or replace function private.sync_product_images(p_product_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  delete from public.product_images where product_id = p_product_id and photo_id is not null;
  insert into public.product_images (product_id, path, alt, sort, photo_id)
  select ph.product_id,
         private.photo_template(ph.seller_id, ph.product_id, ph.id, ph.format),
         ph.live_alt,
         ph.live_position - 100,
         ph.id
  from public.product_photos ph
  where ph.product_id = p_product_id and ph.state = 'approved'
    and ph.live_position is not null and ph.published_at is not null;
end;
$$;

-- ═══ Rules on storage.objects ═══════════════════════════════════════════════
-- The storage service runs each operation as the caller (role authenticated,
-- with their claims), so these rules decide. Visitors get nothing: the public
-- bucket is readable at its public address without any rule, and that is the
-- only thing a visitor can do.
--
-- Two things the service sets for every request are read here
-- (supabase/storage, src/internal/database/postgres/scope.ts):
--   storage.operation   which operation runs, e.g. storage.object.sign. Several
--                       operations all need SELECT; this tells them apart (it is
--                       what storage.allow_only_operation() reads).
--   request.headers     the request's headers as JSON, to see x-upsert.
-- Outside the storage service both are empty, and the rules then allow a
-- seller no reading at all.

-- The operation the storage service is running, without its "storage." prefix
-- (older names have none), or '' outside it.
create or replace function private.storage_operation() returns text
language sql stable
set search_path = ''
as $$
  select regexp_replace(coalesce(current_setting('storage.operation', true), ''), '^storage\.', '');
$$;

-- Did the request ask storage to replace the file if it exists? A header that
-- cannot be read counts as yes.
create or replace function private.storage_upsert_requested() returns boolean
language plpgsql stable
set search_path = ''
as $$
declare
  v_headers text := nullif(current_setting('request.headers', true), '');
begin
  if v_headers is null then
    return false;
  end if;
  return lower(coalesce(v_headers::jsonb ->> 'x-upsert', '')) = 'true';
exception when others then
  return true;
end;
$$;

-- The photo a path belongs to, when the path is well formed.
create or replace function private.photo_for_object(p_name text)
returns public.product_photos
language sql stable security definer
set search_path = ''
as $$
  select ph.* from public.product_photos ph
  where ph.id = private.uuid_or_null(split_part(p_name, '/', 3))
    and ph.seller_id = private.uuid_or_null(split_part(p_name, '/', 1))
    and ph.product_id = private.uuid_or_null(split_part(p_name, '/', 2))
    and p_name in (select private.photo_path(ph.seller_id, ph.product_id, ph.id, s, ph.format)
                   from unnest(private.photo_sizes()) s);
$$;

-- May the caller add this file? Never as a replacement of an existing one.
create or replace function private.photo_object_insertable(p_bucket text, p_name text)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  ph public.product_photos;
begin
  -- Storage does not run the Data API's check_request, so the same checks
  -- (20261121082500_account_security.sql) are made here: an ended session or a
  -- deleted account, and a password-only session of an account with a second
  -- factor, can do nothing with these files.
  if not (private.session_alive() and private.factor_ok()) then
    return false;
  end if;
  if private.storage_upsert_requested() then
    return false;
  end if;
  ph := private.photo_for_object(p_name);
  if ph.id is null then
    return false;
  end if;
  if p_bucket = 'product-photos-pending' then
    -- The shop's own reservation, still open.
    return ph.state = 'uploading'
       and ph.created_at > now() - make_interval(mins => private.photo_rule('upload_window_minutes'))
       and private.is_seller_member(ph.seller_id);
  elsif p_bucket = 'product-photos' then
    -- Promotion: catalogue staff, for a photo already approved.
    return ph.state = 'approved' and private.has_staff_role('catalog');
  end if;
  return false;
end;
$$;

-- Is this file no longer needed? Waiting copies of decided photos, anything of
-- a removed or rejected photo, abandoned uploads, and files with no photo. The
-- public copy of a photo the seller removed stays while an order shows it.
create or replace function private.photo_object_disposable(
  p_bucket text, p_name text, p_created_at timestamptz
) returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  ph public.product_photos;
begin
  if p_bucket not in ('product-photos-pending', 'product-photos') then
    return false;
  end if;
  ph := private.photo_for_object(p_name);
  if ph.id is null then
    -- No photo (or not a photo path at all). Give an upload in progress its window.
    return p_created_at < now() - make_interval(mins => private.photo_rule('upload_window_minutes'));
  end if;
  if p_bucket = 'product-photos' and ph.state = 'removed'
     and exists (select 1 from public.order_items i
                 where i.image_path = private.photo_template(ph.seller_id, ph.product_id, ph.id, ph.format)) then
    return false;
  end if;
  if ph.state in ('removed', 'rejected') then
    return true;
  end if;
  if p_bucket = 'product-photos-pending' then
    return (ph.state = 'approved' and ph.published_at is not null)
        or (ph.state = 'uploading'
            and ph.created_at < now() - make_interval(mins => private.photo_rule('upload_window_minutes')));
  end if;
  return false;
end;
$$;

-- May the caller see this file's row: download it, sign a link to it, or
-- delete it? Catalogue staff: anything in both buckets. A member of the shop:
-- only in the private bucket, only by downloading (never by signing a link,
-- listing, copying or moving), and only a file that is part of a review: an
-- upload in progress, a waiting photo, or an approved one not yet public. And,
-- for deleting, any of the shop's waiting files that nothing needs.
create or replace function private.photo_object_readable(
  p_bucket text, p_name text, p_created_at timestamptz
) returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  ph public.product_photos;
  v_operation text := private.storage_operation();
begin
  if p_bucket not in ('product-photos-pending', 'product-photos') then
    return false;
  end if;
  -- As for adding files: Storage does not run check_request.
  if not (private.session_alive() and private.factor_ok()) then
    return false;
  end if;
  if private.has_staff_role('catalog') then
    return true;
  end if;
  if p_bucket <> 'product-photos-pending'
     or not private.is_seller_member(private.uuid_or_null(split_part(p_name, '/', 1))) then
    return false;
  end if;
  if v_operation in ('object.delete', 'object.delete_many') then
    return private.photo_object_disposable(p_bucket, p_name, p_created_at);
  end if;
  if v_operation not in ('object.get_authenticated', 'object.get_authenticated_info',
                         'object.head_authenticated_info', 'object.info_authenticated') then
    return false;
  end if;
  ph := private.photo_for_object(p_name);
  return ph.id is not null
     and ((ph.state = 'uploading'
           and ph.created_at > now() - make_interval(mins => private.photo_rule('upload_window_minutes')))
          or ph.state = 'pending'
          or (ph.state = 'approved' and ph.published_at is null));
end;
$$;

create or replace function private.photo_object_deletable(
  p_bucket text, p_name text, p_created_at timestamptz
) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.photo_object_readable(p_bucket, p_name, p_created_at)
     and private.photo_object_disposable(p_bucket, p_name, p_created_at);
$$;

grant execute on function
  private.uuid_or_null(text),
  private.photo_object_insertable(text, text),
  private.photo_object_readable(text, text, timestamptz),
  private.photo_object_deletable(text, text, timestamptz)
to authenticated;

drop policy if exists "product photos: add" on storage.objects;
drop policy if exists "product photos: read" on storage.objects;
drop policy if exists "product photos: delete" on storage.objects;

create policy "product photos: add" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('product-photos-pending', 'product-photos')
              and private.photo_object_insertable(bucket_id, name));

create policy "product photos: read" on storage.objects
  for select to authenticated
  using (bucket_id in ('product-photos-pending', 'product-photos')
         and private.photo_object_readable(bucket_id, name, created_at));

create policy "product photos: delete" on storage.objects
  for delete to authenticated
  using (bucket_id in ('product-photos-pending', 'product-photos')
         and private.photo_object_deletable(bucket_id, name, created_at));

-- (No UPDATE rule: nothing in either bucket can be overwritten or moved.)

-- Order history keeps a photo's address; the rule above looks it up.
create index if not exists order_items_image_path_idx on public.order_items (image_path);

-- What identifies the content of one stored file: the version the storage
-- service gives every upload (also a repeated upload under the same name) and
-- the checksum it recorded.
create or replace function private.object_fingerprint(p_version text, p_metadata jsonb) returns text
language sql immutable
set search_path = ''
as $$
  select coalesce(p_version, '') || ':' || coalesce(p_metadata ->> 'eTag', '');
$$;

-- Do the waiting files of a photo still hold what was there when it was
-- finished? A file uploaded again gets a new storage version.
create or replace function private.photo_files_intact(ph public.product_photos) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select ph.file_versions is not null
     and not exists (
       select 1 from unnest(private.photo_sizes()) s
       where not exists (
         select 1 from storage.objects o
         where o.bucket_id = 'product-photos-pending'
           and o.name = private.photo_path(ph.seller_id, ph.product_id, ph.id, s, ph.format)
           and private.object_fingerprint(o.version, o.metadata) = ph.file_versions ->> s::text));
$$;

-- ═══ Helpers for the functions ══════════════════════════════════════════════

-- The listing whose photos the caller (a member of its shop) manages.
create or replace function private.photo_listing(p_product_id uuid) returns public.products
language plpgsql security definer
set search_path = ''
as $$
declare
  p public.products;
begin
  select * into p from public.products where id = p_product_id for update;
  if not found or p.created_by_seller_id is null
     or not private.is_seller_member(p.created_by_seller_id) then
    perform private.fail('listing_not_found');
  end if;
  return p;
end;
$$;

-- Marks abandoned reservations as removed, so they stop counting.
create or replace function private.expire_photo_reservations(p_product_id uuid) returns void
language sql security definer
set search_path = ''
as $$
  update public.product_photos
  set state = 'removed'
  where product_id = p_product_id and state = 'uploading'
    and created_at < now() - make_interval(mins => private.photo_rule('upload_window_minutes'));
$$;

-- Alternative text as it is stored: spaces collapsed, trimmed, within limits.
create or replace function private.clean_alt(p_alt text) returns text
language sql immutable
set search_path = ''
as $$
  select case when char_length(v) between private.photo_rule('alt_min') and private.photo_rule('alt_max')
              then v end
  from (select trim(regexp_replace(coalesce(p_alt, ''), '\s+', ' ', 'g')) as v) x;
$$;

-- One photo as the seller and the console see it.
create or replace function private.photo_json(ph public.product_photos) returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'photo_id', ph.id,
    'state', ph.state,
    'position', ph.position,
    'alt', ph.alt,
    'width', ph.width,
    'height', ph.height,
    'format', ph.format,
    'template', private.photo_template(ph.seller_id, ph.product_id, ph.id, ph.format),
    'live', ph.state = 'approved' and ph.live_position is not null,
    'live_position', ph.live_position,
    'live_alt', ph.live_alt,
    'published', ph.published_at is not null,
    -- Its waiting files were uploaded again after it was finished: never approved.
    'files_changed', ph.state = 'pending' and not private.photo_files_intact(ph),
    'remove_requested', ph.remove_requested_at is not null,
    'rejection_reason', ph.rejection_reason,
    'created_at', ph.created_at,
    'decided_at', ph.decided_at);
$$;

-- Photos the seller is working with: waiting, approved and not on their way
-- out, in their order. (Rejected ones are shown apart; they are not proposed.)
create or replace function private.working_photos(p_product_id uuid)
returns setof public.product_photos
language sql stable security definer
set search_path = ''
as $$
  select * from public.product_photos
  where product_id = p_product_id
    and (state = 'pending' or (state = 'approved' and remove_requested_at is null))
  order by position, created_at, id;
$$;

-- Photos the shop shows now, in their order.
create or replace function private.live_photos(p_product_id uuid)
returns setof public.product_photos
language sql stable security definer
set search_path = ''
as $$
  select * from public.product_photos
  where product_id = p_product_id and state = 'approved' and live_position is not null
  order by live_position, id;
$$;

-- Does a published listing have a photo change waiting? Added photos, a
-- removal, or a different order or text than the shop shows.
create or replace function private.photo_change_waiting(p_product_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.product_photos
                 where product_id = p_product_id
                   and (state = 'pending' or (state = 'approved' and remove_requested_at is not null)))
      or coalesce((select array_agg(w.id order by w.position, w.created_at, w.id)
                   from private.working_photos(p_product_id) w), '{}')
         is distinct from
         coalesce((select array_agg(l.id order by l.live_position, l.id)
                   from private.live_photos(p_product_id) l), '{}')
      or exists (select 1 from public.product_photos
                 where product_id = p_product_id and state = 'approved'
                   and alt is distinct from live_alt);
$$;

-- A fingerprint of what the seller proposes. Staff send back the one they
-- looked at; if the seller changed anything since, the decision is refused
-- instead of approving photos nobody reviewed.
create or replace function private.photo_revision(p_product_id uuid) returns text
language sql stable security definer
set search_path = ''
as $$
  select md5(coalesce(string_agg(
           ph.id::text || ':' || ph.state || ':' || ph.position || ':' || coalesce(ph.alt, '')
           || ':' || coalesce(ph.remove_requested_at::text, '')
           || ':' || case when ph.state = 'pending' then private.photo_files_intact(ph)::text else '' end,
           '|' order by ph.id), ''))
  from public.product_photos ph
  where ph.product_id = p_product_id and ph.state in ('pending', 'approved');
$$;

-- Approves everything the seller proposes for a listing: waiting photos join,
-- removals happen, and the shop takes the seller's order and text. Used when a
-- new listing is published and when a published listing's change is approved.
create or replace function private.approve_photo_set(p_product_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  -- A waiting photo whose files were replaced after it was finished is not
  -- what anyone reviewed: refuse it instead.
  update public.product_photos ph
  set state = 'rejected', rejection_reason = 'Los archivos de esta foto cambiaron después de subirla, así que no la publicamos. Súbala de nuevo desde su teléfono o computadora.',
      decided_by = (select auth.uid()), decided_at = clock_timestamp()
  where ph.product_id = p_product_id and ph.state = 'pending' and not private.photo_files_intact(ph);

  update public.product_photos
  set state = 'removed', live_position = null, decided_by = (select auth.uid()),
      decided_at = clock_timestamp()
  where product_id = p_product_id and state = 'approved' and remove_requested_at is not null;

  update public.product_photos ph
  set state = 'approved',
      live_position = w.rank,
      live_alt = ph.alt,
      position = w.rank,
      decided_by = case when ph.state = 'pending' then (select auth.uid()) else ph.decided_by end,
      decided_at = case when ph.state = 'pending' then clock_timestamp() else ph.decided_at end
  from (
    select x.id, (row_number() over (order by x.position, x.created_at, x.id))::smallint as rank
    from private.working_photos(p_product_id) x
  ) w
  where ph.id = w.id;

  perform private.sync_product_images(p_product_id);
end;
$$;

-- The seller changed the photos of a listing. One that waits for review goes
-- back to draft, as a change to its text does, so staff never publish photos
-- added after they looked. Answers the listing's status afterwards.
create or replace function private.photos_touched(p public.products) returns text
language plpgsql security definer
set search_path = ''
as $$
begin
  if p.status = 'pending_review' then
    update public.products set status = 'draft' where id = p.id;
    return 'draft';
  end if;
  return p.status::text;
end;
$$;

-- ═══ Seller ═════════════════════════════════════════════════════════════════

-- The photos of one listing, for its photo manager.
create or replace function public.seller_photos(p_product_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  p public.products%rowtype;
begin
  select * into p from public.products where id = p_product_id;
  if not found or p.created_by_seller_id is null
     or not (private.is_seller_member(p.created_by_seller_id) or private.has_staff_role('catalog')) then
    perform private.fail('listing_not_found');
  end if;

  return jsonb_build_object(
    'product_id', p.id,
    'seller_id', p.created_by_seller_id,
    'status', p.status,
    'rules', private.photo_rules(),
    'revision', private.photo_revision(p.id),
    'change_waiting', p.status = 'active' and private.photo_change_waiting(p.id),
    'photos', coalesce((
      select jsonb_agg(private.photo_json(ph) order by ph.position, ph.created_at, ph.id)
      from private.working_photos(p.id) ph), '[]'::jsonb),
    'leaving', coalesce((
      select jsonb_agg(private.photo_json(ph) order by ph.live_position, ph.id)
      from public.product_photos ph
      where ph.product_id = p.id and ph.state = 'approved' and ph.remove_requested_at is not null),
      '[]'::jsonb),
    'rejected', coalesce((
      select jsonb_agg(private.photo_json(ph) order by ph.decided_at desc, ph.id)
      from public.product_photos ph where ph.product_id = p.id and ph.state = 'rejected'),
      '[]'::jsonb),
    'live', coalesce((
      select jsonb_agg(private.photo_json(ph) order by ph.live_position, ph.id)
      from private.live_photos(p.id) ph), '[]'::jsonb)
  );
end;
$$;

-- Reserves a place for a new photo and says where its files go. The files are
-- then uploaded to the private bucket (the rules accept them only for this
-- reservation, for two hours) and the photo is finished with its text.
create or replace function public.seller_reserve_photo(p_product_id uuid, p_format text default 'jpeg')
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  p public.products;
  v_photo public.product_photos;
begin
  p := private.photo_listing(p_product_id);
  if p.status = 'archived' then
    perform private.fail('listing_not_editable');
  end if;
  if p_format is null or p_format not in ('jpeg', 'png', 'webp') then
    perform private.fail('invalid_photo');
  end if;

  perform private.expire_photo_reservations(p.id);

  -- Shop-wide limits, counted under the shop's lock so two listings cannot
  -- both pass. Files of removed or abandoned photos count until they are
  -- deleted, so a shop cannot pile up files nobody reviews.
  perform 1 from public.sellers where id = p.created_by_seller_id for update;
  if (select count(*) from public.product_photos ph
      where ph.seller_id = p.created_by_seller_id
        and ph.created_at > now() - interval '1 day')
     >= private.photo_rule('max_new_per_day') then
    perform private.fail('photo_daily_limit_reached');
  end if;
  if (select count(*) from public.product_photos ph
      where ph.seller_id = p.created_by_seller_id
        and ((ph.state = 'uploading'
              and ph.created_at > now() - make_interval(mins => private.photo_rule('upload_window_minutes')))
             or ph.state = 'pending'
             or exists (select 1 from storage.objects o
                        where o.bucket_id = 'product-photos-pending'
                          and o.name in (select private.photo_path(ph.seller_id, ph.product_id, ph.id, s, ph.format)
                                         from unnest(private.photo_sizes()) s))))
     >= private.photo_rule('max_waiting_per_shop') then
    perform private.fail('photo_shop_limit_reached');
  end if;

  -- What the listing will have if everything waiting is approved.
  if (select count(*) from public.product_photos
      where product_id = p.id
        and (state in ('uploading', 'pending')
             or (state = 'approved' and remove_requested_at is null)))
     >= private.photo_rule('max_photos') then
    perform private.fail('photo_limit_reached');
  end if;

  insert into public.product_photos (product_id, seller_id, format, position, created_by)
  values (p.id, p.created_by_seller_id, p_format,
          coalesce((select max(position) + 1 from public.product_photos
                    where product_id = p.id and state <> 'removed'), 1),
          (select auth.uid()))
  returning * into v_photo;

  return jsonb_build_object(
    'photo_id', v_photo.id,
    'bucket', 'product-photos-pending',
    'content_type', private.photo_content_type(v_photo.format),
    'files', (
      select jsonb_agg(jsonb_build_object(
        'size', s, 'path', private.photo_path(v_photo.seller_id, v_photo.product_id, v_photo.id, s, v_photo.format))
        order by s)
      from unnest(private.photo_sizes()) s));
end;
$$;

-- The files of a reserved photo are uploaded: check they are all there, of an
-- accepted type and size, and record the photo with its alternative text. It
-- then waits for review.
create or replace function public.seller_finish_photo(
  p_photo_id uuid, p_alt text, p_width integer, p_height integer
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  ph public.product_photos;
  p public.products;
  v_alt text := private.clean_alt(p_alt);
  v_files jsonb;
begin
  select * into ph from public.product_photos where id = p_photo_id;
  if not found or not private.is_seller_member(ph.seller_id) then
    perform private.fail('photo_not_found');
  end if;
  -- The listing first (as every review does), then the photo: finishing a
  -- photo and deciding the listing's photos cannot overlap.
  p := private.photo_listing(ph.product_id);
  select * into ph from public.product_photos where id = p_photo_id for update;
  if ph.state <> 'uploading' then
    perform private.fail('photo_not_found');
  end if;
  if v_alt is null then
    perform private.fail('photo_alt_required');
  end if;
  if p_width is null or p_height is null or p_width < 1 or p_height < 1
     or greatest(p_width, p_height) > 1600
     or greatest(p_width, p_height) < private.photo_rule('min_edge') then
    perform private.fail('invalid_photo');
  end if;

  -- What the storage service recorded for each expected file.
  select jsonb_agg(jsonb_build_object('size', s, 'object', to_jsonb(o)))
  into v_files
  from unnest(private.photo_sizes()) s
  left join storage.objects o
    on o.bucket_id = 'product-photos-pending'
   and o.name = private.photo_path(ph.seller_id, ph.product_id, ph.id, s, ph.format);
  if exists (select 1 from jsonb_array_elements(v_files) f where f -> 'object' = 'null'::jsonb) then
    perform private.fail('photo_upload_incomplete');
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_files) f
    where f -> 'object' -> 'metadata' ->> 'mimetype' is distinct from private.photo_content_type(ph.format)
       or coalesce((f -> 'object' -> 'metadata' ->> 'size')::bigint, 0) not between 1 and private.photo_rule('max_bytes')
  ) then
    perform private.fail('invalid_photo');
  end if;

  update public.product_photos
  set state = 'pending', alt = v_alt, width = p_width, height = p_height,
      bytes = (select sum((f -> 'object' -> 'metadata' ->> 'size')::bigint)
               from jsonb_array_elements(v_files) f),
      file_versions = (select jsonb_object_agg(f ->> 'size',
                                               private.object_fingerprint(f -> 'object' ->> 'version',
                                                                          f -> 'object' -> 'metadata'))
                       from jsonb_array_elements(v_files) f)
  where id = ph.id
  returning * into ph;

  perform private.emit('product.photo_added', jsonb_build_object('product_id', ph.product_id, 'photo_id', ph.id));
  return private.photo_json(ph) || jsonb_build_object('listing_status', private.photos_touched(p));
end;
$$;

-- Sets the order and the alternative text of a listing's photos. `p_items` is
-- the whole working set, in the new order: [{photo_id, alt}]. On a published
-- listing this is a change that waits for review; the shop keeps its order.
create or replace function public.seller_save_photos(p_product_id uuid, p_items jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  p public.products;
  v_ids uuid[];
  v_changed integer;
begin
  p := private.photo_listing(p_product_id);
  if p.status = 'archived' then
    perform private.fail('listing_not_editable');
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    perform private.fail('photos_changed');
  end if;

  select array_agg(private.uuid_or_null(i ->> 'photo_id') order by n) into v_ids
  from jsonb_array_elements(p_items) with ordinality as x (i, n);
  -- Exactly the photos on the seller's screen, each once. Anything else means
  -- the page is out of date (a photo was added or decided meanwhile).
  if coalesce(cardinality(v_ids), 0) <> coalesce((select count(*) from private.working_photos(p.id)), 0)
     or exists (select 1 from unnest(v_ids) v where v is null)
     or (select count(distinct v) from unnest(v_ids) v) <> coalesce(cardinality(v_ids), 0)
     or exists (select 1 from unnest(v_ids) v
                where v not in (select w.id from private.working_photos(p.id) w)) then
    perform private.fail('photos_changed');
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) i
             where private.clean_alt(i ->> 'alt') is null) then
    perform private.fail('photo_alt_required');
  end if;

  update public.product_photos ph
  set position = x.n, alt = private.clean_alt(x.i ->> 'alt')
  from jsonb_array_elements(p_items) with ordinality as x (i, n)
  where ph.id = (x.i ->> 'photo_id')::uuid
    and (ph.position, ph.alt) is distinct from (x.n::smallint, private.clean_alt(x.i ->> 'alt'));
  get diagnostics v_changed = row_count;

  if p.status <> 'active' then
    -- Not public yet: the listing's review covers it. Approved photos of a
    -- listing that is not on sale take the new text and order now.
    update public.product_photos ph
    set live_position = ph.position, live_alt = ph.alt
    where ph.product_id = p.id and ph.state = 'approved' and ph.live_position is not null;
    perform private.sync_product_images(p.id);
    return jsonb_build_object('outcome', 'saved', 'revision', private.photo_revision(p.id),
      'listing_status', case when v_changed > 0 then private.photos_touched(p) else p.status::text end);
  end if;
  return jsonb_build_object(
    'outcome', case when private.photo_change_waiting(p.id) then 'in_review' else 'saved' end,
    'revision', private.photo_revision(p.id),
    'listing_status', p.status::text);
end;
$$;

-- Removes a photo. A photo the shop shows on a published listing stays until
-- staff approve its removal; anything else goes at once (the seller's centre
-- then deletes its files). Answers what happened.
create or replace function public.seller_remove_photo(p_photo_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  ph public.product_photos;
  p public.products;
begin
  select * into ph from public.product_photos where id = p_photo_id;
  if not found or not private.is_seller_member(ph.seller_id) or ph.state = 'removed' then
    perform private.fail('photo_not_found');
  end if;
  p := private.photo_listing(ph.product_id);
  select * into ph from public.product_photos where id = p_photo_id for update;

  if ph.state = 'approved' and ph.live_position is not null and p.status = 'active' then
    if ph.remove_requested_at is null then
      update public.product_photos set remove_requested_at = clock_timestamp() where id = ph.id;
    end if;
    return jsonb_build_object('outcome', 'in_review', 'listing_status', p.status::text);
  end if;

  update public.product_photos
  set state = 'removed', live_position = null, remove_requested_at = null
  where id = ph.id;
  perform private.sync_product_images(p.id);
  return jsonb_build_object('outcome', 'removed', 'listing_status',
    -- Taking away a rejected photo or a broken upload changes nothing staff review.
    case when ph.state in ('pending', 'approved') then private.photos_touched(p) else p.status::text end);
end;
$$;

-- Takes back every photo change waiting on a published listing: added photos
-- are dropped, removals cancelled, order and text back to what the shop shows.
create or replace function public.seller_withdraw_photo_changes(p_product_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  p public.products;
begin
  p := private.photo_listing(p_product_id);
  if p.status <> 'active' or not private.photo_change_waiting(p.id) then
    perform private.fail('photo_change_not_found');
  end if;
  update public.product_photos set state = 'removed'
  where product_id = p.id and state = 'pending';
  update public.product_photos
  set remove_requested_at = null, position = live_position, alt = live_alt
  where product_id = p.id and state = 'approved' and live_position is not null;
end;
$$;

-- ═══ Catalogue staff ════════════════════════════════════════════════════════

-- Photos waiting for a decision, per listing:
--   new        a listing waiting for review (decided with the listing)
--   change     a published listing whose photos the seller wants to change
--   publish    approved photos whose files are not yet in the public bucket
create or replace function public.ops_photos_for_review() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'product_id', p.id,
      'slug', p.slug,
      'title', p.title,
      'status', p.status,
      'seller_name', s.trade_name,
      'kind', k.kind,
      'revision', private.photo_revision(p.id),
      'before', coalesce((
        select jsonb_agg(private.photo_json(ph) order by ph.live_position, ph.id)
        from private.live_photos(p.id) ph), '[]'::jsonb),
      'after', coalesce((
        select jsonb_agg(private.photo_json(ph) order by ph.position, ph.created_at, ph.id)
        from private.working_photos(p.id) ph), '[]'::jsonb),
      'unpublished', (
        select count(*) from public.product_photos ph
        where ph.product_id = p.id and ph.state = 'approved' and ph.published_at is null)
    ) order by k.kind, p.updated_at, p.id)
    from public.products p
    join public.sellers s on s.id = p.created_by_seller_id
    cross join lateral (
      select case
        when exists (select 1 from public.product_photos ph
                     where ph.product_id = p.id and ph.state = 'approved' and ph.published_at is null)
          then 'publish'
        when p.status = 'pending_review'
             and exists (select 1 from private.working_photos(p.id)) then 'new'
        when p.status = 'active' and private.photo_change_waiting(p.id) then 'change'
      end as kind
    ) k
    where k.kind is not null
  ), '[]'::jsonb);
end;
$$;

-- Refuses one waiting photo, with a reason the seller reads. The rest of the
-- listing is unaffected.
create or replace function public.ops_reject_photo(p_photo_id uuid, p_reason text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  ph public.product_photos;
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  if coalesce(char_length(trim(p_reason)), 0) < 5 then
    perform private.fail('reason_required');
  end if;
  select * into ph from public.product_photos where id = p_photo_id for update;
  if not found or ph.state <> 'pending' then
    perform private.fail('photo_not_found');
  end if;
  update public.product_photos
  set state = 'rejected', rejection_reason = trim(p_reason),
      decided_by = (select auth.uid()), decided_at = clock_timestamp()
  where id = ph.id;
  perform private.emit('product.photo_rejected',
    jsonb_build_object('product_id', ph.product_id, 'photo_id', ph.id));
end;
$$;

-- Decides a published listing's photo change as a whole. Approving applies it
-- (new photos still appear only once their files are published); rejecting
-- refuses the added photos with the reason and puts everything back.
create or replace function public.ops_review_photo_change(
  p_product_id uuid, p_revision text, p_approve boolean, p_reason text default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  p public.products%rowtype;
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  if not p_approve and coalesce(char_length(trim(p_reason)), 0) < 5 then
    perform private.fail('reason_required');
  end if;
  select * into p from public.products where id = p_product_id for update;
  if not found or p.status <> 'active' or not private.photo_change_waiting(p.id) then
    perform private.fail('photo_change_not_found');
  end if;
  if p_revision is distinct from private.photo_revision(p.id) then
    perform private.fail('photos_changed');
  end if;

  if p_approve then
    perform private.approve_photo_set(p.id);
  else
    update public.product_photos
    set state = 'rejected', rejection_reason = trim(p_reason),
        decided_by = (select auth.uid()), decided_at = clock_timestamp()
    where product_id = p.id and state = 'pending';
    update public.product_photos
    set remove_requested_at = null, position = live_position, alt = live_alt
    where product_id = p.id and state = 'approved' and live_position is not null;
  end if;

  perform private.emit('product.photos_reviewed',
    jsonb_build_object('product_id', p.id, 'approved', p_approve));
end;
$$;

-- Publishing a listing approves its photos with it. (Same function as before
-- otherwise; rejecting a listing leaves its photos waiting with it.)
create or replace function public.ops_review_product(
  p_product_id uuid,
  p_approve boolean,
  p_reason text default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  if not p_approve and coalesce(char_length(trim(p_reason)), 0) < 5 then
    -- The seller is owed an explanation they can act on.
    perform private.fail('reason_required');
  end if;

  update public.products
  set status = case when p_approve then 'active' else 'rejected' end::public.product_status,
      rejection_reason = case when p_approve then null else trim(p_reason) end
  where id = p_product_id and status in ('pending_review', 'active', 'rejected');
  if not found then
    perform private.fail('product_not_reviewable');
  end if;

  if p_approve then
    perform private.approve_photo_set(p_product_id);
  end if;

  perform private.emit('product.reviewed',
    jsonb_build_object('product_id', p_product_id, 'approved', p_approve));
end;
$$;

-- The files to copy into the public bucket: approved photos not yet published.
create or replace function public.ops_photo_files_to_publish(p_product_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'photo_id', ph.id,
      'format', ph.format,
      'width', ph.width,
      'height', ph.height,
      -- The copy staff looked at; the public sizes are made from it.
      'source', private.photo_path(ph.seller_id, ph.product_id, ph.id, 1600, ph.format),
      'paths', (select jsonb_agg(private.photo_path(ph.seller_id, ph.product_id, ph.id, s, ph.format) order by s)
                from unnest(private.photo_sizes()) s)
    ) order by ph.live_position, ph.id)
    from public.product_photos ph
    where ph.product_id = p_product_id and ph.state = 'approved' and ph.published_at is null
  ), '[]'::jsonb);
end;
$$;

-- After the copy: every approved photo whose files are all in the public
-- bucket is published and the shop starts showing it. Answers how many are
-- now published and how many still wait for their files.
create or replace function public.ops_confirm_photos_published(p_product_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_published integer;
  v_waiting integer;
  v_refused integer;
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;

  -- The public copies were made from the waiting files read after approval.
  -- If any of them was uploaded again since the photo was finished, what was
  -- read may not be what staff saw: refuse the photo rather than publish it.
  update public.product_photos ph
  set state = 'rejected', rejection_reason = 'Los archivos de esta foto cambiaron después de subirla, así que no la publicamos. Súbala de nuevo desde su teléfono o computadora.',
      live_position = null, decided_by = (select auth.uid()), decided_at = clock_timestamp()
  where ph.product_id = p_product_id and ph.state = 'approved' and ph.published_at is null
    and not private.photo_files_intact(ph);
  get diagnostics v_refused = row_count;

  update public.product_photos ph
  set published_at = clock_timestamp()
  where ph.product_id = p_product_id and ph.state = 'approved' and ph.published_at is null
    and not exists (
      select 1 from unnest(private.photo_sizes()) s
      where not exists (
        select 1 from storage.objects o
        where o.bucket_id = 'product-photos'
          and o.name = private.photo_path(ph.seller_id, ph.product_id, ph.id, s, ph.format)));
  get diagnostics v_published = row_count;

  select count(*) into v_waiting from public.product_photos
  where product_id = p_product_id and state = 'approved' and published_at is null;

  perform private.sync_product_images(p_product_id);
  return jsonb_build_object('published', v_published, 'waiting', v_waiting, 'refused', v_refused);
end;
$$;

-- Files the caller may delete because nothing needs them any more: for a
-- listing (its shop's members, or catalogue staff), or everywhere (catalogue
-- staff only). At most 200 at a time; deleting them and asking again
-- continues.
create or replace function public.photo_files_to_delete(p_product_id uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_seller uuid;
  v_staff boolean := private.has_staff_role('catalog');
begin
  if p_product_id is null then
    if not private.has_staff_role('catalog') then
      perform private.fail('forbidden');
    end if;
  else
    select created_by_seller_id into v_seller from public.products where id = p_product_id;
    if v_seller is null
       or not (private.is_seller_member(v_seller) or private.has_staff_role('catalog')) then
      perform private.fail('listing_not_found');
    end if;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object('bucket', x.bucket_id, 'path', x.name)
                     order by x.bucket_id, x.name)
    from (
      select o.bucket_id, o.name
      from storage.objects o
      where o.bucket_id in ('product-photos-pending', 'product-photos')
        -- A shop deletes only its waiting files; public copies are for staff.
        and (v_staff or o.bucket_id = 'product-photos-pending')
        and (p_product_id is null
             or (split_part(o.name, '/', 1) = v_seller::text
                 and split_part(o.name, '/', 2) = p_product_id::text))
        and private.photo_object_disposable(o.bucket_id, o.name, o.created_at)
      order by o.bucket_id, o.name
      limit 200
    ) x
  ), '[]'::jsonb);
end;
$$;

-- A listing's photos as catalogue staff look them up to take one down: what
-- the shop shows, and what waits. Found by the listing's short name (slug).
create or replace function public.ops_product_photos(p_slug text) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  p public.products%rowtype;
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  select * into p from public.products where slug = lower(trim(p_slug));
  if not found or p.created_by_seller_id is null then
    perform private.fail('catalog_product_not_found');
  end if;
  return jsonb_build_object(
    'product_id', p.id,
    'slug', p.slug,
    'title', p.title,
    'status', p.status,
    'seller_name', (select s.trade_name from public.sellers s where s.id = p.created_by_seller_id),
    'photos', coalesce((
      select jsonb_agg(private.photo_json(ph)
                       order by ph.live_position nulls last, ph.position, ph.created_at, ph.id)
      from public.product_photos ph
      where ph.product_id = p.id and ph.state in ('pending', 'approved')), '[]'::jsonb));
end;
$$;

-- Takes a photo down at once, whatever its state: approved and public, waiting
-- to be published, or waiting for review. For content that must not be shown
-- (someone else's work, offensive, personal data). The seller reads the
-- reason; the shop and order history stop showing it, and the console then
-- deletes its files from both buckets.
create or replace function public.ops_remove_photo(p_photo_id uuid, p_reason text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  ph public.product_photos;
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  if coalesce(char_length(trim(p_reason)), 0) < 5 then
    perform private.fail('reason_required');
  end if;
  select * into ph from public.product_photos where id = p_photo_id;
  if not found or ph.state not in ('uploading', 'pending', 'approved') then
    perform private.fail('photo_not_found');
  end if;
  -- The listing first, as everywhere else, then the photo.
  perform 1 from public.products where id = ph.product_id for update;
  select * into ph from public.product_photos where id = p_photo_id for update;

  update public.product_photos
  set state = 'rejected', rejection_reason = trim(p_reason), live_position = null,
      remove_requested_at = null, decided_by = (select auth.uid()), decided_at = clock_timestamp()
  where id = ph.id;
  -- Past orders kept the photo's address; they show the placeholder instead.
  update public.order_items
  set image_path = null
  where image_path = private.photo_template(ph.seller_id, ph.product_id, ph.id, ph.format);
  perform private.sync_product_images(ph.product_id);

  perform private.emit('product.photo_taken_down',
    jsonb_build_object('product_id', ph.product_id, 'photo_id', ph.id));
  return jsonb_build_object('product_id', ph.product_id, 'photo_id', ph.id,
                            'was_public', ph.published_at is not null);
end;
$$;

-- ═══ Deleting an account ═══════════════════════════════════════════════════
-- delete_my_account (20261121082500_account_security.sql) refuses while the
-- person is the last one in charge of an open shop, and closes a shop they
-- leave with nobody in charge. That was written before photos existed; the
-- closing now also takes the shop's photos out of the review queue and the
-- shop. The same function as in 082500 otherwise; keep the two in step.
create or replace function private.close_abandoned_shop(p_seller_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_product uuid;
begin
  update public.sellers s set status = 'closed' where s.id = p_seller_id and s.status <> 'closed';
  delete from public.payout_detail_requests r where r.seller_id = p_seller_id;
  -- The shop's photos (this file): nothing it left waiting for review goes on,
  -- and what it published goes too, unless another shop still sells that
  -- listing, which keeps its pictures. Removed photos' files become
  -- disposable; the console deletes them through the storage API (no
  -- database function can), keeping the public copy of any photo a past order
  -- still shows. Their descriptions go: they may describe the person.
  for v_product in
    update public.product_photos ph
    set state = 'removed', live_position = null, remove_requested_at = null,
        alt = null, live_alt = null
    where ph.seller_id = p_seller_id
      and ph.state in ('uploading', 'pending', 'approved')
      and not (ph.state = 'approved' and ph.published_at is not null
               and exists (select 1 from public.offers o
                           join public.skus k on k.id = o.sku_id
                           where k.product_id = ph.product_id and o.seller_id <> p_seller_id
                             and o.status = 'active'))
    returning ph.product_id
  loop
    perform private.sync_product_images(v_product);
  end loop;
  if not exists (select 1 from public.order_items i where i.seller_id = p_seller_id)
     and not exists (select 1 from public.payouts po where po.seller_id = p_seller_id)
     and not exists (select 1 from public.ledger_entries e
                     join public.ledger_accounts a on a.id = e.account_id
                     where a.seller_id = p_seller_id) then
    delete from public.seller_private sp where sp.seller_id = p_seller_id;
  else
    update public.seller_private sp
    set contact_email = p_seller_id::text || '@tienda-cerrada.invalid',
        contact_phone = '+50620000000',
        fiscal_address = 'Eliminada junto con la cuenta.',
        postal_code = null, payout_iban = null, payout_holder_name = null,
        sinpe_movil_number = null, kyc_notes = null
    where sp.seller_id = p_seller_id;
  end if;
end;
$$;

-- ═══ Grants ════════════════════════════════════════════════════════════════

grant execute on function
  public.seller_photos(uuid),
  public.seller_reserve_photo(uuid, text),
  public.seller_finish_photo(uuid, text, integer, integer),
  public.seller_save_photos(uuid, jsonb),
  public.seller_remove_photo(uuid),
  public.seller_withdraw_photo_changes(uuid),
  public.ops_photos_for_review(),
  public.ops_reject_photo(uuid, text),
  public.ops_review_photo_change(uuid, text, boolean, text),
  public.ops_photo_files_to_publish(uuid),
  public.ops_confirm_photos_published(uuid),
  public.photo_files_to_delete(uuid),
  public.ops_product_photos(text),
  public.ops_remove_photo(uuid, text)
to authenticated;
