-- Notifications: turning recorded events into messages people receive.
--
-- The business functions already write an event to private.outbox_events in
-- the same transaction as each change. This migration adds what delivers them
-- (docs/research/notifications-email-whatsapp-push.md, sections 6 to 8, and
-- docs/06-operations/notifications.md):
--
--   1. Routing. Each consumer of events (this one is 'notify'; e-invoicing and
--      gateway refunds can add their own) gets its own job row per event,
--      written by a trigger in the event's transaction.
--   2. Planning. private.notify_plan turns each pending 'notify' job into one
--      planned message per recipient and channel, exactly once, and marks the
--      job done in the same transaction.
--   3. Claiming. A worker outside the database (packages/notifications, run as
--      a Supabase Edge Function) claims due messages with a lease, sends them,
--      and reports back. Retries back off; a message that cannot be sent ends
--      as a dead letter that staff can see and retry.
--   4. Delivery reports from the provider's webhooks, a suppression list,
--      people's channel preferences, a separate and recorded consent for
--      commercial messages, and mobile push tokens.
--
-- The queue stores ids, never addresses or message text: the address and the
-- variables are read when a message is claimed, so an opt-out or a corrected
-- address between the event and the send is honoured. The exact request sent
-- to the provider is kept only while a retry may need to resend it, and is
-- cleared as soon as the message reaches a final state.
--
-- Who may call what:
--   * the worker functions (public.worker_*) only the server-side worker,
--     identified as the `service_role` (a Supabase secret key; in the local
--     stand-in, its local secret key). Each checks this itself as well;
--   * people read and change their own preferences and push tokens;
--   * staff with the support role (care) or admin read an order's messages,
--     the dead letters, and retry one. They see who, which channel, which
--     template and the status, never the message body or the address.

-- ═══ 1. Routing events to consumers ════════════════════════════════════════

create table private.outbox_routes (
  topic text not null,
  consumer text not null,
  primary key (topic, consumer)
);

create table private.outbox_jobs (
  event_id bigint not null references private.outbox_events (id) on delete cascade,
  consumer text not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'dead')),
  attempts smallint not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  primary key (event_id, consumer)
);

create index outbox_jobs_pending_idx on private.outbox_jobs (consumer, event_id)
  where status = 'pending';

create or replace function private.route_outbox_event() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into private.outbox_jobs (event_id, consumer)
  select new.id, r.consumer from private.outbox_routes r where r.topic = new.topic;
  return new;
end;
$$;

create trigger outbox_events_route after insert on private.outbox_events
  for each row execute function private.route_outbox_event();

-- The topics this consumer turns into messages (section 8 of the research note).
insert into private.outbox_routes (topic, consumer) values
  ('order.placed', 'notify'),
  ('payment.captured', 'notify'),
  ('order.released', 'notify'),
  ('order.cancelled', 'notify'),
  ('refund.requested', 'notify'),
  ('refund.completed', 'notify'),
  ('shipment.scheduled', 'notify'),
  ('shipment.out_for_delivery', 'notify'),
  ('shipment.delivered', 'notify'),
  ('shipment.delivery_failed', 'notify'),
  ('return.requested', 'notify'),
  ('return.decided', 'notify'),
  ('complaint.filed', 'notify'),
  ('complaint.answered', 'notify'),
  ('content.reported', 'notify'),
  ('report.resolved', 'notify'),
  ('product.reviewed', 'notify'),
  ('seller.status_changed', 'notify'),
  ('route.assigned', 'notify');

-- ═══ 2. Events nothing emitted yet (section 0.3) ═══════════════════════════
-- Emitted by triggers on the rows that change, rather than by redefining the
-- functions that change them: whichever function moves a shipment or a
-- payment, the event follows, in the same transaction.

create or replace function private.emit_logistics_events() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'route_stops' then
    -- A parcel was planned on a route: the shopper is told the day it arrives.
    perform private.emit('shipment.scheduled',
      jsonb_build_object('shipment_id', new.shipment_id, 'route_id', new.route_id));
  elsif tg_table_name = 'shipments' then
    if new.status = 'out_for_delivery' and old.status is distinct from 'out_for_delivery' then
      perform private.emit('shipment.out_for_delivery', jsonb_build_object(
        'shipment_id', new.id,
        'route_id', (select rs.route_id from public.route_stops rs
                     where rs.shipment_id = new.id and rs.status in ('pending', 'arrived')
                     order by rs.id limit 1)));
    end if;
  elsif tg_table_name = 'routes' then
    if new.driver_id is not null
       and (tg_op = 'INSERT' or new.driver_id is distinct from old.driver_id) then
      perform private.emit('route.assigned',
        jsonb_build_object('route_id', new.id, 'driver_id', new.driver_id));
    end if;
  elsif tg_table_name = 'payments' then
    -- The refund is complete when the payment is marked refunded: at once in
    -- sandbox mode, and when the gateway confirms it once a gateway is connected.
    if new.status = 'refunded' and old.status is distinct from 'refunded' then
      perform private.emit('refund.completed',
        jsonb_build_object('order_id', new.order_id, 'amount_minor', new.amount_minor));
    end if;
  end if;
  return new;
end;
$$;

create trigger route_stops_emit_scheduled after insert on public.route_stops
  for each row execute function private.emit_logistics_events();
create trigger shipments_emit_out_for_delivery after update of status on public.shipments
  for each row execute function private.emit_logistics_events();
create trigger routes_emit_assigned after insert or update of driver_id on public.routes
  for each row execute function private.emit_logistics_events();
create trigger payments_emit_refunded after update of status on public.payments
  for each row execute function private.emit_logistics_events();

-- ═══ 3. Preferences, consent, tokens, suppressions ═════════════════════════

-- One row per person (user_id) or per shop (seller_id). E-mail is the durable
-- receipt: order messages always go by e-mail, and the e-mail choice cannot be
-- turned off while the person has an order in progress. WhatsApp and SMS need
-- a mobile number and start off; push needs a registered phone and starts on.
create table private.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users (id) on delete cascade,
  seller_id uuid unique references public.sellers (id) on delete cascade,
  email_enabled boolean not null default true,
  whatsapp_enabled boolean not null default false,
  sms_enabled boolean not null default false,
  push_enabled boolean not null default true,
  -- The mobile number used for WhatsApp and SMS. Costa Rican mobiles only.
  phone text check (phone ~ '^\+506[5-8][0-9]{7}$'),
  -- When WhatsApp was switched on: the opt-in Meta requires, naming Yuntera.
  whatsapp_consented_at timestamptz,
  -- Commercial messages: a separate consent that starts off (Ley 8968 art. 5,
  -- Decreto 35205 art. 31, Decreto 37899 art. 200). When and how it was given
  -- is kept here and, append-only, in private.commercial_consent_log.
  commercial_opt_in boolean not null default false,
  commercial_granted_at timestamptz,
  commercial_source text,
  commercial_text_version text,
  commercial_withdrawn_at timestamptz,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  -- Counts the changes; a save names the revision its screen showed (0: none yet).
  revision bigint not null default 1,
  check ((user_id is null) <> (seller_id is null))
);

create trigger notification_preferences_updated_at before update on private.notification_preferences
  for each row execute function private.set_updated_at();

create or replace function private.bump_preferences_revision() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.revision := old.revision + 1;
  return new;
end;
$$;

create trigger notification_preferences_revision before update on private.notification_preferences
  for each row execute function private.bump_preferences_revision();

create table private.commercial_consent_log (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete cascade,
  seller_id uuid references public.sellers (id) on delete cascade,
  action text not null check (action in ('granted', 'withdrawn')),
  -- Where it was given: the screen or the provider's unsubscribe link.
  source text not null,
  text_version text,
  actor_id uuid references auth.users (id) on delete set null,
  at timestamptz not null default now(),
  check ((user_id is null) <> (seller_id is null))
);

create index commercial_consent_log_user_idx on private.commercial_consent_log (user_id, at);
create index commercial_consent_log_seller_idx on private.commercial_consent_log (seller_id, at);

-- Append-only, except that deleting an account removes that person's rows
-- (private.notify_forget_person sets yuntera.erasing_account for the length of
-- its transaction; no app role can reach this table at all).
create trigger commercial_consent_log_immutable before update or delete on private.commercial_consent_log
  for each row when (pg_trigger_depth() = 0
                     and coalesce(current_setting('yuntera.erasing_account', true), '') <> 'on')
  execute function private.forbid_change();

-- Expo push tokens, one Expo project per app (section 4.2). Bearer credentials:
-- never returned to anyone but the worker.
create table private.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  app text not null check (app in ('shop', 'seller', 'driver', 'warehouse')),
  expo_token text not null unique check (expo_token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,}\]$'),
  platform text not null check (platform in ('ios', 'android')),
  device_id text check (char_length(device_id) <= 200),
  app_version text check (char_length(app_version) <= 40),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  disabled_reason text check (disabled_reason in ('DeviceNotRegistered', 'signed_out', 'replaced'))
);

create index push_tokens_user_idx on private.push_tokens (user_id, app) where disabled_at is null;

-- Addresses the platform must not send to. Hard bounces and manual entries
-- block everything; complaints and unsubscribes block commercial messages only;
-- a WhatsApp or SMS opt-out blocks that channel for that number.
create table private.notification_suppressions (
  id bigint generated always as identity primary key,
  channel text not null check (channel in ('email', 'whatsapp', 'sms')),
  address text not null,
  reason text not null check (reason in ('hard_bounce', 'complaint', 'unsubscribe', 'opt_out', 'manual')),
  source text not null default 'provider',
  created_at timestamptz not null default now(),
  lifted_at timestamptz
);

create unique index notification_suppressions_active_idx
  on private.notification_suppressions (channel, address, reason) where lifted_at is null;

-- Shared staff mailboxes, by team. Empty until the owner sets them
-- (docs/06-operations/notifications.md); staff messages are skipped until then.
create table private.notify_mailboxes (
  team text primary key check (team in ('finance', 'ops', 'support', 'trust')),
  email text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

-- A channel the worker must stop using for a while (bad credentials, empty wallet).
create table private.notify_channel_pauses (
  channel text primary key check (channel in ('email', 'whatsapp', 'sms', 'push')),
  paused_until timestamptz not null,
  reason text not null,
  created_at timestamptz not null default now()
);

-- ═══ 4. Planned messages ═══════════════════════════════════════════════════

create table private.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id bigint references private.outbox_events (id) on delete set null,
  -- '<event id>/<template>/<recipient>/<channel>': a second plan of the same event inserts nothing.
  dedupe_key text not null unique,
  -- Messages for one order (or person, shop, team) go out in event order per channel.
  ordering_key text not null,
  sequence bigint not null,
  channel text not null check (channel in ('email', 'whatsapp', 'sms', 'push')),
  category text not null default 'transactional'
    check (category in ('transactional', 'marketing', 'authentication')),
  template text not null check (template ~ '^[a-z][a-z0-9_]{2,60}$'),
  locale text not null default 'es-CR',
  -- Who: 'user:<id>', 'seller:<id>', 'team:<name>' or 'report:<id>' (a visitor who reported content).
  recipient text not null,
  recipient_user_id uuid references auth.users (id) on delete cascade,
  recipient_seller_id uuid references public.sellers (id) on delete cascade,
  -- For staff screens: 'shopper', 'seller', 'driver', 'staff', 'reporter'.
  audience text not null,
  push_app text check (push_app in ('shop', 'seller', 'driver', 'warehouse')),
  context jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'delivered', 'failed', 'skipped', 'expired', 'dead')),
  attempts smallint not null default 0,
  max_attempts smallint not null default 10,
  -- Times the send was held back for an account problem (wallet, quota) without spending an attempt.
  holds smallint not null default 0,
  available_at timestamptz not null default now(),
  expires_at timestamptz,
  locked_by text,
  locked_until timestamptz,
  -- Part of the provider's idempotency key. Bumped when a request was refused
  -- and must be retried as a new request, and when staff retry a dead letter.
  generation smallint not null default 0,
  -- Exact bytes of the provider request for this generation, kept while a
  -- retry may need to resend them, cleared at a final state.
  request_body text,
  provider text,
  provider_message_id text,
  -- Expo tickets, each "<ticket id> <token>" so a receipt can disable a dead token.
  push_ticket_ids text[],
  -- The latest status reported by the provider, kept even while a send is
  -- still being recorded.
  provider_status text,
  receipts_checked_at timestamptz,
  skip_reason text,
  last_error_code text,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  last_event_at timestamptz,
  retried_by uuid references auth.users (id) on delete set null
);

create index notification_due_idx on private.notification_deliveries (available_at)
  where status in ('pending', 'sending');
create index notification_order_idx on private.notification_deliveries (ordering_key, channel, sequence);
create index notification_provider_idx on private.notification_deliveries (provider, provider_message_id)
  where provider_message_id is not null;
create index notification_dead_idx on private.notification_deliveries (created_at desc) where status = 'dead';
create index notification_order_ctx_idx on private.notification_deliveries ((context ->> 'order_id'));

-- Webhook deliveries already applied (the provider delivers at least once).
create table private.notify_webhook_events (
  webhook_id text primary key check (char_length(webhook_id) between 1 and 200),
  received_at timestamptz not null default now()
);

-- Every table: row-level security on, no policies, no grants. Only the
-- functions below reach these rows.
alter table private.outbox_routes enable row level security;
alter table private.outbox_jobs enable row level security;
alter table private.notification_preferences enable row level security;
alter table private.commercial_consent_log enable row level security;
alter table private.push_tokens enable row level security;
alter table private.notification_suppressions enable row level security;
alter table private.notify_mailboxes enable row level security;
alter table private.notify_channel_pauses enable row level security;
alter table private.notification_deliveries enable row level security;
alter table private.notify_webhook_events enable row level security;

-- ═══ 5. Helpers ════════════════════════════════════════════════════════════

-- The server-side worker. On Supabase a secret key (or the legacy service_role
-- key) makes the request run as the service_role, and the request's claims say
-- so; the local stand-in does the same for its local secret key. An ordinary
-- signed-in person or a visitor is never this caller.
create or replace function private.is_worker() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt()) ->> 'role', '') = 'service_role';
$$;

create or replace function private.require_worker() returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.is_worker() then
    perform private.fail('worker_only');
  end if;
end;
$$;

-- Orders still in progress: their messages are the shopper's receipt.
create or replace function private.has_open_order(p_user_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.orders o
    where o.user_id = p_user_id
      and o.status not in ('delivered', 'completed', 'cancelled', 'refunded'));
$$;

create or replace function private.notify_suppressed(p_channel text, p_address text, p_category text)
returns text
language sql stable security definer
set search_path = ''
as $$
  select s.reason from private.notification_suppressions s
  where s.channel = p_channel and s.address = lower(p_address) and s.lifted_at is null
    and (s.reason in ('hard_bounce', 'manual', 'opt_out') or p_category = 'marketing')
  order by s.id limit 1;
$$;

-- Commercial messages need a recorded, unwithdrawn consent, checked when the
-- message is planned and again when it is claimed.
create or replace function private.commercial_allowed(p_user_id uuid, p_seller_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select p.commercial_opt_in and p.commercial_granted_at is not null
           and (p.commercial_withdrawn_at is null or p.commercial_withdrawn_at < p.commercial_granted_at)
    from private.notification_preferences p
    where (p_user_id is not null and p.user_id = p_user_id)
       or (p_seller_id is not null and p.seller_id = p_seller_id)
    limit 1), false)
  and (p_user_id is null or exists (
    select 1 from public.consents c
    where c.user_id = p_user_id and c.purpose = 'marketing' and c.revoked_at is null));
$$;

-- Adds one planned message. Duplicates (the same event, template, recipient
-- and channel) are ignored, which is what makes planning safe to repeat.
create or replace function private.notify_add(
  p_event_id bigint,
  p_template text,
  p_channel text,
  p_recipient text,
  p_audience text,
  p_ordering_key text,
  p_context jsonb,
  p_user_id uuid default null,
  p_seller_id uuid default null,
  p_push_app text default null,
  p_expires_at timestamptz default null,
  p_category text default 'transactional'
) returns void
language sql security definer
set search_path = ''
as $$
  insert into private.notification_deliveries
    (event_id, dedupe_key, ordering_key, sequence, channel, category, template, recipient,
     recipient_user_id, recipient_seller_id, audience, push_app, context, expires_at)
  select p_event_id,
         p_event_id || '/' || p_template || '/' || p_recipient || '/' || p_channel,
         p_ordering_key, p_event_id, p_channel, p_category, p_template, p_recipient,
         p_user_id, p_seller_id, p_audience, p_push_app, p_context, p_expires_at
  where p_category <> 'marketing' or private.commercial_allowed(p_user_id, p_seller_id)
  on conflict (dedupe_key) do nothing;
$$;

-- A person: e-mail always planned (the claim decides), push when they have a
-- live token for the app, WhatsApp when asked for and they opted in, SMS only
-- when asked for and neither push nor WhatsApp can reach them.
-- p_channels: any of 'email', 'push', 'whatsapp', 'sms'.
create or replace function private.notify_person(
  p_event_id bigint,
  p_template text,
  p_user_id uuid,
  p_channels text[],
  p_ordering_key text,
  p_context jsonb,
  p_audience text default 'shopper',
  p_app text default 'shop',
  p_expires_at timestamptz default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_pref private.notification_preferences;
  v_push boolean := false;
  v_whatsapp boolean := false;
  v_recipient text := 'user:' || p_user_id;
begin
  if p_user_id is null then
    return;
  end if;
  select * into v_pref from private.notification_preferences where user_id = p_user_id;

  if 'email' = any (p_channels) then
    perform private.notify_add(p_event_id, p_template, 'email', v_recipient, p_audience,
      p_ordering_key, p_context, p_user_id, null, null, p_expires_at);
  end if;
  if 'push' = any (p_channels) and coalesce(v_pref.push_enabled, true) and exists (
    select 1 from private.push_tokens t
    where t.user_id = p_user_id and t.app = p_app and t.disabled_at is null) then
    v_push := true;
    perform private.notify_add(p_event_id, p_template, 'push', v_recipient, p_audience,
      p_ordering_key, p_context, p_user_id, null, p_app, p_expires_at);
  end if;
  if 'whatsapp' = any (p_channels) and coalesce(v_pref.whatsapp_enabled, false)
     and v_pref.phone is not null and v_pref.whatsapp_consented_at is not null then
    v_whatsapp := true;
    perform private.notify_add(p_event_id, p_template, 'whatsapp', v_recipient, p_audience,
      p_ordering_key, p_context, p_user_id, null, null, p_expires_at);
  end if;
  if 'sms' = any (p_channels) and not v_push and not v_whatsapp
     and coalesce(v_pref.sms_enabled, false) and v_pref.phone is not null then
    perform private.notify_add(p_event_id, p_template, 'sms', v_recipient, p_audience,
      p_ordering_key, p_context, p_user_id, null, null, p_expires_at);
  end if;
end;
$$;

-- A shop: e-mail to its contact address; WhatsApp to the number the shop gave;
-- push to the seller app of its owners and admins.
create or replace function private.notify_shop(
  p_event_id bigint,
  p_template text,
  p_seller_id uuid,
  p_channels text[],
  p_ordering_key text,
  p_context jsonb
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_pref private.notification_preferences;
  v_recipient text := 'seller:' || p_seller_id;
begin
  if p_seller_id is null then
    return;
  end if;
  select * into v_pref from private.notification_preferences where seller_id = p_seller_id;
  if 'email' = any (p_channels) then
    perform private.notify_add(p_event_id, p_template, 'email', v_recipient, 'seller',
      p_ordering_key, p_context, null, p_seller_id);
  end if;
  if 'whatsapp' = any (p_channels) and coalesce(v_pref.whatsapp_enabled, false)
     and v_pref.phone is not null and v_pref.whatsapp_consented_at is not null then
    perform private.notify_add(p_event_id, p_template, 'whatsapp', v_recipient, 'seller',
      p_ordering_key, p_context, null, p_seller_id);
  end if;
  if 'push' = any (p_channels) and coalesce(v_pref.push_enabled, true) and exists (
    select 1 from private.push_tokens t
    join public.seller_members m on m.user_id = t.user_id
    where m.seller_id = p_seller_id and m.role in ('owner', 'admin')
      and t.app = 'seller' and t.disabled_at is null) then
    perform private.notify_add(p_event_id, p_template, 'push', v_recipient, 'seller',
      p_ordering_key, p_context, null, p_seller_id, 'seller');
  end if;
end;
$$;

create or replace function private.notify_team(
  p_event_id bigint, p_template text, p_team text, p_ordering_key text, p_context jsonb
) returns void
language sql security definer
set search_path = ''
as $$
  select private.notify_add(p_event_id, p_template, 'email', 'team:' || p_team, 'staff',
    p_ordering_key, p_context);
$$;

-- ═══ 6. Planning ═══════════════════════════════════════════════════════════

-- Which messages one event produces: section 8 of the research note.
create or replace function private.notify_plan_event(p_event private.outbox_events) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id bigint := p_event.id;
  p jsonb := p_event.payload;
  v_order public.orders;
  v_ship public.shipments;
  v_key text;
  v_ctx jsonb;
  r record;
begin
  -- Most events are about an order; find it whichever id the payload carries.
  if p ? 'order_id' then
    select * into v_order from public.orders where id = (p ->> 'order_id')::uuid;
  elsif p ? 'shipment_id' then
    select * into v_ship from public.shipments where id = (p ->> 'shipment_id')::uuid;
    select * into v_order from public.orders where id = v_ship.order_id;
  elsif p ? 'return_request_id' then
    select o.* into v_order from public.return_requests rr
    join public.order_items i on i.id = rr.order_item_id
    join public.orders o on o.id = i.order_id
    where rr.id = (p ->> 'return_request_id')::uuid;
  end if;
  v_key := case when v_order.id is not null then 'order:' || v_order.id end;
  v_ctx := jsonb_strip_nulls(jsonb_build_object(
    'order_id', v_order.id,
    'shipment_id', p ->> 'shipment_id',
    'route_id', p ->> 'route_id',
    'return_request_id', p ->> 'return_request_id',
    'amount_minor', p -> 'amount_minor'));

  case p_event.topic
    when 'order.placed' then
      perform private.notify_person(v_id, 'order_placed', v_order.user_id,
        array['email', 'push', 'whatsapp'], v_key, v_ctx);
      if v_order.payment_method in ('sinpe_movil', 'bank_transfer') then
        perform private.notify_team(v_id, 'staff_payment_to_confirm', 'finance', v_key, v_ctx);
      end if;

    when 'payment.captured' then
      perform private.notify_person(v_id, 'payment_received', v_order.user_id,
        array['email', 'push'], v_key, v_ctx);

    when 'order.released' then
      for r in select distinct i.seller_id from public.order_items i where i.order_id = v_order.id
               order by i.seller_id loop
        perform private.notify_shop(v_id, 'seller_new_order', r.seller_id,
          array['email', 'whatsapp', 'push'], v_key, v_ctx || jsonb_build_object('seller_id', r.seller_id));
      end loop;

    when 'order.cancelled' then
      perform private.notify_person(v_id, 'order_cancelled', v_order.user_id,
        array['email', 'push'], v_key, v_ctx);
      for r in select distinct i.seller_id from public.order_items i where i.order_id = v_order.id
               order by i.seller_id loop
        perform private.notify_shop(v_id, 'seller_order_cancelled', r.seller_id,
          array['email', 'push'], v_key, v_ctx || jsonb_build_object('seller_id', r.seller_id));
      end loop;

    when 'refund.requested' then
      perform private.notify_person(v_id, 'refund_initiated', v_order.user_id,
        array['email'], v_key, v_ctx);

    when 'refund.completed' then
      perform private.notify_person(v_id, 'refund_completed', v_order.user_id,
        array['email', 'push'], v_key, v_ctx);

    when 'shipment.scheduled' then
      perform private.notify_person(v_id, 'shipment_scheduled', v_order.user_id,
        array['email', 'push'], v_key, v_ctx, 'shopper', 'shop', now() + interval '1 day');

    when 'shipment.out_for_delivery' then
      -- Stale "on its way" news is worse than none: it expires after four hours.
      perform private.notify_person(v_id, 'shipment_out_for_delivery', v_order.user_id,
        array['push', 'whatsapp', 'email', 'sms'], v_key, v_ctx, 'shopper', 'shop',
        now() + interval '4 hours');

    when 'shipment.delivered' then
      perform private.notify_person(v_id, 'shipment_delivered', v_order.user_id,
        array['email', 'push'], v_key, v_ctx);

    when 'shipment.delivery_failed' then
      perform private.notify_person(v_id, 'shipment_delivery_failed', v_order.user_id,
        array['push', 'whatsapp', 'email', 'sms'], v_key, v_ctx || jsonb_build_object('reason', p ->> 'reason'));
      perform private.notify_team(v_id, 'staff_delivery_failed', 'ops', v_key,
        v_ctx || jsonb_build_object('reason', p ->> 'reason'));

    when 'return.requested' then
      perform private.notify_person(v_id, 'return_received', v_order.user_id,
        array['email'], v_key, v_ctx);
      perform private.notify_team(v_id, 'staff_return_requested', 'support', v_key, v_ctx);

    when 'return.decided' then
      perform private.notify_person(v_id,
        case when (p ->> 'approved')::boolean then 'return_approved' else 'return_rejected' end,
        v_order.user_id, array['email', 'push'], v_key, v_ctx);

    when 'complaint.filed' then
      select c.user_id, c.order_id into r from public.complaints c where c.id = (p ->> 'complaint_id')::uuid;
      perform private.notify_person(v_id, 'complaint_received', r.user_id, array['email'],
        coalesce('order:' || r.order_id, 'user:' || r.user_id),
        jsonb_strip_nulls(jsonb_build_object('complaint_id', p ->> 'complaint_id', 'order_id', r.order_id)));
      perform private.notify_team(v_id, 'staff_complaint_filed', 'support',
        coalesce('order:' || r.order_id, 'user:' || r.user_id),
        jsonb_strip_nulls(jsonb_build_object('complaint_id', p ->> 'complaint_id', 'order_id', r.order_id)));

    when 'complaint.answered' then
      select c.user_id, c.order_id into r from public.complaints c where c.id = (p ->> 'complaint_id')::uuid;
      perform private.notify_person(v_id, 'complaint_answered', r.user_id, array['email'],
        coalesce('order:' || r.order_id, 'user:' || r.user_id),
        jsonb_strip_nulls(jsonb_build_object('complaint_id', p ->> 'complaint_id',
          'order_id', r.order_id, 'closed', p -> 'closed')));

    when 'content.reported' then
      perform private.notify_team(v_id, 'staff_content_reported', 'trust', 'team:trust',
        jsonb_build_object('report_id', p ->> 'report_id'));

    when 'report.resolved' then
      select cr.reporter_id, cr.reporter_email into r from public.content_reports cr
      where cr.id = (p ->> 'report_id')::uuid;
      if r.reporter_id is not null then
        perform private.notify_person(v_id, 'report_resolved', r.reporter_id, array['email'],
          'user:' || r.reporter_id,
          jsonb_build_object('report_id', p ->> 'report_id', 'actioned', p -> 'actioned'), 'reporter');
      elsif r.reporter_email is not null then
        perform private.notify_add(v_id, 'report_resolved', 'email', 'report:' || (p ->> 'report_id'),
          'reporter', 'report:' || (p ->> 'report_id'),
          jsonb_build_object('report_id', p ->> 'report_id', 'actioned', p -> 'actioned'));
      end if;

    when 'product.reviewed' then
      select pr.created_by_seller_id as seller_id into r from public.products pr
      where pr.id = (p ->> 'product_id')::uuid;
      perform private.notify_shop(v_id,
        case when (p ->> 'approved')::boolean then 'seller_listing_approved' else 'seller_listing_rejected' end,
        r.seller_id, array['email', 'push'], 'seller:' || r.seller_id,
        jsonb_build_object('product_id', p ->> 'product_id', 'seller_id', r.seller_id));

    when 'seller.status_changed' then
      perform private.notify_shop(v_id, 'seller_account_status', (p ->> 'seller_id')::uuid,
        array['email'], 'seller:' || (p ->> 'seller_id'),
        jsonb_build_object('seller_id', p ->> 'seller_id', 'status', p ->> 'status', 'note', p ->> 'note'));

    when 'route.assigned' then
      select d.user_id into r from public.drivers d where d.id = (p ->> 'driver_id')::uuid;
      perform private.notify_person(v_id, 'driver_route_assigned', r.user_id, array['push'],
        'route:' || (p ->> 'route_id'), jsonb_build_object('route_id', p ->> 'route_id'),
        'driver', 'driver');

    else
      null; -- a topic routed here without messages yet: nothing to plan
  end case;
end;
$$;

-- Plans pending events, oldest first. Pure SQL with no I/O: each event's
-- messages are inserted and its job marked done in one transaction, and a
-- second planner running at the same time skips the jobs this one holds.
create or replace function private.notify_plan(p_limit integer default 100) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select j.event_id from private.outbox_jobs j
    where j.consumer = 'notify' and j.status = 'pending'
    order by j.event_id
    limit greatest(1, least(p_limit, 1000))
    for update of j skip locked
  loop
    begin
      perform private.notify_plan_event(e) from private.outbox_events e where e.id = r.event_id;
      update private.outbox_jobs set status = 'done', done_at = now(), attempts = attempts + 1
      where event_id = r.event_id and consumer = 'notify';
    exception when others then
      -- One malformed event must not stop the others; it is kept for a look.
      update private.outbox_jobs
      set attempts = attempts + 1, last_error = left(sqlerrm, 500),
          status = case when attempts + 1 >= 5 then 'dead' else 'pending' end
      where event_id = r.event_id and consumer = 'notify';
    end;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ═══ 7. What a claimed message needs ═══════════════════════════════════════

-- The variables for the templates, read now. Never the delivery code, the
-- address, an identification number or payment details: messages point to
-- the order page instead.
create or replace function private.notify_vars(p_context jsonb) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v jsonb := '{}';
  o public.orders;
  s public.shipments;
begin
  if p_context ? 'order_id' then
    select * into o from public.orders where id = (p_context ->> 'order_id')::uuid;
    if found then
      v := v || jsonb_build_object(
        'order_number', o.order_number,
        'order_status', o.status,
        'total_minor', o.total_minor,
        'payment_method', o.payment_method,
        'paid', exists (select 1 from public.payments pm
                        where pm.order_id = o.id and pm.status in ('captured', 'refunded', 'partially_refunded')),
        'promise_earliest', o.promise_earliest,
        'promise_latest', o.promise_latest,
        'withdrawal_deadline', o.withdrawal_deadline,
        'warranty_until', o.warranty_until,
        'delivered_at', o.delivered_at,
        'cancel_reason', o.cancel_reason,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object('title', i.title, 'variant', i.variant_name,
                   'quantity', i.quantity, 'line_total_minor', i.line_total_minor) order by i.title)
          from public.order_items i where i.order_id = o.id), '[]'::jsonb));
    end if;
  end if;

  if p_context ? 'shipment_id' then
    select * into s from public.shipments where id = (p_context ->> 'shipment_id')::uuid;
    if found then
      v := v || jsonb_build_object(
        'tracking_code', s.tracking_code,
        'attempt_count', s.attempt_count,
        'cash_due_minor', (
          select rs.cod_amount_minor from public.route_stops rs
          where rs.shipment_id = s.id order by rs.sequence desc limit 1),
        'service_date', (
          select r.service_date from public.route_stops rs join public.routes r on r.id = rs.route_id
          where rs.shipment_id = s.id order by r.service_date desc limit 1),
        'failure_reason', (
          select rs.failure_reason from public.route_stops rs
          where rs.shipment_id = s.id and rs.status = 'failed' order by rs.completed_at desc nulls last limit 1));
    end if;
  end if;

  if p_context ? 'seller_id' then
    v := v || jsonb_build_object(
      'shop_name', (select sl.trade_name from public.sellers sl where sl.id = (p_context ->> 'seller_id')::uuid));
    if p_context ? 'order_id' then
      -- A shop sees its own lines only: not the shopper's total, payment or other shops' items.
      v := (v - 'total_minor' - 'payment_method' - 'paid') || (
        select jsonb_build_object('line_count', count(*), 'unit_count', coalesce(sum(i.quantity), 0),
                 'fulfillment', min(i.fulfillment::text),
                 'items', coalesce(jsonb_agg(jsonb_build_object('title', i.title, 'variant', i.variant_name,
                   'quantity', i.quantity, 'line_total_minor', i.line_total_minor) order by i.title), '[]'::jsonb))
        from public.order_items i
        where i.order_id = (p_context ->> 'order_id')::uuid and i.seller_id = (p_context ->> 'seller_id')::uuid);
    end if;
  end if;

  if p_context ? 'return_request_id' then
    v := v || coalesce((
      select jsonb_build_object('return_ref', upper(left(rr.id::text, 8)), 'return_kind', rr.kind,
               'return_quantity', rr.quantity, 'return_status', rr.status,
               'return_title', i.title, 'refund_due_on', rr.refund_due_on)
      from public.return_requests rr join public.order_items i on i.id = rr.order_item_id
      where rr.id = (p_context ->> 'return_request_id')::uuid), '{}'::jsonb);
  end if;

  if p_context ? 'complaint_id' then
    v := v || coalesce((
      select jsonb_build_object('complaint_ref', upper(left(c.id::text, 8)), 'complaint_status', c.status,
               'complaint_category', c.category, 'complaint_filed_at', c.created_at)
      from public.complaints c where c.id = (p_context ->> 'complaint_id')::uuid), '{}'::jsonb);
  end if;

  if p_context ? 'report_id' then
    v := v || coalesce((
      select jsonb_build_object('report_ref', upper(left(cr.id::text, 8)), 'target_type', cr.target_type,
               'report_reason', cr.reason, 'report_status', cr.status)
      from public.content_reports cr where cr.id = (p_context ->> 'report_id')::uuid), '{}'::jsonb);
  end if;

  if p_context ? 'product_id' then
    v := v || coalesce((
      select jsonb_build_object('product_title', pr.title, 'product_slug', pr.slug,
               'rejection_reason', pr.rejection_reason)
      from public.products pr where pr.id = (p_context ->> 'product_id')::uuid), '{}'::jsonb);
  end if;

  if p_context ? 'route_id' and not (p_context ? 'shipment_id') then
    v := v || coalesce((
      select jsonb_build_object('route_code', r.code, 'service_date', r.service_date,
               'stop_count', (select count(*) from public.route_stops rs where rs.route_id = r.id))
      from public.routes r where r.id = (p_context ->> 'route_id')::uuid), '{}'::jsonb);
  end if;

  -- What the event itself said.
  return v || (p_context - 'order_id' - 'shipment_id' - 'route_id' - 'seller_id' - 'return_request_id'
                         - 'complaint_id' - 'report_id' - 'product_id');
end;
$$;

-- The recipient's address for this channel, or the reason not to send.
create or replace function private.notify_resolve(d private.notification_deliveries) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_kind text := split_part(d.recipient, ':', 1);
  v_ref text := split_part(d.recipient, ':', 2);
  v_pref private.notification_preferences;
  v_email text;
  v_name text;
  v_phone text;
  v_tokens text[];
  v_suppressed text;
begin
  if d.category = 'marketing' and not private.commercial_allowed(d.recipient_user_id, d.recipient_seller_id) then
    return jsonb_build_object('skip', 'no_commercial_consent');
  end if;

  if v_kind = 'user' then
    select * into v_pref from private.notification_preferences where user_id = d.recipient_user_id;
    -- A deleted account (20261121082500) keeps its id with a placeholder
    -- address; nothing is sent to it.
    select u.email, split_part(trim(p.full_name), ' ', 1) into v_email, v_name
    from auth.users u left join public.profiles p on p.id = u.id
    where u.id = d.recipient_user_id and u.deleted_at is null;
    if not found then
      return jsonb_build_object('skip', 'no_recipient');
    end if;
  elsif v_kind = 'seller' then
    select * into v_pref from private.notification_preferences where seller_id = d.recipient_seller_id;
    select sp.contact_email, sl.trade_name into v_email, v_name
    from public.seller_private sp join public.sellers sl on sl.id = sp.seller_id
    where sp.seller_id = d.recipient_seller_id;
  elsif v_kind = 'team' then
    select m.email into v_email from private.notify_mailboxes m where m.team = v_ref;
  elsif v_kind = 'report' then
    select cr.reporter_email into v_email from public.content_reports cr where cr.id = v_ref::uuid;
  end if;

  if d.channel = 'email' then
    if v_email is null then
      return jsonb_build_object('skip', 'no_address');
    end if;
    -- E-mail may be switched off for anything but an order's messages.
    if v_pref.id is not null and not v_pref.email_enabled and not (d.context ? 'order_id') then
      return jsonb_build_object('skip', 'channel_off');
    end if;
    v_suppressed := private.notify_suppressed('email', v_email, d.category);
    if v_suppressed is not null then
      return jsonb_build_object('skip', 'suppressed_' || v_suppressed);
    end if;
    return jsonb_build_object('to', jsonb_build_object('channel', 'email', 'email', v_email, 'name', v_name));
  end if;

  if d.channel in ('whatsapp', 'sms') then
    v_phone := v_pref.phone;
    if v_phone is null then
      return jsonb_build_object('skip', 'no_address');
    end if;
    if (d.channel = 'whatsapp' and not (v_pref.whatsapp_enabled and v_pref.whatsapp_consented_at is not null))
       or (d.channel = 'sms' and not v_pref.sms_enabled) then
      return jsonb_build_object('skip', 'channel_off');
    end if;
    v_suppressed := private.notify_suppressed(d.channel, v_phone, d.category);
    if v_suppressed is not null then
      return jsonb_build_object('skip', 'suppressed_' || v_suppressed);
    end if;
    return jsonb_build_object('to', jsonb_build_object('channel', d.channel, 'phone', v_phone, 'name', v_name));
  end if;

  -- push
  if v_pref.id is not null and not v_pref.push_enabled then
    return jsonb_build_object('skip', 'channel_off');
  end if;
  select array_agg(t.expo_token order by t.last_seen_at desc) into v_tokens
  from private.push_tokens t
  where t.app = d.push_app and t.disabled_at is null
    and ((v_kind = 'user' and t.user_id = d.recipient_user_id)
      or (v_kind = 'seller' and t.user_id in (
            select m.user_id from public.seller_members m
            where m.seller_id = d.recipient_seller_id and m.role in ('owner', 'admin'))));
  if v_tokens is null then
    return jsonb_build_object('skip', 'no_device');
  end if;
  return jsonb_build_object('to', jsonb_build_object('channel', 'push', 'app', d.push_app,
    'tokens', to_jsonb(v_tokens[1:100]), 'name', v_name));
end;
$$;

-- ═══ 8. The worker's functions ═════════════════════════════════════════════

create or replace function public.worker_notify_plan(p_limit integer default 100) returns integer
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.require_worker();
  return private.notify_plan(p_limit);
end;
$$;

-- Claims due messages with a lease. A message waits while an older message for
-- the same order, channel and recipient is unfinished, so "on its way" cannot
-- overtake "order received". Returns each message with its resolved recipient
-- and variables; messages that must not go (opt-out, suppressed, no address)
-- are marked skipped here and not returned.
create or replace function public.worker_notify_claim(
  p_worker text,
  p_limit integer default 20,
  p_lease_seconds integer default 120
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  d private.notification_deliveries;
  v_resolved jsonb;
  v_out jsonb := '[]';
begin
  perform private.require_worker();
  if coalesce(char_length(p_worker), 0) not between 1 and 100 then
    perform private.fail('worker_only');
  end if;

  -- Stale news and workers that died with attempts used up.
  update private.notification_deliveries
  set status = 'expired', locked_by = null, locked_until = null, request_body = null
  where status in ('pending', 'sending') and expires_at < now()
    and (status = 'pending' or locked_until < now());
  update private.notification_deliveries
  set status = 'dead', locked_by = null, locked_until = null, request_body = null,
      last_error_code = coalesce(last_error_code, 'lease_expired')
  where status = 'sending' and locked_until < now() and attempts >= max_attempts;

  for d in
    with picked as materialized (
      select x.id
      from private.notification_deliveries x
      where ((x.status = 'pending' and x.available_at <= now())
          or (x.status = 'sending' and x.locked_until < now()))
        and not exists (
          select 1 from private.notify_channel_pauses cp
          where cp.channel = x.channel and cp.paused_until > now())
        and not exists (
          select 1 from private.notification_deliveries e
          where e.ordering_key = x.ordering_key and e.channel = x.channel
            and e.recipient = x.recipient
            and e.sequence < x.sequence
            and e.status in ('pending', 'sending'))
      order by x.available_at, x.sequence
      limit greatest(1, least(p_limit, 100))
      for update of x skip locked)
    update private.notification_deliveries t
    set status = 'sending', attempts = t.attempts + 1, locked_by = p_worker,
        locked_until = now() + make_interval(secs => greatest(10, least(p_lease_seconds, 600)))
    from picked where t.id = picked.id
    returning t.*
  loop
    v_resolved := private.notify_resolve(d);
    if v_resolved ? 'skip' then
      update private.notification_deliveries
      set status = 'skipped', skip_reason = v_resolved ->> 'skip', locked_by = null,
          locked_until = null, request_body = null
      where id = d.id;
      continue;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', d.id,
      'channel', d.channel,
      'category', d.category,
      'template', d.template,
      'locale', d.locale,
      'audience', d.audience,
      'generation', d.generation,
      'attempts', d.attempts,
      'request_body', d.request_body,
      'commercial_consent', d.category <> 'marketing'
        or private.commercial_allowed(d.recipient_user_id, d.recipient_seller_id),
      'to', v_resolved -> 'to',
      'vars', private.notify_vars(d.context)));
  end loop;
  return v_out;
end;
$$;

-- Keeps the exact request for this generation, so a retry resends the same
-- bytes under the same idempotency key. Returns false if the lease was lost.
create or replace function public.worker_notify_freeze(
  p_id uuid, p_worker text, p_generation integer, p_request_body text
) returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.require_worker();
  update private.notification_deliveries
  set request_body = coalesce(request_body, p_request_body)
  where id = p_id and locked_by = p_worker and status = 'sending' and generation = p_generation;
  return found;
end;
$$;

create or replace function public.worker_notify_sent(
  p_id uuid,
  p_worker text,
  p_provider text,
  p_provider_message_id text,
  p_push_ticket_ids text[] default null
) returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.require_worker();
  update private.notification_deliveries
  set status = case provider_status when 'delivered' then 'delivered' when 'read' then 'delivered'
                                    when 'failed' then 'failed' else 'sent' end,
      provider = p_provider, provider_message_id = p_provider_message_id,
      push_ticket_ids = p_push_ticket_ids, sent_at = now(),
      locked_by = null, locked_until = null, request_body = null,
      last_error_code = null, last_error = null
  where id = p_id and locked_by = p_worker and status = 'sending';
  return found;
end;
$$;

-- A failed send. p_kind:
--   'retry'     network, timeout, 5xx, 429, a request still in progress: same key, back off;
--   'account'   wallet empty or quota reached: hold 15 minutes without spending an attempt;
--   'permanent' the request itself is wrong (bad template, invalid recipient): dead now;
--   'config'    credentials or region wrong: dead now, and the channel pauses 15 minutes.
-- p_new_key: the provider kept this refusal, so the next attempt must be a new
-- request under a new key (every refused 4xx except 409 E01004 and 429).
create or replace function public.worker_notify_fail(
  p_id uuid,
  p_worker text,
  p_kind text,
  p_code text,
  p_message text,
  p_new_key boolean default false,
  p_retry_after_seconds integer default null
) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  d private.notification_deliveries;
  v_status text;
  v_wait double precision;
begin
  perform private.require_worker();
  select * into d from private.notification_deliveries
  where id = p_id and locked_by = p_worker and status = 'sending' for update;
  if not found then
    return null; -- the lease was lost; whoever holds it now decides
  end if;

  if p_kind = 'account' then
    v_status := case when d.holds >= 96 then 'dead' else 'pending' end;
    v_wait := greatest(coalesce(p_retry_after_seconds, 0), 900);
  elsif p_kind = 'retry' then
    v_status := case when d.attempts >= d.max_attempts then 'dead' else 'pending' end;
    -- 15 s, 30 s, 1, 2, 4 … 60 min, ±20 %: ten attempts fit inside the
    -- provider's three-hour idempotency window.
    v_wait := greatest(coalesce(p_retry_after_seconds, 0),
                       least(3600, 15 * power(2, greatest(d.attempts - 1, 0)))) * (0.8 + random() * 0.4);
  else
    v_status := 'dead';
    v_wait := 0;
  end if;

  update private.notification_deliveries
  set status = v_status,
      available_at = now() + make_interval(secs => v_wait),
      attempts = case when p_kind = 'account' then greatest(attempts - 1, 0) else attempts end,
      holds = holds + case when p_kind = 'account' then 1 else 0 end,
      generation = generation + case when p_new_key and v_status = 'pending' then 1 else 0 end,
      request_body = case when (p_new_key and v_status = 'pending') or v_status = 'dead' then null
                          else request_body end,
      last_error_code = left(p_code, 80), last_error = left(p_message, 300),
      locked_by = null, locked_until = null
  where id = p_id;

  if p_kind = 'config' then
    insert into private.notify_channel_pauses (channel, paused_until, reason)
    values (d.channel, now() + interval '15 minutes', left(p_code, 80))
    on conflict (channel) do update set paused_until = excluded.paused_until, reason = excluded.reason,
      created_at = now();
  end if;
  return v_status;
end;
$$;

-- Holds a claimed message back without spending an attempt (quiet hours).
create or replace function public.worker_notify_defer(
  p_id uuid, p_worker text, p_until timestamptz
) returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.require_worker();
  update private.notification_deliveries
  set status = 'pending', attempts = greatest(attempts - 1, 0),
      available_at = least(greatest(p_until, now()), now() + interval '12 hours'),
      locked_by = null, locked_until = null
  where id = p_id and locked_by = p_worker and status = 'sending';
  return found;
end;
$$;

create or replace function public.worker_notify_skip(p_id uuid, p_worker text, p_reason text)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.require_worker();
  update private.notification_deliveries
  set status = 'skipped', skip_reason = left(p_reason, 80), locked_by = null, locked_until = null,
      request_body = null
  where id = p_id and locked_by = p_worker and status = 'sending';
  return found;
end;
$$;

-- Push tokens Expo reported as no longer registered, or that a send found dead.
create or replace function public.worker_push_disable(p_tokens text[], p_reason text) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform private.require_worker();
  update private.push_tokens
  set disabled_at = now(), disabled_reason = 'DeviceNotRegistered'
  where expo_token = any (p_tokens) and disabled_at is null and p_reason = 'DeviceNotRegistered';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Push messages whose receipts are due (Expo keeps them 24 hours; check after 15 minutes).
create or replace function public.worker_push_receipts_due(
  p_limit integer default 100, p_older_than_seconds integer default 900
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform private.require_worker();
  with due as (
    select d.id from private.notification_deliveries d
    where d.channel = 'push' and d.status = 'sent' and d.receipts_checked_at is null
      and d.push_ticket_ids is not null
      and d.sent_at < now() - make_interval(secs => greatest(p_older_than_seconds, 0))
      and d.sent_at > now() - interval '23 hours'
    order by d.sent_at limit greatest(1, least(p_limit, 1000))
    for update skip locked),
  marked as (
    update private.notification_deliveries t set receipts_checked_at = now()
    from due where t.id = due.id
    returning t.id, t.push_ticket_ids)
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'ticket_ids', to_jsonb(m.push_ticket_ids))), '[]')
  into v from marked m;
  return v;
end;
$$;

-- Withdraws commercial consent, from a screen or from a provider's unsubscribe.
create or replace function private.withdraw_commercial(
  p_user_id uuid, p_seller_id uuid, p_source text, p_actor uuid
) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  update private.notification_preferences
  set commercial_opt_in = false, commercial_withdrawn_at = now(), updated_by = p_actor
  where ((p_user_id is not null and user_id = p_user_id) or (p_seller_id is not null and seller_id = p_seller_id))
    and commercial_opt_in;
  if found then
    insert into private.commercial_consent_log (user_id, seller_id, action, source, actor_id)
    values (p_user_id, p_seller_id, 'withdrawn', p_source, p_actor);
  end if;
  if p_user_id is not null then
    update public.consents set revoked_at = now()
    where user_id = p_user_id and purpose = 'marketing' and revoked_at is null;
    update public.profiles set marketing_opt_in = false where id = p_user_id and marketing_opt_in;
  end if;
end;
$$;

-- Applies a delivery report from a provider (webhook or push receipt).
-- p_update: {provider, provider_message_id, delivery_id, channel, status, occurred_at,
--            reason, permanent, recipient_address}
-- status: sent | delivered | read | bounced | failed | rejected | complained | unsubscribed
--         | opted_out | opted_in. p_update.generation, when the provider echoes it, must
-- be the message's current generation.
-- Reports arrive out of order and more than once: a report older than the last
-- one applied never moves a message backwards, and a webhook id is applied once.
create or replace function public.worker_notify_apply_update(p_update jsonb, p_webhook_id text default null)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  d private.notification_deliveries;
  v_status text := p_update ->> 'status';
  v_at timestamptz := coalesce((p_update ->> 'occurred_at')::timestamptz, now());
  v_address text := lower(nullif(trim(p_update ->> 'recipient_address'), ''));
  v_channel text := p_update ->> 'channel';
  v_rank_new integer;
  v_rank_old integer;
  v_user uuid;
  v_delivery uuid := case when p_update ->> 'delivery_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                          then (p_update ->> 'delivery_id')::uuid end;
begin
  perform private.require_worker();
  if p_webhook_id is not null then
    insert into private.notify_webhook_events (webhook_id) values (p_webhook_id)
    on conflict do nothing;
    if not found then
      return 'duplicate';
    end if;
  end if;

  -- Address-level reports: suppression and consent, whatever message they concern.
  if v_address is not null then
    if v_status = 'bounced' and coalesce((p_update ->> 'permanent')::boolean, false) then
      insert into private.notification_suppressions (channel, address, reason)
      values ('email', v_address, 'hard_bounce') on conflict do nothing;
    elsif v_status = 'complained' then
      insert into private.notification_suppressions (channel, address, reason)
      values ('email', v_address, 'complaint') on conflict do nothing;
    elsif v_status = 'unsubscribed' then
      insert into private.notification_suppressions (channel, address, reason)
      values ('email', v_address, 'unsubscribe') on conflict do nothing;
      for v_user in select u.id from auth.users u where lower(u.email) = v_address loop
        perform private.withdraw_commercial(v_user, null, 'provider_unsubscribe', null);
      end loop;
    elsif v_status = 'opted_out' and v_channel in ('whatsapp', 'sms') then
      insert into private.notification_suppressions (channel, address, reason)
      values (v_channel, v_address, 'opt_out') on conflict do nothing;
      update private.notification_preferences
      set whatsapp_enabled = case when v_channel = 'whatsapp' then false else whatsapp_enabled end,
          sms_enabled = case when v_channel = 'sms' then false else sms_enabled end
      where phone = v_address;
    elsif v_status = 'opted_in' and v_channel in ('whatsapp', 'sms') then
      -- The number itself asked to receive messages again (START, or a keyword
      -- rule): the only proof that whoever lifts an opt-out holds the phone.
      -- It does not switch the channel on for anyone; the person does that.
      update private.notification_suppressions
      set lifted_at = now()
      where channel = v_channel and address = v_address and reason = 'opt_out' and lifted_at is null;
    end if;
  end if;

  select * into d from private.notification_deliveries x
  where (p_update ->> 'provider_message_id' is not null
         and (x.provider_message_id = p_update ->> 'provider_message_id'
              or (x.channel = 'push' and exists (
                    select 1 from unnest(x.push_ticket_ids) as t (ref)
                    where split_part(t.ref, ' ', 1) = p_update ->> 'provider_message_id'))))
     -- The echoed delivery id is shared by every generation of a message, so it
     -- only identifies the request when the provider's id does not disagree:
     -- the same id, or a send still being recorded (the report can arrive
     -- before the provider's answer to the send is stored).
     or (v_delivery is not null and x.id = v_delivery
         and ((x.provider_message_id is null and x.status = 'sending')
              or p_update ->> 'provider_message_id' is null
              or x.provider_message_id = p_update ->> 'provider_message_id'))
  order by x.created_at desc limit 1
  for update;
  if not found then
    return 'unknown';
  end if;
  -- A late report about an earlier request (before a retry under a new key)
  -- says nothing about the request now in flight.
  if p_update ->> 'generation' ~ '^[0-9]{1,6}$' and (p_update ->> 'generation')::integer <> d.generation then
    return 'stale';
  end if;

  v_rank_new := case v_status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3
                              when 'bounced' then 4 when 'failed' then 4 when 'rejected' then 4 else 0 end;
  if v_rank_new = 0 then
    return 'recorded';
  end if;
  v_rank_old := case coalesce(d.provider_status, '') when 'sent' then 1 when 'delivered' then 2
                  when 'read' then 3 when 'failed' then 4 else 0 end;
  -- A failure after delivery (an out-of-band bounce) counts when it is newer;
  -- anything else only moves forward.
  if d.last_event_at is not null and v_at < d.last_event_at and v_rank_new <= v_rank_old then
    return 'stale';
  end if;
  if v_rank_old = 4 and v_rank_new < 4 then
    return 'stale';
  end if;
  if v_rank_new < v_rank_old and v_rank_new <> 4 then
    return 'stale';
  end if;

  -- A temporary failure reported after the provider accepted the message (a
  -- soft bounce, an undelivered or expired WhatsApp or SMS) goes back through
  -- the ordinary retries. The provider kept the first request, so the next
  -- one is a new request under a new key. With no attempts left, or once the
  -- news is stale, it is a dead letter staff can see and retry.
  -- ('sending': the report beat the worker's record of the send; the worker's
  -- record then finds the lease gone and changes nothing.)
  if v_rank_new = 4 and d.status in ('sent', 'sending') and d.channel in ('email', 'whatsapp', 'sms')
     and p_update ->> 'permanent' = 'false' then
    update private.notification_deliveries
    set status = case when d.attempts >= d.max_attempts
                        or (d.expires_at is not null and d.expires_at <= now()) then 'dead'
                      else 'pending' end,
        generation = generation + 1,
        available_at = now() + make_interval(secs =>
          least(3600, 15 * power(2, greatest(d.attempts - 1, 0))) * (0.8 + random() * 0.4)),
        provider = null, provider_message_id = null, provider_status = null, last_event_at = null,
        sent_at = null, request_body = null, locked_by = null, locked_until = null,
        last_error_code = left(coalesce(p_update ->> 'reason', v_status), 80),
        last_error = 'The provider reported a temporary failure after accepting the message.'
    where id = d.id
    returning status into v_status;
    return case when v_status = 'dead' then 'dead' else 'requeued' end;
  end if;

  update private.notification_deliveries
  set provider_status = case when v_rank_new = 4 then 'failed' else v_status end,
      last_event_at = greatest(coalesce(last_event_at, v_at), v_at),
      delivered_at = case when v_rank_new in (2, 3) then coalesce(delivered_at, v_at) else delivered_at end,
      read_at = case when v_rank_new = 3 then coalesce(read_at, v_at) else read_at end,
      status = case
        when status in ('sent', 'delivered', 'failed') and v_rank_new in (2, 3) then 'delivered'
        when status in ('sent', 'delivered') and v_rank_new = 4 then 'failed'
        else status end,
      last_error_code = case when v_rank_new = 4 then left(coalesce(p_update ->> 'reason', v_status), 80)
                             else last_error_code end
  where id = d.id;
  return 'applied';
end;
$$;

-- ═══ 9. People: preferences, consent, devices ══════════════════════════════

-- What the settings screen was loaded with, sent back when saving: a save made
-- from a page that is out of date is refused rather than silently undoing a
-- change made since in another tab or device. 0 when nothing is saved yet.
create or replace function private.preferences_version(p private.notification_preferences) returns bigint
language sql immutable
set search_path = ''
as $$
  select coalesce(p.revision, 0);
$$;

create or replace function private.preferences_json(p private.notification_preferences) returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'version', private.preferences_version(p),
    'email_enabled', coalesce(p.email_enabled, true),
    'whatsapp_enabled', coalesce(p.whatsapp_enabled, false),
    'sms_enabled', coalesce(p.sms_enabled, false),
    'push_enabled', coalesce(p.push_enabled, true),
    'phone', p.phone,
    'whatsapp_consented_at', p.whatsapp_consented_at,
    'commercial', jsonb_build_object(
      'opt_in', coalesce(p.commercial_opt_in, false),
      'granted_at', p.commercial_granted_at,
      'source', p.commercial_source,
      'text_version', p.commercial_text_version,
      'withdrawn_at', p.commercial_withdrawn_at));
$$;

create or replace function public.my_notification_settings() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v private.notification_preferences;
begin
  if v_user is null then
    perform private.fail('not_authenticated');
  end if;
  select * into v from private.notification_preferences where user_id = v_user;
  return private.preferences_json(v) || jsonb_build_object(
    'email_locked', private.has_open_order(v_user),
    'profile_phone', (select p.phone from public.profiles p where p.id = v_user),
    'push_devices', (select count(*) from private.push_tokens t
                     where t.user_id = v_user and t.disabled_at is null));
end;
$$;

-- Shared by the shopper's and the shop's settings.
create or replace function private.save_channels(
  p_user_id uuid, p_seller_id uuid, p_email boolean, p_whatsapp boolean, p_sms boolean,
  p_push boolean, p_phone text, p_version bigint
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[\s-]', '', 'g'), '');
  v_row private.notification_preferences;
begin
  if v_phone ~ '^[5-8][0-9]{7}$' then
    v_phone := '+506' || v_phone;
  end if;
  if v_phone is not null and v_phone !~ '^\+506[5-8][0-9]{7}$' then
    perform private.fail('notify_phone_invalid');
  end if;
  if (p_whatsapp or p_sms) and v_phone is null then
    perform private.fail('notify_phone_required');
  end if;
  if not p_email and p_user_id is not null and private.has_open_order(p_user_id) then
    perform private.fail('notify_email_required');
  end if;
  if not p_email and p_seller_id is not null then
    perform private.fail('notify_email_required');
  end if;

  select * into v_row from private.notification_preferences
  where (p_user_id is not null and user_id = p_user_id) or (p_seller_id is not null and seller_id = p_seller_id)
  for update;
  if p_version is not null and p_version <> private.preferences_version(v_row) then
    perform private.fail('notify_settings_changed');
  end if;

  -- A number whose holder sent STOP stays off until a message from that
  -- phone lifts it (worker_notify_apply_update, 'opted_in'). Typing the number
  -- into a form proves nothing about who holds it, so it never lifts it.
  if v_phone is not null and exists (
    select 1 from private.notification_suppressions s
    where s.address = v_phone and s.reason = 'opt_out' and s.lifted_at is null
      and ((s.channel = 'whatsapp' and p_whatsapp) or (s.channel = 'sms' and p_sms))) then
    perform private.fail('notify_phone_opted_out');
  end if;

  insert into private.notification_preferences
    (user_id, seller_id, email_enabled, whatsapp_enabled, sms_enabled, push_enabled, phone,
     whatsapp_consented_at, updated_by)
  values (p_user_id, p_seller_id, p_email, p_whatsapp, p_sms, p_push, v_phone,
          case when p_whatsapp then now() end, (select auth.uid()))
  on conflict ((coalesce(user_id, seller_id))) do nothing;
  if not found then
    update private.notification_preferences
    set email_enabled = p_email, whatsapp_enabled = p_whatsapp, sms_enabled = p_sms,
        push_enabled = p_push,
        whatsapp_consented_at = case
          when not p_whatsapp then null
          when whatsapp_enabled and phone is not distinct from v_phone then whatsapp_consented_at
          else now() end,
        phone = v_phone, updated_by = (select auth.uid())
    where (p_user_id is not null and user_id = p_user_id) or (p_seller_id is not null and seller_id = p_seller_id);
  end if;
end;
$$;

create unique index notification_preferences_subject_idx
  on private.notification_preferences ((coalesce(user_id, seller_id)));

-- The settings screen saves channels and, when p_commercial is given, the
-- commercial consent in one transaction: all of it or nothing. p_version is
-- what the screen was loaded with (null skips the check, for other callers).
create or replace function public.set_my_notification_settings(
  p_email boolean,
  p_whatsapp boolean,
  p_sms boolean,
  p_push boolean,
  p_phone text default null,
  p_commercial boolean default null,
  p_text_version text default null,
  p_version bigint default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    perform private.fail('not_authenticated');
  end if;
  perform private.save_channels((select auth.uid()), null, p_email, p_whatsapp, p_sms, p_push, p_phone,
    p_version);
  if p_commercial is not null then
    perform private.save_commercial((select auth.uid()), null, p_commercial, p_text_version, 'web_cuenta');
  end if;
  return public.my_notification_settings();
end;
$$;

-- Records or withdraws the consent for commercial messages. Separate from the
-- channel choices, never required for anything else, effective immediately.
create or replace function private.save_commercial(
  p_user_id uuid, p_seller_id uuid, p_opt_in boolean, p_text_version text, p_source text
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_current boolean;
begin
  if p_source not in ('web_cuenta', 'seller_cuenta', 'shop_app', 'seller_app') then
    perform private.fail('notify_consent_invalid');
  end if;
  select commercial_opt_in into v_current from private.notification_preferences
  where (p_user_id is not null and user_id = p_user_id) or (p_seller_id is not null and seller_id = p_seller_id);

  if p_opt_in then
    if coalesce(char_length(p_text_version), 0) not between 3 and 40 then
      perform private.fail('notify_consent_invalid');
    end if;
    if coalesce(v_current, false) then
      return;
    end if;
    insert into private.notification_preferences (user_id, seller_id, updated_by)
    values (p_user_id, p_seller_id, (select auth.uid()))
    on conflict ((coalesce(user_id, seller_id))) do nothing;
    update private.notification_preferences
    set commercial_opt_in = true, commercial_granted_at = now(), commercial_source = p_source,
        commercial_text_version = p_text_version, updated_by = (select auth.uid())
    where (p_user_id is not null and user_id = p_user_id) or (p_seller_id is not null and seller_id = p_seller_id);
    insert into private.commercial_consent_log (user_id, seller_id, action, source, text_version, actor_id)
    values (p_user_id, p_seller_id, 'granted', p_source, p_text_version, (select auth.uid()));
    if p_user_id is not null then
      insert into public.consents (user_id, purpose, policy_version) values (p_user_id, 'marketing', p_text_version);
      update public.profiles set marketing_opt_in = true where id = p_user_id;
    end if;
  elsif coalesce(v_current, false) then
    perform private.withdraw_commercial(p_user_id, p_seller_id, p_source, (select auth.uid()));
  end if;
end;
$$;

create or replace function public.set_my_commercial_consent(
  p_opt_in boolean, p_text_version text, p_source text default 'web_cuenta'
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    perform private.fail('not_authenticated');
  end if;
  perform private.save_commercial((select auth.uid()), null, p_opt_in, p_text_version, p_source);
  return public.my_notification_settings();
end;
$$;

-- The marketing box used to live on the profile form, which saved it without a
-- consent record. It now has its own, recorded, place: the profile no longer
-- changes it (the argument is kept so existing callers do not break).
create or replace function public.update_profile(
  p_full_name text,
  p_phone text default null,
  p_locale text default 'es-CR',
  p_marketing_opt_in boolean default false
) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    perform private.fail('not_authenticated');
  end if;
  update public.profiles
  set full_name = nullif(trim(p_full_name), ''),
      phone = nullif(trim(p_phone), ''),
      locale = p_locale
  where id = (select auth.uid());
exception
  when check_violation then
    perform private.fail('invalid_profile');
end;
$$;

create or replace function public.seller_notification_settings(p_seller_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v private.notification_preferences;
begin
  if (select auth.uid()) is null then
    perform private.fail('not_authenticated');
  end if;
  if not private.is_seller_member(p_seller_id) then
    perform private.fail('seller_not_found');
  end if;
  select * into v from private.notification_preferences where seller_id = p_seller_id;
  return private.preferences_json(v) || jsonb_build_object(
    'email_locked', true,
    'contact_email', (select sp.contact_email from public.seller_private sp where sp.seller_id = p_seller_id),
    'contact_phone', (select sp.contact_phone from public.seller_private sp where sp.seller_id = p_seller_id),
    'can_edit', private.is_seller_admin(p_seller_id));
end;
$$;

-- Shops get e-mail (always), WhatsApp and push; no SMS (private.notify_shop
-- has no SMS branch), so it is stored as off.
create or replace function public.seller_set_notification_settings(
  p_seller_id uuid,
  p_whatsapp boolean,
  p_push boolean,
  p_phone text default null,
  p_commercial boolean default null,
  p_text_version text default null,
  p_version bigint default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    perform private.fail('not_authenticated');
  end if;
  if not private.is_seller_member(p_seller_id) then
    perform private.fail('seller_not_found');
  end if;
  if not private.is_seller_admin(p_seller_id) then
    perform private.fail('forbidden');
  end if;
  perform private.save_channels(null, p_seller_id, true, p_whatsapp, false, p_push, p_phone, p_version);
  if p_commercial is not null then
    perform private.save_commercial(null, p_seller_id, p_commercial, p_text_version, 'seller_cuenta');
  end if;
  return public.seller_notification_settings(p_seller_id);
end;
$$;

create or replace function public.seller_set_commercial_consent(
  p_seller_id uuid, p_opt_in boolean, p_text_version text, p_source text default 'seller_cuenta'
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    perform private.fail('not_authenticated');
  end if;
  if not private.is_seller_member(p_seller_id) then
    perform private.fail('seller_not_found');
  end if;
  if not private.is_seller_admin(p_seller_id) then
    perform private.fail('forbidden');
  end if;
  perform private.save_commercial(null, p_seller_id, p_opt_in, p_text_version, p_source);
  return public.seller_notification_settings(p_seller_id);
end;
$$;

-- The native apps call these after sign-in and at sign-out. A phone shared by
-- two accounts moves its token to whoever signed in last, but only from that
-- phone: the token must have been signed out (unregistered or found dead), or
-- the call must name the same device. Knowing someone's token is not enough
-- to take their notifications.
create or replace function public.register_push_token(
  p_app text,
  p_token text,
  p_platform text,
  p_device_id text default null,
  p_app_version text default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    perform private.fail('not_authenticated');
  end if;
  insert into private.push_tokens (user_id, app, expo_token, platform, device_id, app_version)
  values ((select auth.uid()), p_app, p_token, p_platform, p_device_id, p_app_version)
  on conflict (expo_token) do update
  set user_id = excluded.user_id, app = excluded.app, platform = excluded.platform,
      device_id = excluded.device_id, app_version = excluded.app_version,
      last_seen_at = now(), disabled_at = null, disabled_reason = null
  where private.push_tokens.user_id = excluded.user_id
     or private.push_tokens.disabled_at is not null
     or (private.push_tokens.device_id is not null
         and private.push_tokens.device_id = excluded.device_id);
  if not found then
    perform private.fail('push_token_invalid');
  end if;
exception
  when check_violation or not_null_violation then
    perform private.fail('push_token_invalid');
end;
$$;

create or replace function public.unregister_push_token(p_token text) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    perform private.fail('not_authenticated');
  end if;
  update private.push_tokens
  set disabled_at = now(), disabled_reason = 'signed_out'
  where expo_token = p_token and user_id = (select auth.uid()) and disabled_at is null;
  if not found then
    perform private.fail('push_token_not_found');
  end if;
end;
$$;

-- ═══ 10. Staff: what was sent, what is stuck ═══════════════════════════════

create or replace function private.delivery_row(d private.notification_deliveries) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', d.id,
    'template', d.template,
    'channel', d.channel,
    'audience', d.audience,
    'seller_name', (select s.trade_name from public.sellers s where s.id = d.recipient_seller_id),
    'team', case when d.recipient like 'team:%' then split_part(d.recipient, ':', 2) end,
    'status', d.status,
    'attempts', d.attempts,
    'generation', d.generation,
    'skip_reason', d.skip_reason,
    'error_code', d.last_error_code,
    'order_number', (select o.order_number from public.orders o where o.id = (d.context ->> 'order_id')::uuid),
    'created_at', d.created_at,
    'sent_at', d.sent_at,
    'delivered_at', d.delivered_at,
    'read_at', d.read_at);
$$;

create or replace function public.ops_order_notifications(p_order_number text) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_order uuid;
begin
  if not private.has_staff_role('support') then
    perform private.fail('forbidden');
  end if;
  select id into v_order from public.orders where order_number = p_order_number;
  if v_order is null then
    perform private.fail('order_not_found');
  end if;
  return coalesce((
    select jsonb_agg(private.delivery_row(d) order by d.created_at, d.sequence, d.channel)
    from private.notification_deliveries d
    where d.context ->> 'order_id' = v_order::text), '[]'::jsonb);
end;
$$;

create or replace function public.ops_notification_dead_letters(p_limit integer default 50) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('support') then
    perform private.fail('forbidden');
  end if;
  return jsonb_build_object(
    -- Dead: the worker gave up. Failed: the provider accepted the message and
    -- later reported it could not deliver it. Both reached nobody; both can be retried.
    'items', coalesce((
      select jsonb_agg(private.delivery_row(d) order by d.created_at desc)
      from (select * from private.notification_deliveries
            where status in ('dead', 'failed') order by created_at desc
            limit greatest(1, least(p_limit, 200))) d), '[]'::jsonb),
    'dead_count', (select count(*) from private.notification_deliveries where status = 'dead'),
    'failed_count', (select count(*) from private.notification_deliveries where status = 'failed'),
    'paused_channels', coalesce((
      select jsonb_agg(jsonb_build_object('channel', cp.channel, 'until', cp.paused_until, 'reason', cp.reason))
      from private.notify_channel_pauses cp where cp.paused_until > now()), '[]'::jsonb));
end;
$$;

-- Sends a dead (or failed) message again, as a new request: a new idempotency
-- key, so if the first one did in fact arrive, the person gets it twice.
create or replace function public.ops_retry_notification(p_delivery_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  d private.notification_deliveries;
  v_old_status text;
begin
  if not private.has_staff_role('support') then
    perform private.fail('forbidden');
  end if;
  select * into d from private.notification_deliveries where id = p_delivery_id for update;
  if not found then
    perform private.fail('notification_not_found');
  end if;
  if d.status not in ('dead', 'failed') then
    perform private.fail('notification_not_retryable');
  end if;
  v_old_status := d.status;
  update private.notification_deliveries
  set status = 'pending', attempts = 0, holds = 0, generation = generation + 1, available_at = now(),
      expires_at = null, request_body = null, provider_status = null, last_event_at = null,
      provider = null, provider_message_id = null, push_ticket_ids = null, receipts_checked_at = null,
      locked_by = null, locked_until = null, retried_by = (select auth.uid())
  where id = p_delivery_id
  returning * into d;
  insert into private.audit_log (actor_id, action, table_name, row_key, old_row, new_row)
  values ((select auth.uid()), 'UPDATE', 'notification_deliveries', p_delivery_id::text,
          jsonb_build_object('status', v_old_status, 'generation', d.generation - 1),
          jsonb_build_object('status', 'pending', 'generation', d.generation));
  return private.delivery_row(d);
end;
$$;

-- ═══ 11. Grants ════════════════════════════════════════════════════════════

revoke all on all tables in schema private from public, anon, authenticated;
revoke execute on function
  private.route_outbox_event(), private.emit_logistics_events(), private.is_worker(),
  private.require_worker(), private.has_open_order(uuid), private.notify_suppressed(text, text, text),
  private.commercial_allowed(uuid, uuid),
  private.notify_add(bigint, text, text, text, text, text, jsonb, uuid, uuid, text, timestamptz, text),
  private.notify_person(bigint, text, uuid, text[], text, jsonb, text, text, timestamptz),
  private.notify_shop(bigint, text, uuid, text[], text, jsonb),
  private.notify_team(bigint, text, text, text, jsonb),
  private.notify_plan_event(private.outbox_events), private.notify_plan(integer),
  private.notify_vars(jsonb), private.notify_resolve(private.notification_deliveries),
  private.withdraw_commercial(uuid, uuid, text, uuid),
  private.preferences_json(private.notification_preferences),
  private.save_channels(uuid, uuid, boolean, boolean, boolean, boolean, text, bigint),
  private.preferences_version(private.notification_preferences),
  private.bump_preferences_revision(),
  private.save_commercial(uuid, uuid, boolean, text, text),
  private.delivery_row(private.notification_deliveries)
from public, anon, authenticated;

-- The worker's functions: the server-side caller only.
revoke execute on function
  public.worker_notify_plan(integer),
  public.worker_notify_claim(text, integer, integer),
  public.worker_notify_freeze(uuid, text, integer, text),
  public.worker_notify_sent(uuid, text, text, text, text[]),
  public.worker_notify_fail(uuid, text, text, text, text, boolean, integer),
  public.worker_notify_defer(uuid, text, timestamptz),
  public.worker_notify_skip(uuid, text, text),
  public.worker_push_disable(text[], text),
  public.worker_push_receipts_due(integer, integer),
  public.worker_notify_apply_update(jsonb, text)
from public, anon, authenticated;
grant execute on function
  public.worker_notify_plan(integer),
  public.worker_notify_claim(text, integer, integer),
  public.worker_notify_freeze(uuid, text, integer, text),
  public.worker_notify_sent(uuid, text, text, text, text[]),
  public.worker_notify_fail(uuid, text, text, text, text, boolean, integer),
  public.worker_notify_defer(uuid, text, timestamptz),
  public.worker_notify_skip(uuid, text, text),
  public.worker_push_disable(text[], text),
  public.worker_push_receipts_due(integer, integer),
  public.worker_notify_apply_update(jsonb, text)
to service_role;

-- People and staff: signed-in callers, each function checks who.
revoke execute on function
  public.my_notification_settings(),
  public.set_my_notification_settings(boolean, boolean, boolean, boolean, text, boolean, text, bigint),
  public.set_my_commercial_consent(boolean, text, text),
  public.seller_notification_settings(uuid),
  public.seller_set_notification_settings(uuid, boolean, boolean, text, boolean, text, bigint),
  public.seller_set_commercial_consent(uuid, boolean, text, text),
  public.register_push_token(text, text, text, text, text),
  public.unregister_push_token(text),
  public.ops_order_notifications(text),
  public.ops_notification_dead_letters(integer),
  public.ops_retry_notification(uuid)
from public, anon, service_role;
grant execute on function
  public.my_notification_settings(),
  public.set_my_notification_settings(boolean, boolean, boolean, boolean, text, boolean, text, bigint),
  public.set_my_commercial_consent(boolean, text, text),
  public.seller_notification_settings(uuid),
  public.seller_set_notification_settings(uuid, boolean, boolean, text, boolean, text, bigint),
  public.seller_set_commercial_consent(uuid, boolean, text, text),
  public.register_push_token(text, text, text, text, text),
  public.unregister_push_token(text),
  public.ops_order_notifications(text),
  public.ops_notification_dead_letters(integer),
  public.ops_retry_notification(uuid)
to authenticated;

-- update_profile was redefined above; keep its grant.
grant execute on function public.update_profile(text, text, text, boolean) to authenticated;

-- ═══ 12. Waking the worker ═════════════════════════════════════════════════
-- On Supabase: a sweep every 30 seconds by pg_cron, and a kick by pg_net when
-- new jobs are written (sent only after the transaction commits). Both call the
-- notify-worker Edge Function with a token that can do nothing but wake it.
-- They need two Vault secrets the owner sets ('project_url' and
-- 'notify_worker_token'); until then, and on a plain PostgreSQL without these
-- extensions, they do nothing. Errors here never reach the business transaction.

create or replace function private.notify_kick() returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_url text;
  v_token text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net')
     or not exists (select 1 from pg_namespace where nspname = 'vault') then
    return;
  end if;
  execute $q$select (select decrypted_secret from vault.decrypted_secrets where name = 'project_url'),
                    (select decrypted_secret from vault.decrypted_secrets where name = 'notify_worker_token')$q$
    into v_url, v_token;
  if v_url is null or v_token is null then
    return;
  end if;
  execute $q$select net.http_post(url := $1, headers := $2, body := '{}'::jsonb, timeout_milliseconds := 5000)$q$
    using v_url || '/functions/v1/notify-worker',
          jsonb_build_object('Content-Type', 'application/json', 'x-worker-token', v_token);
exception when others then
  raise warning 'notify_kick: %', sqlerrm;
end;
$$;

create or replace function private.notify_kick_on_jobs() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.notify_kick();
  return null;
exception when others then
  return null;
end;
$$;

create trigger outbox_jobs_kick after insert on private.outbox_jobs
  for each statement execute function private.notify_kick_on_jobs();

create or replace function private.notify_sweep() returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if exists (select 1 from private.outbox_jobs where consumer = 'notify' and status = 'pending')
     or exists (select 1 from private.notification_deliveries
                where (status = 'pending' and available_at <= now())
                   or (status = 'sending' and locked_until < now())
                   or (channel = 'push' and status = 'sent' and receipts_checked_at is null
                       and sent_at < now() - interval '15 minutes')) then
    perform private.notify_kick();
  end if;
  delete from private.notify_webhook_events where received_at < now() - interval '7 days';
end;
$$;

revoke execute on function private.notify_kick(), private.notify_kick_on_jobs(), private.notify_sweep()
from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
    perform cron.schedule('notify-sweep', '30 seconds', 'select private.notify_sweep()');
    perform cron.schedule('cron-history-cleanup', '23 3 * * 0',
      $c$delete from cron.job_run_details where end_time < now() - interval '7 days'$c$);
  else
    raise notice 'pg_cron or pg_net is not available here; run the notification worker by hand or locally.';
  end if;
exception when others then
  raise notice 'Could not schedule the notification sweep: %', sqlerrm;
end
$$;

-- ═══ 13. Deleting an account ═══════════════════════════════════════════════
--
-- delete_my_account (20261121082500_account_security.sql) was written before
-- these tables existed. What they hold about a person goes with the account:
--   erased    channel preferences (with the WhatsApp and SMS number), the
--             commercial-consent history (public.consents is erased there too),
--             push tokens, the frozen text of any message still on its way to
--             the person or about the person's orders, and the suppression
--             entries for the person's e-mail and numbers that no one else
--             uses;
--   kept      the delivery rows themselves (template, channel, status, times,
--             a bare id), as the order history is kept; every message not yet
--             sent to the person is skipped, and nothing is ever sent to the
--             placeholder address the account is left with (notify_resolve).
-- A suppression of an address someone else still uses stays: it protects that
-- person too.
create or replace function private.notify_forget_person(p_user uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_addresses text[];
begin
  -- Where the person could be reached, read before anything is erased.
  select array_remove(array[
           lower(u.email::text), u.phone::text,
           case when u.phone is not null and u.phone::text !~ '^\+' then '+' || u.phone::text end,
           p.phone, np.phone], null)
  into v_addresses
  from auth.users u
  left join public.profiles p on p.id = u.id
  left join private.notification_preferences np on np.user_id = u.id
  where u.id = p_user;

  delete from private.notification_suppressions ns
  where (ns.address = any (v_addresses) or lower(ns.address) = any (v_addresses))
    and not exists (select 1 from auth.users o
                    where o.id <> p_user and lower(o.email::text) = lower(ns.address))
    and not exists (select 1 from public.profiles o where o.id <> p_user and o.phone = ns.address)
    and not exists (select 1 from private.notification_preferences o
                    where o.user_id is distinct from p_user and o.phone = ns.address)
    and not exists (select 1 from public.seller_private o
                    where lower(o.contact_email) = lower(ns.address) or o.contact_phone = ns.address
                       or o.sinpe_movil_number = ns.address);

  -- Messages to the person: whatever has not gone yet never will, and no
  -- frozen text (which carries the address and the name) is kept.
  update private.notification_deliveries d
  set status = case when d.status in ('pending', 'sending') then 'skipped' else d.status end,
      skip_reason = case when d.status in ('pending', 'sending') then 'no_recipient' else d.skip_reason end,
      locked_by = null, locked_until = null, request_body = null, last_error = null
  where d.recipient_user_id = p_user
     or d.recipient in (select 'report:' || cr.id::text from public.content_reports cr
                        where cr.reporter_id = p_user);
  -- Messages to others (the shop, a team) about the person's orders: their
  -- frozen text may name the person; the worker renders it again, from the
  -- anonymised order, under the same idempotency key.
  update private.notification_deliveries d
  set request_body = null
  where d.status in ('pending', 'sending') and d.request_body is not null
    and d.context ->> 'order_id' in (select o.id::text from public.orders o where o.user_id = p_user);

  delete from private.push_tokens t where t.user_id = p_user;
  delete from private.notification_preferences np where np.user_id = p_user;
  perform set_config('yuntera.erasing_account', 'on', true);
  delete from private.commercial_consent_log l where l.user_id = p_user;
  perform set_config('yuntera.erasing_account', '', true);
end;
$$;

revoke execute on function private.notify_forget_person(uuid) from public, anon, authenticated, service_role;

-- The same function as in 20261121082500_account_security.sql, with one
-- addition: the call to notify_forget_person above, after the shop
-- memberships go. Keep the two in step if either changes again.
create or replace function public.delete_my_account() returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_blockers text[];
  v_orders integer;
  v_reviews integer;
  v_shop uuid;
begin
  if v_user is null then
    perform private.fail('not_authenticated');
  end if;
  -- An account with a second factor is deleted only from a session that passed it.
  if not private.factor_ok() then
    perform private.fail('second_factor_required');
  end if;
  -- One deletion at a time per account, and none for an account already gone.
  -- Requests of this account in flight hold this row FOR KEY SHARE (see
  -- check_request), so the deletion waits for them and they cannot follow it.
  perform 1 from auth.users u where u.id = v_user and u.deleted_at is null for update;
  if not found then
    perform private.fail('not_authenticated');
  end if;

  v_blockers := private.account_deletion_blockers(v_user);
  -- The first reason wins; each is spelled out so the client's list of
  -- messages can be checked against this file.
  case v_blockers[1]
    when 'account_is_staff' then perform private.fail('account_is_staff');
    when 'account_is_driver' then perform private.fail('account_is_driver');
    when 'account_is_warehouse_staff' then perform private.fail('account_is_warehouse_staff');
    when 'account_has_open_orders' then perform private.fail('account_has_open_orders');
    when 'account_has_open_returns' then perform private.fail('account_has_open_returns');
    when 'account_has_pending_refund' then perform private.fail('account_has_pending_refund');
    when 'account_has_open_complaints' then perform private.fail('account_has_open_complaints');
    when 'account_runs_open_shop' then perform private.fail('account_runs_open_shop');
    when 'account_shop_has_stock' then perform private.fail('account_shop_has_stock');
    when 'account_shop_has_open_orders' then perform private.fail('account_shop_has_open_orders');
    when 'account_shop_has_balance' then perform private.fail('account_shop_has_balance');
    else null; -- nothing in the way
  end case;

  select count(*) into v_orders from public.orders o where o.user_id = v_user;
  select count(*) into v_reviews from public.reviews r where r.user_id = v_user;

  -- Personal data the platform holds for the person.
  update public.profiles
  set full_name = null, phone = null, phone_verified_at = null,
      marketing_opt_in = false, locale = 'es-CR'
  where id = v_user;
  delete from public.addresses a where a.user_id = v_user;
  delete from public.consents c where c.user_id = v_user;

  -- Kept records, without the person in them. The district stays (it decided
  -- the shipping fee); the pin is rounded to about a kilometre.
  update public.orders o
  set ship_recipient_name = 'Cuenta eliminada', ship_phone = '', ship_senas = '',
      ship_lat = round(o.ship_lat::numeric, 2)::double precision,
      ship_lng = round(o.ship_lng::numeric, 2)::double precision,
      ship_plus_code = null
  where o.user_id = v_user;
  update public.route_stops rs
  set recipient_name = 'Cuenta eliminada', phone = '', senas = '',
      lat = round(rs.lat::numeric, 2)::double precision,
      lng = round(rs.lng::numeric, 2)::double precision,
      plus_code = null, pod_recipient_name = null,
      pod_lat = null, pod_lng = null
  where rs.shipment_id in (
    select sh.id from public.shipments sh
    join public.orders o on o.id = sh.order_id
    where o.user_id = v_user);
  update public.return_requests r set reason = null where r.user_id = v_user;
  update public.complaints c
  set description = 'Texto eliminado junto con la cuenta.'
  where c.user_id = v_user;
  update public.content_reports cr set reporter_email = null
  where cr.reporter_id = v_user;

  -- Roles that ended earlier: an inactive staff row, a former driver, shops
  -- left behind with nothing pending (the blockers above guarantee that). The
  -- audit trail never held a driver's or a shop's personal columns (see
  -- private.audit), so nothing of them is left there either.
  delete from public.staff_members s where s.user_id = v_user and not s.active;
  update public.drivers d
  set full_name = 'Repartidor retirado', phone = '+50650000000', id_number = '000000000',
      plate = null, license_class = null, license_expires_on = null,
      inspection_expires_on = null, insurance_expires_on = null
  where d.user_id = v_user;
  -- Shops (already suspended or closed: see account_runs_open_shop) this
  -- person leaves with nobody in charge.
  for v_shop in
    select m.seller_id from public.seller_members m
    where m.user_id = v_user
      and not exists (select 1 from public.seller_members o
                      where o.seller_id = m.seller_id and o.user_id <> v_user
                        and o.role in ('owner', 'admin'))
  loop
    perform private.close_abandoned_shop(v_shop);
  end loop;
  delete from public.seller_members m where m.user_id = v_user;
  delete from private.mfa_failures f where f.user_id = v_user;
  -- What the notifications add about the person (this file).
  perform private.notify_forget_person(v_user);

  -- The sign-in record: every session ends (and with check_request, every
  -- access token issued for them stops working at once), no way to sign in
  -- remains, and the e-mail address is free for a new account. The ban is
  -- finite, as Auth's own bans are: Auth reads banned_until into a Go time
  -- value, which has no 'infinity'.
  delete from auth.sessions s where s.user_id = v_user;
  delete from auth.mfa_factors f where f.user_id = v_user;
  delete from auth.one_time_tokens t where t.user_id = v_user;
  delete from auth.identities i where i.user_id = v_user;
  update auth.users u
  set email = v_user::text || '@cuenta-eliminada.invalid',
      encrypted_password = '',
      phone = null,
      email_change = '', phone_change = '',
      confirmation_token = '', recovery_token = '', email_change_token_new = '',
      email_change_token_current = '', phone_change_token = '', reauthentication_token = '',
      raw_user_meta_data = '{}'::jsonb,
      last_sign_in_at = null,
      banned_until = now() + interval '100 years',
      deleted_at = now(),
      updated_at = now()
  where u.id = v_user;
  -- Auth's own log of sign-ins, where the project still keeps one in the database.
  begin
    delete from auth.audit_log_entries l where l.payload ->> 'actor_id' = v_user::text;
  exception when undefined_table then
    null;
  end;

  insert into private.account_deletions (orders_kept, reviews_kept) values (v_orders, v_reviews);
  return jsonb_build_object('orders_kept', v_orders, 'reviews_kept', v_reviews);
end;
$$;
