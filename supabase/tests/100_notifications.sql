-- Notifications: planning exactly once, claiming with a lease, retries, dead
-- letters, the idempotency-key generation rule, delivery reports, suppression,
-- preferences, commercial consent, push tokens, and every function as the
-- right and the wrong caller.
--
-- Part 1 runs in one transaction that is rolled back. Part 2 needs two real
-- sessions at once (dblink) and so commits; it removes what it created.

begin;
\ir _helpers.sql

-- The server-side worker, as Supabase runs a request made with a secret key.
create function pg_temp.login_worker() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
end;
$$;

select pg_temp.remember('cafe', pg_temp.offer('cafe-molido-tarrazu-340g')::text);
select pg_temp.remember('buyer', (select id::text from auth.users where email = 'comprador@yuntera.example'));
select pg_temp.remember('buyer_email', 'comprador@yuntera.example');
select pg_temp.remember('tecnocasa', (select id::text from public.sellers where slug = 'tecnocasa'));

-- A seller staff member who is not an admin, and a finance-only staff member.
insert into public.seller_members (seller_id, user_id, role)
select current_setting('t.tecnocasa')::uuid, id, 'staff' from auth.users where email = 'comprador2@yuntera.example';
insert into public.staff_members (user_id, role)
select id, 'finance' from auth.users where email = 'comprador3@yuntera.example';

-- ── Who may call the worker's functions ───────────────────────────────────

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.worker_notify_plan(integer)',
    'public.worker_notify_claim(text, integer, integer)',
    'public.worker_notify_freeze(uuid, text, integer, text)',
    'public.worker_notify_sent(uuid, text, text, text, text[])',
    'public.worker_notify_fail(uuid, text, text, text, text, boolean, integer)',
    'public.worker_notify_defer(uuid, text, timestamptz)',
    'public.worker_notify_skip(uuid, text, text)',
    'public.worker_push_disable(text[], text)',
    'public.worker_push_receipts_due(integer, integer)',
    'public.worker_notify_apply_update(jsonb, text)'
  ] loop
    assert has_function_privilege('service_role', f, 'execute'), f || ' for the worker';
    assert not has_function_privilege('authenticated', f, 'execute'), f || ' not for signed-in people';
    assert not has_function_privilege('anon', f, 'execute'), f || ' not for visitors';
  end loop;
  foreach f in array array[
    'public.my_notification_settings()',
    'public.ops_order_notifications(text)',
    'public.register_push_token(text, text, text, text, text)'
  ] loop
    assert has_function_privilege('authenticated', f, 'execute'), f || ' for signed-in people';
    assert not has_function_privilege('anon', f, 'execute'), f || ' not for visitors';
    assert not has_function_privilege('service_role', f, 'execute'), f || ' not for the worker';
  end loop;
  foreach f in array array[
    'private.notification_deliveries', 'private.notification_preferences', 'private.push_tokens',
    'private.notification_suppressions', 'private.outbox_jobs', 'private.commercial_consent_log'
  ] loop
    assert not has_table_privilege('authenticated', f, 'select'), f || ' is private';
    assert not has_table_privilege('service_role', f, 'select'), f || ' is reached through functions only';
    assert (select relrowsecurity from pg_class where oid = f::regclass), f || ' has row-level security';
  end loop;
end
$$;

-- A signed-in person and a visitor are refused.
select pg_temp.login('comprador@yuntera.example');
do $$
begin
  begin
    perform public.worker_notify_plan(10);
    assert false, 'a shopper planned messages';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.worker_notify_claim('w', 10, 60);
    assert false, 'a shopper claimed messages';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;
select pg_temp.login_anon();
do $$
begin
  perform public.worker_notify_apply_update('{"status":"delivered"}', 'x');
  assert false, 'a visitor applied a delivery report';
exception when insufficient_privilege then null;
end
$$;
reset role;

-- Even with execute rights (here the database owner), the function checks the caller itself.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.buyer'), 'role', 'authenticated')::text, true);
do $$
begin
  perform public.worker_notify_plan(10);
  assert false, 'a non-worker caller got past the check';
exception when raise_exception then
  assert sqlerrm = 'worker_only', sqlerrm;
end
$$;

-- ── Planning: exactly once ────────────────────────────────────────────────

do $$
begin
  assert (select count(*) from private.outbox_jobs where consumer = 'notify' and status = 'pending') > 50,
    'the seed''s events wait to be planned';
  assert not exists (select 1 from private.outbox_jobs j join private.outbox_events e on e.id = j.event_id
                     where e.topic = 'invoice.requested'), 'events nobody consumes get no job';
end
$$;

select pg_temp.login_worker();
select set_config('t.planned', public.worker_notify_plan(1000)::text, true);
select set_config('t.planned_again', public.worker_notify_plan(1000)::text, true);
reset role;

do $$
declare
  v_rows bigint := (select count(*) from private.notification_deliveries);
  e private.outbox_events;
begin
  assert current_setting('t.planned')::integer > 50, 'first run plans the pending events';
  assert current_setting('t.planned_again')::integer = 0, 'second run finds nothing';
  assert not exists (select 1 from private.outbox_jobs where consumer = 'notify' and status <> 'done'),
    'every job is done';
  assert v_rows > 50, format('deliveries: %s', v_rows);
  -- Planning the same event again, by any route, adds nothing.
  for e in select * from private.outbox_events order by id limit 20 loop
    perform private.notify_plan_event(e);
  end loop;
  assert (select count(*) from private.notification_deliveries) = v_rows, 'replanning adds no duplicate';
  -- Section 8: who gets what.
  assert exists (select 1 from private.notification_deliveries
                 where template = 'order_placed' and channel = 'email' and audience = 'shopper'), 'shopper receipt';
  assert exists (select 1 from private.notification_deliveries
                 where template = 'seller_new_order' and audience = 'seller'), 'seller new order';
  assert exists (select 1 from private.notification_deliveries
                 where template = 'staff_payment_to_confirm' and recipient = 'team:finance'), 'finance mailbox';
  assert not exists (select 1 from private.notification_deliveries where channel in ('whatsapp', 'sms', 'push')),
    'nobody opted into WhatsApp or SMS or has a phone registered yet';
  assert not exists (select 1 from private.notification_deliveries d
                     where d.context ?| array['delivery_pin', 'ship_senas', 'ship_phone']), 'ids only in the queue';
end
$$;

-- Everything the seed planned is set aside so the rest of the file works on its own messages.
update private.notification_deliveries set status = 'skipped', skip_reason = 'test';

-- ── Preferences ───────────────────────────────────────────────────────────

select pg_temp.login('comprador@yuntera.example');
do $$
declare
  s jsonb := public.my_notification_settings();
begin
  assert (s ->> 'email_enabled')::boolean and not (s ->> 'whatsapp_enabled')::boolean
         and not (s ->> 'sms_enabled')::boolean and (s ->> 'push_enabled')::boolean, format('defaults %s', s);
  assert not (s #>> '{commercial,opt_in}')::boolean, 'commercial consent starts off';
  assert (s ->> 'email_locked')::boolean, 'the shopper has an order in progress';

  begin
    perform public.set_my_notification_settings(true, true, false, true, null);
    assert false, 'WhatsApp without a number';
  exception when raise_exception then assert sqlerrm = 'notify_phone_required', sqlerrm;
  end;
  begin
    perform public.set_my_notification_settings(true, true, false, true, '2222 1234');
    assert false, 'a landline for WhatsApp';
  exception when raise_exception then assert sqlerrm = 'notify_phone_invalid', sqlerrm;
  end;
  begin
    perform public.set_my_notification_settings(false, false, false, true, null);
    assert false, 'e-mail off with an order in progress';
  exception when raise_exception then assert sqlerrm = 'notify_email_required', sqlerrm;
  end;

  s := public.set_my_notification_settings(true, true, false, true, '8888-1234');
  assert s ->> 'phone' = '+50688881234', format('phone normalised: %s', s ->> 'phone');
  assert (s ->> 'whatsapp_enabled')::boolean and s ->> 'whatsapp_consented_at' is not null,
    'WhatsApp on, with the time of the opt-in';
end
$$;
reset role;
select pg_temp.login_anon();
do $$
begin
  perform public.my_notification_settings();
  assert false, 'a visitor read preferences';
exception when insufficient_privilege then null;
end
$$;
reset role;

-- ── Push tokens ───────────────────────────────────────────────────────────

select pg_temp.login('comprador@yuntera.example');
select public.register_push_token('shop', 'ExponentPushToken[buyer-phone-0001]', 'android', 'device-1', '1.0.0');
do $$
begin
  begin
    perform public.register_push_token('shop', 'not a token', 'android');
    assert false, 'a malformed token';
  exception when raise_exception then assert sqlerrm = 'push_token_invalid', sqlerrm;
  end;
  assert (public.my_notification_settings() ->> 'push_devices')::integer = 1, 'one device';
end
$$;
reset role;
select pg_temp.login('comprador2@yuntera.example');
do $$
begin
  perform public.unregister_push_token('ExponentPushToken[buyer-phone-0001]');
  assert false, 'removed someone else''s token';
exception when raise_exception then assert sqlerrm = 'push_token_not_found', sqlerrm;
end
$$;
reset role;
do $$
begin
  assert (select user_id from private.push_tokens where expo_token = 'ExponentPushToken[buyer-phone-0001]')
         = current_setting('t.buyer')::uuid and
         (select disabled_at is null from private.push_tokens where expo_token = 'ExponentPushToken[buyer-phone-0001]'),
    'the owner''s token is untouched';
end
$$;

-- ── A new order is planned for every channel the shopper chose ────────────

select pg_temp.login('comprador@yuntera.example');
select set_config('t.order', (public.place_order(
  jsonb_build_array(jsonb_build_object('offer_id', current_setting('t.cafe'), 'quantity', 1)),
  (select id from public.addresses where is_default), 'sinpe_movil', 'test-notify-0001') ->> 'order_id'), true);
reset role;
select pg_temp.login_worker();
select public.worker_notify_plan(100);
reset role;

do $$
begin
  assert (select array_agg(channel order by channel) from private.notification_deliveries
          where template = 'order_placed' and context ->> 'order_id' = current_setting('t.order'))
         = array['email', 'push', 'whatsapp'], 'e-mail, push and the WhatsApp the shopper chose';
  assert (select count(*) from private.notification_deliveries
          where template = 'staff_payment_to_confirm' and context ->> 'order_id' = current_setting('t.order')) = 1,
    'finance is told about the transfer to confirm';
end
$$;

-- ── Claiming, with a lease ────────────────────────────────────────────────

select pg_temp.login_worker();
select set_config('t.claim1', public.worker_notify_claim('w1', 50, 120)::text, true);
select set_config('t.claim2', public.worker_notify_claim('w2', 50, 120)::text, true);
reset role;

do $$
declare
  c jsonb := current_setting('t.claim1')::jsonb;
  m jsonb;
begin
  -- No team mailbox is configured: the finance message is skipped, not sent.
  assert (select status || '/' || skip_reason from private.notification_deliveries
          where template = 'staff_payment_to_confirm' and context ->> 'order_id' = current_setting('t.order'))
         = 'skipped/no_address', 'no mailbox, no message';
  assert jsonb_array_length(c) = 3, format('claimed %s', jsonb_array_length(c));
  assert current_setting('t.claim2')::jsonb = '[]'::jsonb, 'a second worker gets none of the leased messages';
  select x into m from jsonb_array_elements(c) x where x ->> 'channel' = 'email';
  assert m #>> '{to,email}' = 'comprador@yuntera.example' and m #>> '{to,name}' = 'María', format('recipient %s', m -> 'to');
  assert m #>> '{vars,order_number}' like 'YT-%', 'variables';
  assert not (m -> 'vars') ?| array['delivery_pin', 'ship_senas', 'ship_phone', 'sinpe_reference', 'id_number'],
    'never the delivery code, the address or payment details';
  assert not exists (select 1 from jsonb_each_text(m -> 'vars') e
                     where e.value = (select delivery_pin from public.orders where id = current_setting('t.order')::uuid)),
    'the PIN appears nowhere as a value';
  select x into m from jsonb_array_elements(c) x where x ->> 'channel' = 'whatsapp';
  assert m #>> '{to,phone}' = '+50688881234', 'the WhatsApp number';
  select x into m from jsonb_array_elements(c) x where x ->> 'channel' = 'push';
  assert m #>> '{to,tokens,0}' = 'ExponentPushToken[buyer-phone-0001]' and m #>> '{to,app}' = 'shop', 'the device';
  assert (select count(*) from private.notification_deliveries where status = 'sending' and locked_by = 'w1') = 3,
    'leased to the first worker';
  perform pg_temp.remember('email_id', (select x ->> 'id' from jsonb_array_elements(c) x where x ->> 'channel' = 'email'));
  perform pg_temp.remember('wa_id', (select x ->> 'id' from jsonb_array_elements(c) x where x ->> 'channel' = 'whatsapp'));
  perform pg_temp.remember('push_id', (select x ->> 'id' from jsonb_array_elements(c) x where x ->> 'channel' = 'push'));
end
$$;

-- The first worker freezes its request; then its lease runs out and another worker takes over.
select pg_temp.login_worker();
do $$
begin
  assert public.worker_notify_freeze(current_setting('t.email_id')::uuid, 'w1', 0, '{"v":1}'), 'frozen';
  assert public.worker_notify_freeze(current_setting('t.email_id')::uuid, 'w1', 0, '{"v":2}'), 'idempotent';
  assert not public.worker_notify_freeze(current_setting('t.email_id')::uuid, 'w2', 0, '{"v":3}'),
    'only the lease holder freezes';
end
$$;
reset role;
update private.notification_deliveries set locked_until = now() - interval '1 second'
where id = current_setting('t.email_id')::uuid;
select pg_temp.login_worker();
do $$
declare
  c jsonb := public.worker_notify_claim('w2', 10, 120);
begin
  assert jsonb_array_length(c) = 1 and c #>> '{0,id}' = current_setting('t.email_id'), 'the expired lease is taken over';
  assert c #>> '{0,request_body}' = '{"v":1}', 'with the frozen request, to resend the same bytes';
  assert (c #>> '{0,attempts}')::integer = 2, 'a second attempt';
  assert not public.worker_notify_sent(current_setting('t.email_id')::uuid, 'w1', 'bird', 'em_late'),
    'the first worker can no longer record its result';
  assert public.worker_notify_sent(current_setting('t.email_id')::uuid, 'w2', 'bird', 'em_1'), 'the holder can';
end
$$;
reset role;
do $$
begin
  assert (select status = 'sent' and provider_message_id = 'em_1' and request_body is null and sent_at is not null
          from private.notification_deliveries where id = current_setting('t.email_id')::uuid),
    'sent, and the request with its personal data is cleared';
end
$$;

-- ── Delivery reports ──────────────────────────────────────────────────────

select pg_temp.login_worker();
do $$
begin
  assert public.worker_notify_apply_update(
    '{"provider":"bird","provider_message_id":"em_1","status":"delivered","occurred_at":"2026-11-21T18:00:05Z"}', 'msg_a')
    = 'applied', 'delivered';
  assert public.worker_notify_apply_update(
    '{"provider":"bird","provider_message_id":"em_1","status":"delivered","occurred_at":"2026-11-21T18:00:05Z"}', 'msg_a')
    = 'duplicate', 'the same webhook twice is applied once';
  assert public.worker_notify_apply_update(
    '{"provider":"bird","provider_message_id":"em_1","status":"sent","occurred_at":"2026-11-21T18:00:01Z"}', 'msg_b')
    = 'stale', 'an older, lesser report does not move it back';
  assert public.worker_notify_apply_update(
    '{"provider":"bird","provider_message_id":"nobody","status":"delivered"}', 'msg_c') = 'unknown', 'unknown message';
  -- A hard bounce that arrives after delivery still counts, and suppresses the address.
  assert public.worker_notify_apply_update(
    jsonb_build_object('provider', 'bird', 'provider_message_id', 'em_1', 'status', 'bounced', 'permanent', true,
      'reason', 'bounce_hard', 'occurred_at', '2026-11-21T18:30:00Z', 'recipient_address', 'Rebota@Correo.cr'), 'msg_d')
    = 'applied', 'out-of-band bounce';
end
$$;
reset role;
do $$
begin
  assert (select status = 'failed' and delivered_at is not null and last_error_code = 'bounce_hard'
          from private.notification_deliveries where id = current_setting('t.email_id')::uuid), 'failed after the bounce';
  assert exists (select 1 from private.notification_suppressions
                 where channel = 'email' and address = 'rebota@correo.cr' and reason = 'hard_bounce'), 'suppressed';
end
$$;

-- ── Failures: back-off, the generation rule, dead letters ─────────────────

select pg_temp.login_worker();
do $$
declare
  v_status text;
begin
  -- A network error: same key, same bytes, a wait.
  assert public.worker_notify_freeze(current_setting('t.wa_id')::uuid, 'w1', 0, '{"frozen":"wa"}'), 'frozen';
  v_status := public.worker_notify_fail(current_setting('t.wa_id')::uuid, 'w1', 'retry', 'timeout', 'no answer', false, null);
  assert v_status = 'pending', v_status;
end
$$;
reset role;
do $$
declare
  d private.notification_deliveries;
begin
  select * into d from private.notification_deliveries where id = current_setting('t.wa_id')::uuid;
  assert d.generation = 0 and d.request_body = '{"frozen":"wa"}', 'retry keeps the key and the bytes';
  assert d.available_at > now() + interval '10 seconds' and d.available_at < now() + interval '20 seconds',
    format('first back-off about 15 s: %s', d.available_at - now());
  assert d.last_error_code = 'timeout' and d.locked_by is null, 'released';
end
$$;
update private.notification_deliveries set available_at = now() where id = current_setting('t.wa_id')::uuid;

select pg_temp.login_worker();
do $$
declare
  c jsonb := public.worker_notify_claim('w3', 10, 60);
begin
  assert c #>> '{0,request_body}' = '{"frozen":"wa"}', 'reclaimed with its frozen request';
  -- A refusal the provider keeps (here a 402): a new key and a new body next time, no attempt spent.
  assert public.worker_notify_fail(current_setting('t.wa_id')::uuid, 'w3', 'account', '402', 'wallet', true, null) = 'pending',
    'held';
end
$$;
reset role;
do $$
declare
  d private.notification_deliveries;
begin
  select * into d from private.notification_deliveries where id = current_setting('t.wa_id')::uuid;
  assert d.generation = 1 and d.request_body is null, 'new generation, body to be rebuilt';
  assert d.attempts = 1 and d.holds = 1, format('no attempt spent: attempts %s holds %s', d.attempts, d.holds);
  assert d.available_at >= now() + interval '14 minutes', 'held for 15 minutes';
end
$$;
update private.notification_deliveries set available_at = now() where id = current_setting('t.wa_id')::uuid;

select pg_temp.login_worker();
do $$
declare
  c jsonb := public.worker_notify_claim('w3', 10, 60);
begin
  assert (c #>> '{0,generation}')::integer = 1, 'claimed under the new generation';
  -- A rejected request (a 422): dead at once.
  assert public.worker_notify_fail(current_setting('t.wa_id')::uuid, 'w3', 'permanent', '422 E15044', 'rejected', true, null) = 'dead',
    'dead letter';
  -- Retries run out.
  assert public.worker_notify_fail(current_setting('t.push_id')::uuid, 'w1', 'retry', '500', 'x', false, 5) = 'pending', 'retry';
end
$$;
reset role;
update private.notification_deliveries set attempts = max_attempts, available_at = now()
where id = current_setting('t.push_id')::uuid;
-- The last attempt is the one claimed now.
update private.notification_deliveries set attempts = max_attempts - 1 where id = current_setting('t.push_id')::uuid;
select pg_temp.login_worker();
do $$
begin
  perform public.worker_notify_claim('w4', 10, 60);
  assert public.worker_notify_fail(current_setting('t.push_id')::uuid, 'w4', 'retry', '503', 'x', false, null) = 'dead',
    'the tenth failure is the last';
end
$$;
reset role;
do $$
begin
  assert (select status from private.notification_deliveries where id = current_setting('t.wa_id')::uuid) = 'dead', 'wa dead';
  assert (select status from private.notification_deliveries where id = current_setting('t.push_id')::uuid) = 'dead', 'push dead';
  assert (select request_body is null from private.notification_deliveries where id = current_setting('t.wa_id')::uuid),
    'a dead letter keeps no request body';
end
$$;

-- A configuration error pauses the channel.
insert into private.notification_deliveries (dedupe_key, ordering_key, sequence, channel, template, recipient,
  recipient_user_id, audience, context)
values ('test/config', 'user:x', 1, 'email', 'complaint_received', 'user:' || current_setting('t.buyer'),
        current_setting('t.buyer')::uuid, 'shopper', '{}'),
       ('test/after-pause', 'user:y', 2, 'email', 'complaint_received', 'user:' || current_setting('t.buyer'),
        current_setting('t.buyer')::uuid, 'shopper', '{}');
select pg_temp.login_worker();
do $$
declare
  c jsonb := public.worker_notify_claim('w5', 1, 60);
begin
  assert public.worker_notify_fail((c #>> '{0,id}')::uuid, 'w5', 'config', '401', 'bad key', true, null) = 'dead', 'config';
  assert public.worker_notify_claim('w5', 10, 60) = '[]'::jsonb, 'nothing more on a paused channel';
end
$$;
reset role;
delete from private.notify_channel_pauses;
update private.notification_deliveries set status = 'skipped' where dedupe_key like 'test/%';

-- ── Ordering per order ────────────────────────────────────────────────────

insert into private.notification_deliveries (dedupe_key, ordering_key, sequence, channel, template, recipient,
  recipient_user_id, audience, context, available_at)
values ('fifo/1', 'order:fifo', 10, 'email', 'order_placed', 'user:' || current_setting('t.buyer'),
        current_setting('t.buyer')::uuid, 'shopper', '{}', now() + interval '1 hour'),
       ('fifo/2', 'order:fifo', 11, 'email', 'payment_received', 'user:' || current_setting('t.buyer'),
        current_setting('t.buyer')::uuid, 'shopper', '{}', now()),
       ('fifo/3', 'order:fifo', 12, 'push', 'payment_received', 'user:' || current_setting('t.buyer'),
        current_setting('t.buyer')::uuid, 'shopper', '{}', now());
update private.notification_deliveries set push_app = 'shop' where dedupe_key = 'fifo/3';
select pg_temp.login_worker();
select set_config('t.fifo', public.worker_notify_claim('w6', 10, 60)::text, true);
reset role;
do $$
begin
  assert (select array_agg(x ->> 'template' || '/' || (x ->> 'channel'))
          from jsonb_array_elements(current_setting('t.fifo')::jsonb) x) = array['payment_received/push'],
    format('a later e-mail waits for the earlier one; other channels go on: %s', current_setting('t.fifo'));
end
$$;
update private.notification_deliveries set status = 'skipped' where dedupe_key like 'fifo/%';

-- ── Suppression and preferences, checked again when claimed ───────────────

select pg_temp.login('comprador@yuntera.example');
select public.file_complaint('delivery', 'El repartidor llegó fuera del horario indicado.', null);
reset role;
select pg_temp.login_worker();
select public.worker_notify_plan(100);
reset role;
insert into private.notification_suppressions (channel, address, reason)
values ('email', current_setting('t.buyer_email'), 'complaint');
select pg_temp.login_worker();
select set_config('t.after_complaint', public.worker_notify_claim('w7', 10, 60)::text, true);
reset role;
do $$
begin
  assert (select count(*) from jsonb_array_elements(current_setting('t.after_complaint')::jsonb) x
          where x ->> 'template' = 'complaint_received') = 1,
    'a spam complaint blocks commercial mail only: the receipt still goes';
end
$$;
update private.notification_deliveries set status = 'skipped' where status = 'sending';

-- A hard bounce on the shopper's address blocks everything to it.
insert into private.notification_suppressions (channel, address, reason)
values ('email', current_setting('t.buyer_email'), 'hard_bounce');
-- And WhatsApp switched off after planning stops the planned message.
insert into private.notification_deliveries (dedupe_key, ordering_key, sequence, channel, template, recipient,
  recipient_user_id, audience, context)
values ('sup/email', 'order:s', 20, 'email', 'payment_received', 'user:' || current_setting('t.buyer'),
        current_setting('t.buyer')::uuid, 'shopper', jsonb_build_object('order_id', current_setting('t.order'))),
       ('sup/wa', 'order:s', 20, 'whatsapp', 'order_placed', 'user:' || current_setting('t.buyer'),
        current_setting('t.buyer')::uuid, 'shopper', jsonb_build_object('order_id', current_setting('t.order')));
select pg_temp.login('comprador@yuntera.example');
select public.set_my_notification_settings(true, false, false, true, '88881234');
reset role;
select pg_temp.login_worker();
select set_config('t.suppressed', public.worker_notify_claim('w8', 10, 60)::text, true);
reset role;
do $$
begin
  assert current_setting('t.suppressed')::jsonb = '[]'::jsonb, current_setting('t.suppressed');
  assert (select skip_reason from private.notification_deliveries where dedupe_key = 'sup/email') = 'suppressed_hard_bounce',
    'hard bounce';
  assert (select skip_reason from private.notification_deliveries where dedupe_key = 'sup/wa') = 'channel_off',
    'opt-out honoured at once';
end
$$;
delete from private.notification_suppressions;

-- ── Commercial consent ────────────────────────────────────────────────────

do $$
begin
  -- Without consent a commercial message is not even planned.
  perform private.notify_add(999999, 'promo_test', 'email', 'user:' || current_setting('t.buyer'), 'shopper', 'user:p',
    '{}', current_setting('t.buyer')::uuid, null, null, null, 'marketing');
  assert not exists (select 1 from private.notification_deliveries where template = 'promo_test'), 'not planned';
end
$$;
-- And one that got into the queue anyway is stopped when claimed.
insert into private.notification_deliveries (dedupe_key, ordering_key, sequence, channel, category, template,
  recipient, recipient_user_id, audience, context)
values ('mkt/1', 'user:m', 30, 'email', 'marketing', 'promo_test', 'user:' || current_setting('t.buyer'),
        current_setting('t.buyer')::uuid, 'shopper', '{}');
select pg_temp.login_worker();
select public.worker_notify_claim('w9', 10, 60);
reset role;
do $$
begin
  assert (select status || '/' || skip_reason from private.notification_deliveries where dedupe_key = 'mkt/1')
         = 'skipped/no_commercial_consent', 'no consent, no message';
end
$$;

select pg_temp.login('comprador@yuntera.example');
do $$
declare
  s jsonb;
begin
  begin
    perform public.set_my_commercial_consent(true, '', 'web_cuenta');
    assert false, 'consent without the wording''s version';
  exception when raise_exception then assert sqlerrm = 'notify_consent_invalid', sqlerrm;
  end;
  s := public.set_my_commercial_consent(true, 'comercial-2026-11', 'web_cuenta');
  assert (s #>> '{commercial,opt_in}')::boolean and s #>> '{commercial,granted_at}' is not null
         and s #>> '{commercial,source}' = 'web_cuenta' and s #>> '{commercial,text_version}' = 'comercial-2026-11',
    format('when and how: %s', s -> 'commercial');
  assert (public.my_profile() ->> 'marketing_opt_in')::boolean, 'the profile flag follows';
end
$$;
reset role;
insert into private.notification_deliveries (dedupe_key, ordering_key, sequence, channel, category, template,
  recipient, recipient_user_id, audience, context)
values ('mkt/2', 'user:m2', 31, 'email', 'marketing', 'promo_test', 'user:' || current_setting('t.buyer'),
        current_setting('t.buyer')::uuid, 'shopper', '{}');
select pg_temp.login_worker();
select set_config('t.mkt', public.worker_notify_claim('w9', 10, 60)::text, true);
reset role;
do $$
begin
  assert (current_setting('t.mkt')::jsonb #>> '{0,commercial_consent}')::boolean, 'with consent it may go';
  assert exists (select 1 from public.consents where user_id = current_setting('t.buyer')::uuid
                 and purpose = 'marketing' and revoked_at is null), 'recorded as a consent';
end
$$;
update private.notification_deliveries set status = 'skipped' where dedupe_key = 'mkt/2';

-- Withdrawn at any time, effective at once; the old profile form can no longer switch it.
select pg_temp.login('comprador@yuntera.example');
select public.update_profile('María Fernández Solís', null, 'es-CR', true);
select public.set_my_commercial_consent(false, 'comercial-2026-11', 'web_cuenta');
reset role;
insert into private.notification_deliveries (dedupe_key, ordering_key, sequence, channel, category, template,
  recipient, recipient_user_id, audience, context)
values ('mkt/3', 'user:m3', 32, 'email', 'marketing', 'promo_test', 'user:' || current_setting('t.buyer'),
        current_setting('t.buyer')::uuid, 'shopper', '{}');
select pg_temp.login_worker();
select public.worker_notify_claim('w9', 10, 60);
reset role;
do $$
begin
  assert (select skip_reason from private.notification_deliveries where dedupe_key = 'mkt/3') = 'no_commercial_consent',
    'withdrawn';
  assert (select array_agg(action order by id) from private.commercial_consent_log
          where user_id = current_setting('t.buyer')::uuid) = array['granted', 'withdrawn'], 'the history is kept';
  assert not exists (select 1 from public.consents where user_id = current_setting('t.buyer')::uuid
                     and purpose = 'marketing' and revoked_at is null), 'consent revoked';
  assert not (select marketing_opt_in from public.profiles where id = current_setting('t.buyer')::uuid),
    'the profile form did not switch it back on';
  begin
    update private.commercial_consent_log set action = 'granted';
    assert false, 'the consent history was rewritten';
  exception when raise_exception then null;
  end;
end
$$;

-- An unsubscribe reported by the provider withdraws it too.
select pg_temp.login('comprador@yuntera.example');
select public.set_my_commercial_consent(true, 'comercial-2026-11', 'web_cuenta');
reset role;
select pg_temp.login_worker();
select public.worker_notify_apply_update(jsonb_build_object('provider', 'bird', 'channel', 'email',
  'status', 'unsubscribed', 'recipient_address', current_setting('t.buyer_email')), 'msg_unsub');
reset role;
do $$
begin
  assert not private.commercial_allowed(current_setting('t.buyer')::uuid, null), 'unsubscribed';
end
$$;

-- ── Events nothing emitted before ─────────────────────────────────────────

do $$
declare
  v_ship uuid;
  v_route uuid;
begin
  select s.id into v_ship from public.shipments s where s.status = 'packed' limit 1;
  update public.shipments set status = 'ready_for_dispatch' where id = v_ship;
  assert not exists (select 1 from private.outbox_events where topic = 'shipment.out_for_delivery'
                     and payload ->> 'shipment_id' = v_ship::text), 'not yet';
  update public.shipments set status = 'out_for_delivery' where id = v_ship;
  assert exists (select 1 from private.outbox_events where topic = 'shipment.out_for_delivery'
                 and payload ->> 'shipment_id' = v_ship::text), 'out for delivery';
  update public.payments set status = 'refunded' where order_id = (
    select order_id from public.payments where status = 'captured' limit 1) and status = 'captured';
  assert exists (select 1 from private.outbox_events where topic = 'refund.completed'), 'refund completed';
  select id into v_route from public.routes where driver_id is not null limit 1;
  update public.routes set driver_id = (select id from public.drivers where id <> routes.driver_id limit 1)
  where id = v_route;
  assert exists (select 1 from private.outbox_events where topic = 'route.assigned' and payload ->> 'route_id' = v_route::text),
    'route assigned';
  assert exists (select 1 from private.outbox_jobs j join private.outbox_events e on e.id = j.event_id
                 where e.topic = 'refund.completed' and j.consumer = 'notify' and j.status = 'pending'),
    'and they are routed to the notification consumer';
end
$$;

-- ── Staff ─────────────────────────────────────────────────────────────────

select pg_temp.remember('order_number', (select order_number from public.orders where id = current_setting('t.order')::uuid));
select pg_temp.login('central@yuntera.example');
do $$
declare
  rows jsonb := public.ops_order_notifications(current_setting('t.order_number'));
  dead jsonb := public.ops_notification_dead_letters(50);
  r jsonb;
begin
  assert jsonb_array_length(rows) >= 4, format('the order''s messages: %s', jsonb_array_length(rows));
  assert (select bool_and(not (x ?| array['request_body', 'recipient', 'context', 'html', 'to']))
          from jsonb_array_elements(rows) x), 'staff never see the body or the address';
  assert (dead ->> 'dead_count')::integer >= 2, format('dead letters %s', dead ->> 'dead_count');
  r := public.ops_retry_notification(current_setting('t.wa_id')::uuid);
  assert r ->> 'status' = 'pending' and (r ->> 'generation')::integer = 2, format('retried: %s', r);
  begin
    perform public.ops_retry_notification(current_setting('t.wa_id')::uuid);
    assert false, 'retried twice';
  exception when raise_exception then assert sqlerrm = 'notification_not_retryable', sqlerrm;
  end;
  begin
    perform public.ops_retry_notification(gen_random_uuid());
    assert false, 'retried nothing';
  exception when raise_exception then assert sqlerrm = 'notification_not_found', sqlerrm;
  end;
  begin
    perform public.ops_order_notifications('YT-999999');
    assert false, 'unknown order';
  exception when raise_exception then assert sqlerrm = 'order_not_found', sqlerrm;
  end;
end
$$;
reset role;
do $$
begin
  assert (select attempts = 0 and request_body is null and retried_by is not null
          from private.notification_deliveries where id = current_setting('t.wa_id')::uuid), 'fresh start, recorded';
  assert exists (select 1 from private.audit_log where table_name = 'notification_deliveries'
                 and row_key = current_setting('t.wa_id')), 'audited';
end
$$;

select pg_temp.login('comprador@yuntera.example');
do $$
begin
  begin
    perform public.ops_order_notifications(current_setting('t.order_number'));
    assert false, 'a shopper read the message log';
  exception when raise_exception then assert sqlerrm = 'forbidden', sqlerrm;
  end;
  begin
    perform public.ops_notification_dead_letters(10);
    assert false, 'a shopper read the dead letters';
  exception when raise_exception then assert sqlerrm = 'forbidden', sqlerrm;
  end;
end
$$;
reset role;
select pg_temp.login('comprador3@yuntera.example');
do $$
begin
  perform public.ops_retry_notification(current_setting('t.wa_id')::uuid);
  assert false, 'finance staff retried a message';
exception when raise_exception then assert sqlerrm = 'forbidden', sqlerrm;
end
$$;
reset role;

-- ── The shop's settings ───────────────────────────────────────────────────

select pg_temp.login('vendedor@yuntera.example');
do $$
declare
  s jsonb := public.seller_notification_settings(current_setting('t.tecnocasa')::uuid);
begin
  assert (s ->> 'can_edit')::boolean and (s ->> 'email_locked')::boolean, 'owner, e-mail always on';
  assert s ->> 'contact_email' = 'vendedor@yuntera.example', 'the shop''s contact';
  s := public.seller_set_notification_settings(current_setting('t.tecnocasa')::uuid, true, true, '+50687001111');
  assert (s ->> 'whatsapp_enabled')::boolean and s ->> 'phone' = '+50687001111', 'WhatsApp on for the shop';
  s := public.seller_set_commercial_consent(current_setting('t.tecnocasa')::uuid, true, 'comercial-2026-11', 'seller_cuenta');
  assert (s #>> '{commercial,opt_in}')::boolean, 'shop consent';
end
$$;
reset role;
do $$
begin
  assert (select actor_id from private.commercial_consent_log where seller_id = current_setting('t.tecnocasa')::uuid)
         = (select id from auth.users where email = 'vendedor@yuntera.example'), 'who gave it for the shop';
end
$$;
select pg_temp.login('comprador2@yuntera.example');
do $$
begin
  assert (public.seller_notification_settings(current_setting('t.tecnocasa')::uuid) ->> 'can_edit')::boolean is false,
    'a staff member reads but cannot change';
  begin
    perform public.seller_set_notification_settings(current_setting('t.tecnocasa')::uuid, false, false, null);
    assert false, 'a staff member changed the shop''s settings';
  exception when raise_exception then assert sqlerrm = 'forbidden', sqlerrm;
  end;
end
$$;
reset role;
select pg_temp.login('comprador@yuntera.example');
do $$
begin
  perform public.seller_notification_settings(current_setting('t.tecnocasa')::uuid);
  assert false, 'a shopper read a shop''s settings';
exception when raise_exception then assert sqlerrm = 'seller_not_found', sqlerrm;
end
$$;
reset role;

-- ── A shop has no SMS channel ─────────────────────────────────────────────

do $$
begin
  assert to_regprocedure('public.seller_set_notification_settings(uuid, boolean, boolean, boolean, text)') is null,
    'the shop''s save takes no SMS choice';
  assert (select not sms_enabled from private.notification_preferences
          where seller_id = current_setting('t.tecnocasa')::uuid), 'and a shop''s SMS is stored as off';
end
$$;

-- ── An opt-out is lifted only by the phone itself ─────────────────────────

select pg_temp.login('comprador@yuntera.example');
select public.set_my_notification_settings(true, true, false, true, '8765 4321');
reset role;
select pg_temp.login_worker();
select public.worker_notify_apply_update('{"provider":"bird","channel":"whatsapp","status":"opted_out",
  "recipient_address":"+50687654321","permanent":true}', 'msg_optout_1');
reset role;
do $$
begin
  assert (select not whatsapp_enabled from private.notification_preferences
          where user_id = current_setting('t.buyer')::uuid), 'the holder''s STOP turns WhatsApp off';
end
$$;
select pg_temp.login('comprador2@yuntera.example');
do $$
begin
  begin
    perform public.set_my_notification_settings(true, true, false, true, '87654321');
    assert false, 'another account lifted the opt-out by typing the number';
  exception when raise_exception then assert sqlerrm = 'notify_phone_opted_out', sqlerrm;
  end;
end
$$;
reset role;
select pg_temp.login('comprador@yuntera.example');
do $$
begin
  begin
    perform public.set_my_notification_settings(true, true, false, true, '87654321');
    assert false, 'the form lifted the opt-out';
  exception when raise_exception then assert sqlerrm = 'notify_phone_opted_out', sqlerrm;
  end;
  -- The other channels can still be saved with that number.
  perform public.set_my_notification_settings(true, false, false, true, '87654321');
end
$$;
reset role;
do $$
begin
  assert exists (select 1 from private.notification_suppressions where channel = 'whatsapp'
                 and address = '+50687654321' and reason = 'opt_out' and lifted_at is null), 'still suppressed';
  assert not exists (select 1 from private.notification_preferences
                     where phone = '+50687654321' and whatsapp_enabled), 'and nobody has WhatsApp on for it';
end
$$;
-- The phone itself asks again (START): only then can it be switched on.
select pg_temp.login_worker();
select public.worker_notify_apply_update('{"provider":"bird","channel":"whatsapp","status":"opted_in",
  "recipient_address":"+50687654321"}', 'msg_optin_1');
reset role;
select pg_temp.login('comprador@yuntera.example');
do $$
begin
  assert (public.set_my_notification_settings(true, true, false, true, '87654321') ->> 'whatsapp_enabled')::boolean,
    'switched on after the phone opted in';
end
$$;
reset role;

-- ── A save from an out-of-date page is refused; a save is all or nothing ──

select pg_temp.login('comprador@yuntera.example');
do $$
declare
  v_loaded bigint := (public.my_notification_settings() ->> 'version')::bigint;
  s jsonb;
begin
  assert v_loaded > 0, 'the settings carry a version';
  -- Tab 1 saves SMS on.
  s := public.set_my_notification_settings(true, true, true, true, '87654321', null, null, v_loaded);
  assert (s ->> 'sms_enabled')::boolean, 'tab 1 saved';
  -- Tab 2, loaded before, saves only the commercial box: refused.
  begin
    perform public.set_my_notification_settings(true, true, false, true, '87654321', true, 'comercial-2026-11', v_loaded);
    assert false, 'a stale tab undid a change';
  exception when raise_exception then assert sqlerrm = 'notify_settings_changed', sqlerrm;
  end;
  s := public.my_notification_settings();
  assert (s ->> 'sms_enabled')::boolean and not (s #>> '{commercial,opt_in}')::boolean, 'nothing of tab 2 was kept';
  -- Channels and consent in one call: a bad consent keeps the channels unsaved too.
  begin
    perform public.set_my_notification_settings(true, true, false, true, '87654321', true, 'x',
      (s ->> 'version')::bigint);
    assert false, 'an invalid consent was accepted';
  exception when raise_exception then assert sqlerrm = 'notify_consent_invalid', sqlerrm;
  end;
  assert (public.my_notification_settings() ->> 'sms_enabled')::boolean, 'the channels were not half saved';
  s := public.set_my_notification_settings(true, true, false, true, '87654321', true, 'comercial-2026-11',
    (s ->> 'version')::bigint);
  assert not (s ->> 'sms_enabled')::boolean and (s #>> '{commercial,opt_in}')::boolean, 'both saved together';
end
$$;
reset role;

-- ── A push token moves to another account only from its own phone ────────

select pg_temp.login('comprador2@yuntera.example');
do $$
begin
  begin
    perform public.register_push_token('shop', 'ExponentPushToken[buyer-phone-0001]', 'ios');
    assert false, 'took someone else''s token';
  exception when raise_exception then assert sqlerrm = 'push_token_invalid', sqlerrm;
  end;
  begin
    perform public.register_push_token('shop', 'ExponentPushToken[buyer-phone-0001]', 'android', 'device-9');
    assert false, 'took someone else''s token from another device';
  exception when raise_exception then assert sqlerrm = 'push_token_invalid', sqlerrm;
  end;
end
$$;
reset role;
do $$
begin
  assert (select user_id from private.push_tokens where expo_token = 'ExponentPushToken[buyer-phone-0001]')
         = current_setting('t.buyer')::uuid, 'the token stays with its owner';
end
$$;
select pg_temp.login('comprador@yuntera.example');
select public.register_push_token('shop', 'ExponentPushToken[shared-phone-0002]', 'android');
select public.unregister_push_token('ExponentPushToken[shared-phone-0002]');
reset role;
select pg_temp.login('comprador2@yuntera.example');
select public.register_push_token('shop', 'ExponentPushToken[shared-phone-0002]', 'android');
-- The same phone (same device id) signing in to another account without signing out first.
select public.register_push_token('shop', 'ExponentPushToken[buyer-phone-0001]', 'android', 'device-1');
reset role;
do $$
begin
  assert (select user_id from private.push_tokens where expo_token = 'ExponentPushToken[shared-phone-0002]')
         = (select id from auth.users where email = 'comprador2@yuntera.example'), 'after sign-out it can move';
  assert (select user_id from private.push_tokens where expo_token = 'ExponentPushToken[buyer-phone-0001]')
         = (select id from auth.users where email = 'comprador2@yuntera.example'), 'from the same device it can move';
end
$$;

-- ── Failures the provider reports after accepting a message ───────────────

create function pg_temp.delivery(p_channel text, p_pmid text, p_attempts integer default 1) returns uuid
language sql as $$
  insert into private.notification_deliveries
    (dedupe_key, ordering_key, sequence, channel, template, recipient, recipient_user_id, audience,
     context, status, attempts, provider, provider_message_id, sent_at)
  values (gen_random_uuid()::text, 'test:' || gen_random_uuid(), 1, p_channel, 'order_placed',
          'user:' || current_setting('t.buyer'), current_setting('t.buyer')::uuid, 'shopper',
          jsonb_build_object('order_id', current_setting('t.order')), 'sent', p_attempts, 'bird', p_pmid, now())
  returning id;
$$;
select pg_temp.remember('soft_id', pg_temp.delivery('email', 'em_async_1')::text);
select pg_temp.remember('hard_id', pg_temp.delivery('whatsapp', 'wa_async_2')::text);
select pg_temp.remember('spent_id', pg_temp.delivery('sms', 'sms_async_3', 10)::text);

select pg_temp.login_worker();
do $$
begin
  -- A soft bounce goes back through the retries, as a new request.
  assert public.worker_notify_apply_update(jsonb_build_object('provider', 'bird', 'channel', 'email',
    'provider_message_id', 'em_async_1', 'delivery_id', current_setting('t.soft_id'), 'generation', 0,
    'status', 'bounced', 'permanent', false, 'reason', 'bounce_soft'), 'msg_soft') = 'requeued', 'soft bounce';
  -- A late report about that first request changes nothing now, even when
  -- the provider does not echo the generation: nothing is in flight.
  assert public.worker_notify_apply_update(jsonb_build_object('provider', 'bird', 'channel', 'email',
    'provider_message_id', 'em_async_1', 'delivery_id', current_setting('t.soft_id'),
    'status', 'delivered'), 'msg_late_1') = 'unknown', 'a late report for the old request';
  -- A permanent failure after sending ends as failed.
  assert public.worker_notify_apply_update(jsonb_build_object('provider', 'bird', 'channel', 'whatsapp',
    'provider_message_id', 'wa_async_2', 'delivery_id', current_setting('t.hard_id'), 'generation', 0,
    'status', 'failed', 'permanent', true, 'reason', 'undeliverable'), 'msg_hard') = 'applied', 'hard failure';
  -- A temporary failure with no attempts left is a dead letter.
  assert public.worker_notify_apply_update(jsonb_build_object('provider', 'bird', 'channel', 'sms',
    'provider_message_id', 'sms_async_3', 'status', 'failed', 'permanent', false, 'reason', 'expired'),
    'msg_spent') = 'dead', 'spent';
end
$$;
reset role;
do $$
begin
  assert (select status = 'pending' and generation = 1 and provider_message_id is null and provider_status is null
                 and last_error_code = 'bounce_soft' and available_at > now()
          from private.notification_deliveries where id = current_setting('t.soft_id')::uuid),
    'requeued under a new generation, with back-off';
  assert (select status = 'failed' from private.notification_deliveries where id = current_setting('t.hard_id')::uuid),
    'failed';
  assert (select status = 'dead' from private.notification_deliveries where id = current_setting('t.spent_id')::uuid),
    'dead when no attempts are left';
  assert not exists (select 1 from private.notification_suppressions where address = 'comprador@yuntera.example'
                     and reason = 'hard_bounce'), 'a soft bounce suppresses nothing';
end
$$;

-- The next generation is in flight; a report about the earlier one is ignored.
update private.notification_deliveries
set status = 'sending', locked_by = 'w9', locked_until = now() + interval '1 minute', attempts = 2
where id = current_setting('t.soft_id')::uuid;
select pg_temp.login_worker();
do $$
begin
  assert public.worker_notify_apply_update(jsonb_build_object('provider', 'bird', 'channel', 'email',
    'provider_message_id', 'em_async_1', 'delivery_id', current_setting('t.soft_id'), 'generation', 0,
    'status', 'failed', 'permanent', true), 'msg_late_2') = 'stale', 'generation 0 does not touch generation 1';
  assert public.worker_notify_apply_update(jsonb_build_object('provider', 'bird', 'channel', 'email',
    'provider_message_id', 'em_async_1b', 'delivery_id', current_setting('t.soft_id'), 'generation', 1,
    'status', 'delivered'), 'msg_now') = 'applied', 'generation 1''s own report arrives before the send is recorded';
  assert public.worker_notify_sent(current_setting('t.soft_id')::uuid, 'w9', 'bird', 'em_async_1b'), 'recorded';
end
$$;
reset role;
do $$
begin
  assert (select status = 'delivered' and provider_status = 'delivered'
          from private.notification_deliveries where id = current_setting('t.soft_id')::uuid), 'delivered once';
end
$$;

-- Staff see the failed message beside the dead ones, and can retry it.
select pg_temp.login('central@yuntera.example');
do $$
declare
  dead jsonb := public.ops_notification_dead_letters(200);
begin
  assert exists (select 1 from jsonb_array_elements(dead -> 'items') x
                 where x ->> 'id' = current_setting('t.hard_id') and x ->> 'status' = 'failed'),
    'a failure after sending is on the dead-letter page';
  assert exists (select 1 from jsonb_array_elements(dead -> 'items') x
                 where x ->> 'id' = current_setting('t.spent_id') and x ->> 'status' = 'dead'), 'and the dead one';
  assert (dead ->> 'failed_count')::integer >= 1, 'counted';
  perform public.ops_retry_notification(current_setting('t.hard_id')::uuid);
end
$$;
reset role;
do $$
begin
  assert (select old_row ->> 'status' = 'failed' and (new_row ->> 'generation')::integer = 1
          from private.audit_log where table_name = 'notification_deliveries'
            and row_key = current_setting('t.hard_id') order by id desc limit 1),
    'the audit records the status it had';
end
$$;

-- ── A lease that runs out after the last attempt ends as a dead letter ────

update private.notification_deliveries
set status = 'sending', locked_by = 'w-gone', locked_until = now() - interval '1 minute',
    attempts = max_attempts, last_error_code = null
where id = current_setting('t.spent_id')::uuid;
select pg_temp.login_worker();
select public.worker_notify_claim('w-next', 1, 60);
reset role;
do $$
begin
  assert (select status = 'dead' and last_error_code = 'lease_expired' and locked_by is null
          from private.notification_deliveries where id = current_setting('t.spent_id')::uuid),
    'dead, not claimed an eleventh time';
end
$$;


rollback;

-- ═══ Part 2: two sessions at once ═════════════════════════════════════════
-- Each session is a real connection (dblink) that commits, as two workers
-- would. What they create is removed at the end.

begin;
create extension if not exists dblink;

select dblink_connect('a', format('dbname=%s user=%s', current_database(), current_user));
select dblink_connect('b', format('dbname=%s user=%s', current_database(), current_user));
select dblink_connect('admin', format('dbname=%s user=%s', current_database(), current_user));

create temp table pending_jobs as
select event_id from private.outbox_jobs where consumer = 'notify' and status = 'pending';

-- Two planners at once: the second waits for nothing and plans nothing the first holds.
select dblink_exec('a', 'begin');
select dblink_exec('a', $q$set request.jwt.claims = '{"role":"service_role"}'$q$);
select dblink_exec('a', 'set role service_role');
select dblink_exec('b', $q$set request.jwt.claims = '{"role":"service_role"}'$q$);
select dblink_exec('b', 'set role service_role');

do $$
declare
  v_a integer;
  v_b integer;
begin
  select n into v_a from dblink('a', 'select public.worker_notify_plan(1000)') as t (n integer);
  select n into v_b from dblink('b', 'select public.worker_notify_plan(1000)') as t (n integer);
  assert v_a = (select count(*) from pending_jobs), format('first planner: %s', v_a);
  assert v_b = 0, format('the second planner skipped the jobs the first holds: %s', v_b);
end
$$;
select dblink_exec('a', 'commit');

do $$
declare
  v_b integer;
begin
  select n into v_b from dblink('b', 'select public.worker_notify_plan(1000)') as t (n integer);
  assert v_b = 0, 'and finds nothing afterwards';
  assert (select count(*) from dblink('admin',
            $q$select j.attempts from private.outbox_jobs j where j.consumer = 'notify'$q$) as t (attempts smallint)
          where attempts <> 1) = 0, 'each job planned once';
  assert (select n from dblink('admin', $q$select count(*) - count(distinct dedupe_key) from private.notification_deliveries$q$)
          as t (n bigint)) = 0, 'no duplicate message';
end
$$;

-- Two workers claiming at once get disjoint messages.
select dblink_exec('a', 'begin');
create temp table claims (worker text, id uuid);
insert into claims
select 'a', (x ->> 'id')::uuid
from dblink('a', $q$select public.worker_notify_claim('wa', 10, 120)$q$) as t (c jsonb), jsonb_array_elements(t.c) x;
insert into claims
select 'b', (x ->> 'id')::uuid
from dblink('b', $q$select public.worker_notify_claim('wb', 10, 120)$q$) as t (c jsonb), jsonb_array_elements(t.c) x;
select dblink_exec('a', 'commit');

do $$
begin
  assert (select count(*) from claims where worker = 'a') = 10, 'first worker claimed a batch';
  assert (select count(*) from claims where worker = 'b') > 0, 'second worker claimed another batch while the first held its own';
  assert not exists (select id from claims where worker = 'a' intersect select id from claims where worker = 'b'),
    'no message given to both';
  assert (select count(*) from dblink('admin',
            $q$select locked_by from private.notification_deliveries where status = 'sending'$q$) as t (locked_by text)
          where locked_by not in ('wa', 'wb')) = 0, 'every lease belongs to one of them';
end
$$;

-- Put everything back as the seed left it.
select dblink_exec('admin', $q$
  delete from private.notification_deliveries;
  update private.outbox_jobs set status = 'pending', attempts = 0, done_at = null, last_error = null
  where consumer = 'notify';
$q$);
do $$
begin
  assert (select count(*) from pending_jobs) = (select count(*) from private.outbox_jobs where status = 'pending'),
    'restored';
end
$$;

select dblink_disconnect('a');
select dblink_disconnect('b');
select dblink_disconnect('admin');
rollback;
