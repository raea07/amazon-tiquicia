-- The native apps save channels and the commercial consent in one call, as
-- the websites do, but the consent log must record where it was given. The
-- settings functions hard-coded the website's account page ('web_cuenta',
-- 'seller_cuenta'), so a consent given in the shopper or seller app was
-- logged as given on the website. They now take an optional p_source,
-- limited to the places each audience can give it from; leaving it out keeps
-- the website's value, so the websites need no change.
--
-- Adding an argument changes the signature: the old function is dropped and
-- the new one granted again, so there is never more than one to choose from.

drop function public.set_my_notification_settings(boolean, boolean, boolean, boolean, text, boolean, text, bigint);

create function public.set_my_notification_settings(
  p_email boolean,
  p_whatsapp boolean,
  p_sms boolean,
  p_push boolean,
  p_phone text default null,
  p_commercial boolean default null,
  p_text_version text default null,
  p_version bigint default null,
  p_source text default 'web_cuenta'
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    perform private.fail('not_authenticated');
  end if;
  if p_source is null or p_source not in ('web_cuenta', 'shop_app') then
    perform private.fail('notify_consent_invalid');
  end if;
  perform private.save_channels((select auth.uid()), null, p_email, p_whatsapp, p_sms, p_push, p_phone,
    p_version);
  if p_commercial is not null then
    perform private.save_commercial((select auth.uid()), null, p_commercial, p_text_version, p_source);
  end if;
  return public.my_notification_settings();
end;
$$;

drop function public.seller_set_notification_settings(uuid, boolean, boolean, text, boolean, text, bigint);

create function public.seller_set_notification_settings(
  p_seller_id uuid,
  p_whatsapp boolean,
  p_push boolean,
  p_phone text default null,
  p_commercial boolean default null,
  p_text_version text default null,
  p_version bigint default null,
  p_source text default 'seller_cuenta'
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
  if p_source is null or p_source not in ('seller_cuenta', 'seller_app') then
    perform private.fail('notify_consent_invalid');
  end if;
  perform private.save_channels(null, p_seller_id, true, p_whatsapp, false, p_push, p_phone, p_version);
  if p_commercial is not null then
    perform private.save_commercial(null, p_seller_id, p_commercial, p_text_version, p_source);
  end if;
  return public.seller_notification_settings(p_seller_id);
end;
$$;

revoke execute on function
  public.set_my_notification_settings(boolean, boolean, boolean, boolean, text, boolean, text, bigint, text),
  public.seller_set_notification_settings(uuid, boolean, boolean, text, boolean, text, bigint, text)
from public, anon, service_role;
grant execute on function
  public.set_my_notification_settings(boolean, boolean, boolean, boolean, text, boolean, text, bigint, text),
  public.seller_set_notification_settings(uuid, boolean, boolean, text, boolean, text, bigint, text)
to authenticated;
