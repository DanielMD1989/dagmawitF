-- Every customer order has its Delivery as a step (decision 0096). The delivery was a step only when she gave it a
-- time when taking the order; otherwise it was a date, with nothing to tick: "Next: Delivery" with no way to say it
-- was done but "Mark as finished" on the order's page. Now each customer order has one Delivery step, on its
-- delivery day, kept so here in the database:
--   - a new customer order gets it; an event does not (an event is not delivered);
--   - the order's delivery day and its Delivery step's day are one: changing either moves the other;
--   - ticking it finishes the order (decision 0089); finishing the order ticks it; reopening unticks it;
--   - it cannot be removed or renamed, and an order has no second one ("Delivery" added again is the same one).
--
-- Released before the app (decision 0082): the live app keeps working. It adds a "Delivery" step for an order with a
-- delivery time; that now becomes the time of the order's own Delivery step instead of a second one.

create function app.is_delivery(p_title text) returns boolean
language sql immutable
set search_path = ''
as $$ select lower(btrim(p_title)) = 'delivery' $$;

-- The Delivery is always last on its order's steps: the highest place there is.
create function app.delivery_sort() returns integer language sql immutable set search_path = '' as $$ select 100000 $$;

-- A new customer order gets its Delivery step, on its delivery day.
create function app.order_delivery_step() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.client_id is not null then
    insert into public.task (owner_id, order_id, title, on_day, sort)
    values (new.owner_id, new.id, 'Delivery', new.delivery_on, app.delivery_sort());
  end if;
  return null;
end;
$$;
create trigger orders_delivery_step after insert on public.orders
  for each row execute function app.order_delivery_step();

-- The order changed: its Delivery step follows. Reopened: unticked, on its (new) day. Finished: ticked that day.
create function app.order_delivery_sync() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.client_id is null then
    return null;
  end if;
  if old.status = 'delivered' and new.status <> 'delivered' then
    update public.task t set done_on = null
    where t.owner_id = new.owner_id and t.order_id = new.id and app.is_delivery(t.title) and t.done_on is not null;
  end if;
  -- The day follows while the order is open; a finished or cancelled order's steps are a record.
  if new.status in ('draft', 'active', 'on_hold')
     and (new.delivery_on is distinct from old.delivery_on or old.status = 'delivered') then
    update public.task t set on_day = new.delivery_on, until_day = null
    where t.owner_id = new.owner_id and t.order_id = new.id and app.is_delivery(t.title) and t.done_on is null
      and t.on_day is distinct from new.delivery_on;
  end if;
  if new.status = 'delivered' and old.status <> 'delivered' then
    update public.task t set done_on = new.delivered_on
    where t.owner_id = new.owner_id and t.order_id = new.id and app.is_delivery(t.title) and t.done_on is null;
  end if;
  return null;
end;
$$;
create trigger orders_delivery_sync after update of status, delivery_on on public.orders
  for each row execute function app.order_delivery_sync();

-- Her Delivery step changed: the order follows, and what the Delivery is stays.
create function app.task_delivery_rules() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  if tg_op = 'DELETE' then
    select * into v_order from public.orders o where o.owner_id = old.owner_id and o.id = old.order_id;
  else
    select * into v_order from public.orders o where o.owner_id = new.owner_id and o.id = new.order_id;
  end if;
  -- Her own work, an event's steps, or an order being deleted with its steps: none of this applies.
  if v_order.id is null or v_order.client_id is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if app.is_delivery(old.title) then
      raise exception 'an order’s Delivery cannot be removed; change its day, or cancel the order' using errcode = '23514';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' and app.is_delivery(new.title) then
    -- "Delivery" added again is the order's own Delivery: given its time, not made twice.
    if exists (select 1 from public.task t where t.order_id = new.order_id and app.is_delivery(t.title)) then
      update public.task t
      set starts_at = coalesce(new.starts_at, t.starts_at), ends_at = coalesce(new.ends_at, t.ends_at)
      where t.owner_id = new.owner_id and t.order_id = new.order_id and app.is_delivery(t.title) and t.done_on is null;
      return null;
    end if;
    new.sort := app.delivery_sort();
    return new;
  end if;

  -- Any other step comes before the Delivery: placed after the others when it would come at or after it.
  if tg_op = 'INSERT' and new.sort >= app.delivery_sort() then
    new.sort := least(app.delivery_sort() - 1, (
      select coalesce(max(t.sort), 0) + 10 from public.task t
      where t.order_id = new.order_id and not app.is_delivery(t.title)));
  end if;

  if tg_op = 'UPDATE' then
    if app.is_delivery(old.title) and not app.is_delivery(new.title) then
      raise exception 'an order’s Delivery keeps its name' using errcode = '23514';
    end if;
    if app.is_delivery(new.title) and not app.is_delivery(old.title) then
      raise exception 'this order has its Delivery already' using errcode = '23514';
    end if;
    if app.is_delivery(new.title) and new.done_on is null then
      if new.on_day is null or new.until_day is not null then
        raise exception 'an order’s Delivery is on one day, the delivery day' using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger task_delivery_rules before insert or update or delete on public.task
  for each row execute function app.task_delivery_rules();

-- Its day moved: the order's delivery day is that day (the order's own rules decide whether it may be).
create function app.task_delivery_day() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.order_id is not null and app.is_delivery(new.title) and new.done_on is null
     and new.on_day is distinct from old.on_day then
    update public.orders o set delivery_on = new.on_day
    where o.owner_id = new.owner_id and o.id = new.order_id and o.client_id is not null
      and o.delivery_on is distinct from new.on_day;
  end if;
  return null;
end;
$$;
create trigger task_delivery_day after update of on_day on public.task
  for each row execute function app.task_delivery_day();

-- A finished order's steps are not changed (the orders' own rule, written out here for the step table), except one
-- thing: its Delivery ticked as the order is finished, on the day it was finished, and nothing else of it.
create function app.task_closed() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_owner uuid := case when tg_op = 'DELETE' then old.owner_id else new.owner_id end;
  v_order_id uuid := case when tg_op = 'DELETE' then old.order_id else new.order_id end;
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders o where o.owner_id = v_owner and o.id = v_order_id;
  if v_order.status in ('delivered', 'cancelled') then
    if tg_op = 'UPDATE' and v_order.status = 'delivered' and app.is_delivery(new.title)
       and old.done_on is null and new.done_on = v_order.delivered_on
       and (to_jsonb(new) - 'done_on' - 'updated_at') = (to_jsonb(old) - 'done_on' - 'updated_at') then
      return new;
    end if;
    raise exception 'this order is delivered or cancelled; reopen it before changing it' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger task_closed on public.task;
create trigger task_closed before insert or update or delete on public.task
  for each row execute function app.task_closed();

-- The Delivery done and the order finished are one thing now: the history says "Finished" (status_changed), not
-- also "Done: Delivery". As in 20261107090000_part_done.sql otherwise.
create or replace function app.task_log() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.order_id is not null and new.done_on is not null and old.done_on is null then
    if not (app.is_delivery(new.title)
            and exists (select 1 from public.orders o where o.id = new.order_id and o.client_id is not null)) then
      perform app.log_event(new.owner_id, new.order_id, null, 'task_done',
        jsonb_build_object('title', new.title, 'done_on', new.done_on));
    end if;
  elsif new.order_id is not null and new.done_on is null and new.started_on is not null
    and (old.started_on is null or new.left_note is distinct from old.left_note) then
    perform app.log_event(new.owner_id, new.order_id, null, 'task_started',
      jsonb_strip_nulls(jsonb_build_object('title', new.title, 'left', new.left_note)));
  end if;
  return null;
end;
$$;

-- Moving an order's due day with its steps (move_due_day) moves the other steps: the Delivery follows the order's day
-- by itself (above), and moving it again would put it past the new day.
create or replace function public.move_due_day(p_order_id uuid, p_due_on date, p_move_steps boolean) returns integer
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_old date;
  v_moved integer := 0;
begin
  select o.delivery_on into v_old from public.orders o where o.id = p_order_id for update;
  if v_old is null then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  update public.orders set delivery_on = p_due_on where id = p_order_id;
  if p_move_steps and p_due_on <> v_old then
    update public.task k set
      on_day = k.on_day + (p_due_on - v_old),
      until_day = k.until_day + (p_due_on - v_old)
    where k.order_id = p_order_id and k.done_on is null and k.on_day is not null and not app.is_delivery(k.title);
    get diagnostics v_moved = row_count;
  end if;
  return v_moved;
end;
$$;

-- The morning summary (decision 0095) counts an order's Delivery step as a delivery: every customer order has one
-- now, so the orders due are its Delivery steps. As in 20261109090000_reminders.sql otherwise.
create or replace function app.claim_due_reminders(p_now timestamptz default now())
returns table (endpoint text, p256dh text, auth text, title text, body text, url text, tag text)
language plpgsql
set search_path = ''
as $$
declare
  w record;
  v_local timestamp;
  v_today date;
  v_lines text[];
  v_steps integer;
  v_deliveries integer;
  v_title text;
  s record;
begin
  -- Old notes go; a week is more than enough to know what was sent. One clock throughout: `p_now`.
  delete from app.reminder_sent r where r.sent_at < p_now - interval '7 days';

  -- Each workspace: an owner, with her clock. A person added to a workspace is reminded of its work, not her own.
  for w in
    select p.owner_id as id, p.timezone
    from public.profile p
    where not exists (select 1 from app.member m where m.user_id = p.owner_id)
      and exists (
        select 1 from app.push_subscription ps
        where ps.user_id = p.owner_id or ps.user_id in (select m.user_id from app.member m where m.owner_id = p.owner_id))
  loop
    v_local := p_now at time zone w.timezone;
    v_today := v_local::date;

    -- The morning summary: from 7:30 until 11:00, once a day (a timer that was down does not send it at night).
    if v_local::time >= app.reminder_morning() and v_local::time < time '11:00'
       and not exists (
         select 1 from app.reminder_sent r
         where r.workspace_id = w.id and r.kind = 'morning' and r.key = v_today::text) then
      insert into app.reminder_sent (workspace_id, kind, key, sent_at) values (w.id, 'morning', v_today::text, p_now);

      -- Today's steps not done, and earlier ones not done yet (they come to today when she opens the app), of her
      -- confirmed orders and her own work; timed ones first, by time.
      -- Today's steps not done, and earlier ones not done yet (they come to today when she opens the app), of her
      -- confirmed orders and her own work; timed ones first, by time. An order's Delivery step is a delivery.
      select count(*) filter (where not delivery)::int, count(*) filter (where delivery)::int,
             coalesce(array_agg(line order by late desc, starts_at nulls last, sort), '{}')
      into v_steps, v_deliveries, v_lines
      from (
        select t.starts_at, t.sort, coalesce(t.until_day, t.on_day) < v_today as late,
               app.is_delivery(t.title) and t.order_id is not null as delivery,
               concat_ws(' ',
                 to_char(t.starts_at, 'HH24:MI'),
                 t.title || coalesce(' · ' || app.whose(t.order_id), ''),
                 case when coalesce(t.until_day, t.on_day) < v_today then '(not done yet)' end) as line
        from public.task t
        where t.owner_id = w.id and t.done_on is null and t.on_day is not null and t.on_day <= v_today
          and (t.order_id is null
            or exists (select 1 from public.orders o where o.id = t.order_id and o.status = 'active'))
      ) x;

      if v_steps + v_deliveries > 0 then
        v_title := 'Today: ' || concat_ws(' · ',
          case when v_steps > 0 then v_steps || ' step' || case when v_steps = 1 then '' else 's' end end,
          case when v_deliveries > 0 then v_deliveries || ' deliver' || case when v_deliveries = 1 then 'y' else 'ies' end end);
        return query
          select ps.endpoint, ps.p256dh, ps.auth, v_title,
                 left(array_to_string(v_lines[1:4], E'\n')
                   || case when cardinality(v_lines) > 4 then E'\nand ' || (cardinality(v_lines) - 4) || ' more' else '' end, 300),
                 '/'::text,
                 -- Its own tag on the phone, so a later notification does not replace it.
                 'morning-' || v_today::text
          from app.push_subscription ps
          where ps.user_id = w.id or ps.user_id in (select m.user_id from app.member m where m.owner_id = w.id);
      end if;
    end if;

    -- An hour before each step with a time today, not done, of a confirmed order or her own work; once.
    for s in
      select t.id, t.title, t.starts_at, t.order_id
      from public.task t
      where t.owner_id = w.id and t.done_on is null and t.starts_at is not null
        and v_today between t.on_day and coalesce(t.until_day, t.on_day)
        and v_local::time >= t.starts_at - app.reminder_ahead() and v_local::time < t.starts_at
        and (t.order_id is null
          or exists (select 1 from public.orders o where o.id = t.order_id and o.status = 'active'))
        and not exists (
          select 1 from app.reminder_sent r
          where r.workspace_id = w.id and r.kind = 'step' and r.key = t.id::text || '/' || v_today::text)
      order by t.starts_at, t.sort
    loop
      insert into app.reminder_sent (workspace_id, kind, key, sent_at) values (w.id, 'step', s.id::text || '/' || v_today::text, p_now);
      return query
        select ps.endpoint, ps.p256dh, ps.auth,
               'At ' || to_char(s.starts_at, 'HH24:MI') || ' · ' || s.title,
               coalesce(app.whose(s.order_id), 'Your own'),
               case when s.order_id is null then '/' else '/orders/' || s.order_id end,
               'step-' || s.id::text
        from app.push_subscription ps
        where ps.user_id = w.id or ps.user_id in (select m.user_id from app.member m where m.owner_id = w.id);
    end loop;
  end loop;
end;
$$;
revoke all on function app.claim_due_reminders(timestamptz) from public, anon, authenticated;

-- Her orders as they are: each customer order in progress gets its Delivery, on its delivery day; one she had added
-- already is moved to that day if it was elsewhere, and last.
update public.task t set on_day = o.delivery_on, until_day = null, sort = app.delivery_sort()
from public.orders o
where o.id = t.order_id and o.client_id is not null and o.status in ('draft', 'active', 'on_hold')
  and app.is_delivery(t.title) and t.done_on is null;

insert into public.task (owner_id, order_id, title, on_day, sort)
select o.owner_id, o.id, 'Delivery', o.delivery_on, app.delivery_sort()
from public.orders o
where o.client_id is not null and o.status in ('draft', 'active', 'on_hold')
  and not exists (select 1 from public.task t where t.order_id = o.id and app.is_delivery(t.title));

create or replace function app.schema_version() returns text
language sql immutable
set search_path = ''
as $$ select '20261110090000'::text $$;
