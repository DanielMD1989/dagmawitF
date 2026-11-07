-- Putting an order on hold no longer needs a reason (decision 0099). She paused an order, left "Why is it on hold?"
-- empty, and it was refused: it stayed active while she thought it paused. A reason is kept when she gives one, and
-- only while the order is on hold.
--
-- Released before the app (decision 0082): the live app still asks for a reason, which this allows as before.

alter table public.orders drop constraint orders_hold_reason_matches;
alter table public.orders
  add constraint orders_hold_reason_only_on_hold check (status = 'on_hold' or hold_reason = '');

create or replace function app.schema_version() returns text
language sql immutable
set search_path = ''
as $$ select '20261111090000'::text $$;
