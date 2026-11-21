-- What the first hosted project showed, after the seed and the test suites.
--
-- The performance advisor lists 46 foreign keys without a covering index. Most
-- point at small reference tables (districts, cantons, zones, fee schedules) or
-- at rows that are never deleted, where an index would only cost writes. These
-- seven sit on a path the application queries, or on a table a parent delete
-- has to scan; the rest are accepted (docs/07-deployment/runbook-first-deploy.md,
-- step 4).
--
-- No access-control difference was found: grants, row-level security, policies,
-- owners and default privileges compare equal between a local build and the
-- hosted project, and every suite in supabase/tests passes on both.

-- Joined on order items when a seller lists their sales (seller_order_lines)
-- and when a packed shipment releases its reservations.
create index shipment_items_order_item_idx on public.shipment_items (order_item_id);

-- Read for every line of an order page (get_order) and checked before a
-- return is opened (request_return).
create index return_requests_order_item_idx on public.return_requests (order_item_id);

-- Looked up for every seller of every order posted to the ledger, and for the
-- seller's balance (seller_overview).
create index ledger_accounts_seller_idx on public.ledger_accounts (seller_id);

-- A seller's stock page (seller_stock) filters on the seller alone; the primary
-- key starts with the warehouse.
create index stock_levels_seller_idx on public.stock_levels (seller_id);

-- Deleting an account (the right to erasure under Ley 8968) has to check every
-- table that refers to it. The first two grow with every order and stock
-- change, the third with every delivery.
create index order_events_actor_idx on public.order_events (actor_id);
create index stock_movements_actor_idx on public.stock_movements (actor_id);
create index reviews_user_idx on public.reviews (user_id);
