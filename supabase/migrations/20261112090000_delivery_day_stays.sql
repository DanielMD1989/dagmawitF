-- An order's Delivery stays on the day she promised (decision 0101).
--
-- Unfinished steps whose day has passed move to her today (decision 0080), and since the Delivery became a step
-- (decision 0096) it moved with them; its day is the order's day, so a late order's delivery day became today, every
-- day, by itself. A late order never looked late, and once delivered it said "on time" (three of hers, due Fri 6 Nov,
-- were moved to Sat 7 Nov this way). The day is a promise to her client: it is changed only by her. A late Delivery
-- now stays where it was, under "Not done yet", until she delivers it or gives it a new day.
--
-- Released before the app (decision 0082): the live app is unchanged by it.

create or replace function public.carry_over() returns integer
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_today date := app.today_for((select app.workspace()));
  v_moved integer;
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  update public.task t
  set moved_from = coalesce(t.moved_from, coalesce(t.until_day, t.on_day)),
      on_day = v_today,
      until_day = null
  where t.done_on is null
    and t.on_day is not null
    and coalesce(t.until_day, t.on_day) < v_today
    and (t.order_id is null
      or exists (select 1 from public.orders o
                 where o.id = t.order_id and o.status = 'active'
                   -- A client's Delivery is her promised day: it is not moved for her.
                   and not (o.client_id is not null and app.is_delivery(t.title))));
  get diagnostics v_moved = row_count;
  return v_moved;
end;
$$;

-- A Delivery already moved this way on an order now paused or a draft goes back to the day she gave, and the order's
-- day with it (app.task_delivery_day); one she changed herself has no `moved_from` (changing a step clears it) and
-- stays. On an active order it stays where it is: an active order's day is never set to one that has passed (the
-- orders' own rule), and its step says "Moved from" the day it was promised.
update public.task t
set on_day = t.moved_from, until_day = null, moved_from = null
from public.orders o
where o.id = t.order_id and o.owner_id = t.owner_id
  and o.client_id is not null
  and o.status in ('draft', 'on_hold')
  and app.is_delivery(t.title)
  and t.done_on is null
  and t.moved_from is not null;

create or replace function app.schema_version() returns text
language sql immutable
set search_path = ''
as $$ select '20261112090000'::text $$;
