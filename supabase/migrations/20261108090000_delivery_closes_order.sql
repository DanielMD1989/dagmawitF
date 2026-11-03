-- Ticking an order's Delivery step done finishes the order (decision 0089). The Delivery step is the handover, so
-- once it is done the order is delivered, that day: it leaves her active orders for their history, without a second
-- "Mark as finished". Here in the database, so it holds whichever screen or device ticks it.
--
-- Only an active order is finished this way: a draft or paused one cannot move to delivered (app.order_move_allowed).
-- A finished order's steps cannot be changed (orders' own rule), so the Delivery cannot be unticked while it is
-- finished: reopening is her own choice ("Reopen the order"), which asks
-- for a new day when the old one has passed.
--
-- Released before the app that uses it (decision 0082): the live app keeps working; it only sees such an order as
-- finished sooner.

create function app.task_delivered() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.order_id is not null
     and new.done_on is not null and old.done_on is null
     and lower(btrim(new.title)) = 'delivery' then
    update public.orders o
    set status = 'delivered', delivered_on = new.done_on
    where o.owner_id = new.owner_id and o.id = new.order_id and o.status = 'active';
  end if;
  return null;
end;
$$;
-- Named to run after task_log (triggers fire by name): the history says the Delivery was done, then the order finished.
create trigger task_then_finish_order after update of done_on on public.task
  for each row execute function app.task_delivered();

-- Orders handed over before this: their Delivery step is ticked done, yet they were left active. Finished on the day
-- their Delivery was ticked.
update public.orders o
set status = 'delivered', delivered_on = d.done_on
from (
  select distinct on (t.order_id) t.order_id, t.done_on
  from public.task t
  where t.order_id is not null and t.done_on is not null and lower(btrim(t.title)) = 'delivery'
  order by t.order_id, t.done_on desc
) d
where o.id = d.order_id and o.status = 'active';

create or replace function app.schema_version() returns text
language sql immutable
set search_path = ''
as $$ select '20261108090000'::text $$;
