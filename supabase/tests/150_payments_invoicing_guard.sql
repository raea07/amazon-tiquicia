-- The per-request check (check_request, decision 23) and the new functions
-- of payments (083400), invoicing (083500), the invoicing fixes (083510),
-- seller listings (083600), the native apps' consent source (083900) and the
-- console's operations tools (084000).
--
-- None of them is on the check's short list of what a password-only session
-- of an account with a second factor may call: the shopper's payment and
-- documents, and finance's screens, wait for the second step like everything
-- else. The workers' functions are called with a server key, which has no
-- user id: the check lets those through and the grants decide (110_lockdown
-- keeps them to the service_role).

begin;
\ir _helpers.sql

insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
select gen_random_uuid(), u.id, 'x', 'totp', 'verified', now(), now(), 'JBSWY3DPEHPK3PXP'
from auth.users u where u.email = 'comprador@yuntera.example';

select pg_temp.login('comprador@yuntera.example', 'aal1');
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    -- payments
    'order_payment', 'start_payment', 'payment_returned', 'ops_payment_reviews',
    'ops_resolve_payment_review', 'ops_gateway_refunds', 'ops_retry_gateway_refund',
    'ops_record_refund_transfer', 'ops_record_payment_fee', 'ops_payments',
    'ops_payment_reconciliation', 'ops_payment_settings', 'ops_set_payments_mode',
    'ops_set_expected_gateway_fee',
    -- invoicing
    'my_order_invoices', 'invoice_detail', 'invoice_file', 'seller_fee_invoices',
    'set_checkout_invoice_receiver', 'ops_invoices', 'ops_invoice_replace', 'ops_invoice_retry',
    -- what the invoicing screens may say (083510)
    'ops_invoicing_state', 'my_order_invoicing',
    -- seller listings, the shop's face and paused offers (083600)
    'seller_catalog_search', 'seller_add_offer', 'seller_set_variant_active', 'seller_unpublish_listing',
    'seller_paused_offers', 'seller_request_shop_description', 'seller_shop_front', 'seller_reserve_logo',
    'seller_finish_logo', 'seller_withdraw_logo', 'seller_remove_logo', 'ops_logos_for_review',
    'ops_review_logo', 'ops_logo_files_to_publish', 'ops_confirm_logo_published', 'get_shop',
    'cart_alternatives',
    -- the notification settings, recreated with the consent source (083900)
    'set_my_notification_settings', 'seller_set_notification_settings',
    -- the operations tools (084000), and the shop's reads they redefined
    'ops_delivery_zones', 'ops_create_zone', 'ops_update_zone', 'ops_set_zone_active', 'ops_delete_zone',
    'ops_district_cantons', 'ops_canton_districts', 'ops_district_move_preview', 'ops_move_districts',
    'ops_holidays', 'ops_add_holiday', 'ops_remove_holiday', 'ops_zone_closures', 'ops_open_zone_closure',
    'ops_change_zone_closure_end', 'ops_end_zone_closure', 'ops_settings', 'ops_update_setting',
    'ops_warehouse_locations', 'ops_create_location', 'ops_rename_location', 'ops_set_location_active',
    'ops_open_routes', 'ops_remove_route_stop', 'ops_close_route', 'my_addresses', 'checkout_quote',
    'seller_save_location',
    -- the workers' own, if a signed-in token ever reached them
    'worker_payments_claim', 'worker_payments_event', 'worker_payments_hello', 'worker_payments_report',
    'worker_invoice_claim', 'worker_invoice_health', 'worker_invoice_hint', 'worker_invoice_plan',
    'worker_invoice_record', 'worker_invoice_signed'] loop
    perform set_config('request.path', '/rpc/' || v_fn, true);
    begin
      perform public.check_request();
      raise exception 'before_second_step: % passed the check at aal1', v_fn;
    exception when others then
      if sqlerrm <> 'second_factor_required' then raise; end if;
    end;
  end loop;
end
$$;
reset role;

-- After the second step, the shopper's own functions pass the check.
select pg_temp.login('comprador@yuntera.example', 'aal2');
do $$
begin
  perform set_config('request.path', '/rpc/my_order_invoices', true);
  perform public.check_request();
  perform set_config('request.path', '/rpc/order_payment', true);
  perform public.check_request();
  perform set_config('request.path', '/rpc/my_order_invoicing', true);
  perform public.check_request();
  perform set_config('request.path', '/rpc/set_my_notification_settings', true);
  perform public.check_request();
end
$$;
reset role;

-- The workers' server key: no user id, so the check returns at once.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
begin
  perform set_config('request.path', '/rpc/worker_payments_event', true);
  perform public.check_request();
  perform set_config('request.path', '/rpc/worker_invoice_plan', true);
  perform public.check_request();
end
$$;

select 'ok' as payments_invoicing_guard;
rollback;
