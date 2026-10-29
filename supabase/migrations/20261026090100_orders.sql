-- Stage 2, part 2: orders, the garments in them, and what each order is waiting for.
-- The statuses, the moves between them and the reasons are in docs/capture.md and decisions 0018 to 0020.
--
-- The table is called `orders` because `order` is a reserved word in SQL.

-- Today as she sees it, for the few rules that depend on the date. Runs with the caller's rights.
create function app.today_for(p_owner uuid) returns date
language sql stable
set search_path = ''
as $$
  select coalesce(
    (select (now() at time zone p.timezone)::date from public.profile p where p.owner_id = p_owner),
    current_date
  );
$$;

-- The one table of allowed moves between order statuses. The screen's buttons come from the same table
-- (src/domain/orders/status.ts) and a test compares the two over every pair of statuses.
create function app.order_move_allowed(p_from text, p_to text) returns boolean
language sql immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('draft', 'active'),
    ('draft', 'cancelled'),
    ('active', 'on_hold'),
    ('active', 'delivered'),
    ('active', 'cancelled'),
    ('on_hold', 'active'),
    ('on_hold', 'cancelled'),
    ('delivered', 'active'),
    ('cancelled', 'draft')
  );
$$;

-- ---------------------------------------------------------------------------------------------
-- Orders

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Given by the database (her next number) unless she types one when the order is made.
  number integer not null check (number > 0),
  client_id uuid not null,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'on_hold', 'delivered', 'cancelled')),
  delivery_on date not null check (delivery_on between date '2000-01-01' and date '2099-12-31'),
  buffer_days smallint not null default 2 check (buffer_days between 0 and 30),
  hold_reason text not null default '' check (hold_reason = btrim(hold_reason) and char_length(hold_reason) <= 300),
  cancel_reason text not null default '' check (cancel_reason = btrim(cancel_reason) and char_length(cancel_reason) <= 300),
  delivered_on date,
  notes text not null default '' check (char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_owner_id_key unique (owner_id, id),
  constraint orders_number_key unique (owner_id, number),
  constraint orders_client_fk foreign key (owner_id, client_id)
    references public.client (owner_id, id) on delete restrict,
  -- What belongs to a status is present exactly when the order has that status.
  constraint orders_hold_reason_matches check ((status = 'on_hold') = (hold_reason <> '')),
  constraint orders_cancel_reason_matches check (cancel_reason = '' or status = 'cancelled'),
  constraint orders_delivered_on_matches check ((status = 'delivered') = (delivered_on is not null))
);
comment on table public.orders is
  'A promise to one client. Only active orders are planned. See docs/capture.md for the statuses.';
create index orders_by_status_and_date on public.orders (owner_id, status, delivery_on);
create index orders_by_client on public.orders (owner_id, client_id);

create function app.orders_before_insert() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'draft' then
    raise exception 'a new order starts as a draft' using errcode = '23514';
  end if;
  if new.number is null then
    select coalesce(max(o.number), 0) + 1 into new.number
    from public.orders o where o.owner_id = new.owner_id;
  end if;
  return new;
end;
$$;
create trigger orders_before_insert before insert on public.orders
  for each row execute function app.orders_before_insert();

create function app.orders_before_update() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  today date := app.today_for(new.owner_id);
begin
  -- A delivered or cancelled order is a record. Only its notes may change; to change anything else she
  -- reopens it first. Comparing the whole row means a column added later is frozen unless listed here.
  if old.status in ('delivered', 'cancelled') and new.status = old.status
     and (to_jsonb(new) - 'notes' - 'updated_at') <> (to_jsonb(old) - 'notes' - 'updated_at') then
    raise exception 'a % order can only have its notes changed; reopen it first', old.status
      using errcode = '23514';
  end if;

  if new.status <> old.status then
    if not app.order_move_allowed(old.status, new.status) then
      raise exception 'an order cannot go from % to %', old.status, new.status using errcode = '23514';
    end if;

    -- Leaving a status clears what belonged to it. (What the new status needs is checked by the table.)
    if old.status = 'on_hold' then new.hold_reason := ''; end if;
    if old.status = 'cancelled' then new.cancel_reason := ''; end if;
    if old.status = 'delivered' then new.delivered_on := null; end if;

    if new.status = 'active' then
      if new.delivery_on < today then
        raise exception 'the handover day has passed; choose a new one' using errcode = '23514';
      end if;
      if not exists (
        select 1 from public.order_item i where i.owner_id = new.owner_id and i.order_id = new.id
      ) then
        raise exception 'an order needs at least one garment before it is confirmed' using errcode = '23514';
      end if;
    end if;

    if new.status = 'delivered' and new.delivered_on > today then
      raise exception 'an order cannot be delivered in the future' using errcode = '23514';
    end if;
  elsif new.status = 'active' and new.delivery_on <> old.delivery_on and new.delivery_on < today then
    raise exception 'the handover day of an active order cannot be in the past' using errcode = '23514';
  end if;

  return new;
end;
$$;
create trigger orders_before_update before update on public.orders
  for each row execute function app.orders_before_update();

create trigger orders_updated_at before update on public.orders
  for each row execute function app.set_updated_at();

select app.secure_owner_table('public.orders');

-- The number and the owner never change, and an order is not deleted through the table: a draft is
-- removed by public.delete_draft_order(), and anything else is cancelled so its history stays.
revoke update on public.orders from authenticated;
grant update (client_id, status, delivery_on, buffer_days, hold_reason, cancel_reason, delivered_on, notes)
  on public.orders to authenticated;
revoke delete on public.orders from authenticated;

-- A delivered or cancelled order is a record. The order row is frozen by orders_before_update; this freezes what
-- hangs from it (garments, preparation, files) the same way, until she reopens the order. Used by those tables.
create function app.refuse_change_to_closed_order() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_owner uuid;
  v_order uuid;
begin
  if tg_op = 'DELETE' then
    v_owner := old.owner_id;
    v_order := old.order_id;
  else
    v_owner := new.owner_id;
    v_order := new.order_id;
  end if;
  -- When a whole order is being deleted its rows go too, and the order is no longer there to look at.
  if exists (
    select 1 from public.orders o
    where o.owner_id = v_owner and o.id = v_order and o.status in ('delivered', 'cancelled')
  ) then
    raise exception 'this order is delivered or cancelled; reopen it before changing it' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Garments. One garment per row; an order may have several.

create table public.order_item (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  order_id uuid not null,
  garment_type text not null check (garment_type = btrim(garment_type) and char_length(garment_type) between 1 and 80),
  brief text not null default '' check (char_length(brief) <= 4000),
  -- The version of the client's measurements this garment is made to. Empty until she has measured.
  measurement_set_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_item_owner_id_key unique (owner_id, id),
  constraint order_item_order_fk foreign key (owner_id, order_id)
    references public.orders (owner_id, id) on delete cascade,
  constraint order_item_measurements_fk foreign key (owner_id, measurement_set_id)
    references public.measurement_set (owner_id, id) on delete restrict
);
comment on table public.order_item is 'One garment. Its measurements are one saved version, never a live copy.';
create index order_item_by_order on public.order_item (owner_id, order_id);

-- The measurements must be this order's client's.
create function app.order_item_check_measurements() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.measurement_set_id is not null and not exists (
    select 1
    from public.measurement_set s
    join public.orders o on o.owner_id = s.owner_id and o.client_id = s.client_id
    where s.owner_id = new.owner_id and s.id = new.measurement_set_id and o.id = new.order_id
  ) then
    raise exception 'those measurements belong to a different client' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger order_item_check_measurements before insert or update on public.order_item
  for each row execute function app.order_item_check_measurements();

create trigger order_item_updated_at before update on public.order_item
  for each row execute function app.set_updated_at();

create trigger order_item_closed before insert or update or delete on public.order_item
  for each row execute function app.refuse_change_to_closed_order();

-- Changing the client of an order frees its garments from the old client's measurements.
create function app.orders_client_changed() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.order_item set measurement_set_id = null
  where owner_id = new.owner_id and order_id = new.id and measurement_set_id is not null;
  return null;
end;
$$;
create trigger orders_client_changed after update of client_id on public.orders
  for each row when (old.client_id is distinct from new.client_id)
  execute function app.orders_client_changed();

-- A confirmed or paused order always has a garment. Checked when the transaction ends, so a garment can be
-- swapped for another in one step, and so deleting a whole account (which removes orders and garments
-- together) is not blocked.
create function app.order_keeps_a_garment() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.orders o
    where o.owner_id = old.owner_id and o.id = old.order_id and o.status in ('active', 'on_hold')
  ) and not exists (
    select 1 from public.order_item i where i.owner_id = old.owner_id and i.order_id = old.order_id
  ) then
    raise exception 'a confirmed order needs at least one garment' using errcode = '23514';
  end if;
  return null;
end;
$$;
create constraint trigger order_keeps_a_garment after delete on public.order_item
  deferrable initially deferred
  for each row execute function app.order_keeps_a_garment();

select app.secure_owner_table('public.order_item');

revoke update on public.order_item from authenticated;
grant update (garment_type, brief, measurement_set_id) on public.order_item to authenticated;

-- ---------------------------------------------------------------------------------------------
-- What an order is waiting for. The engine reads state, expected_on and blocking (Stage 3).

create table public.prerequisite (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  order_id uuid not null,
  kind text not null check (kind in ('material', 'approval', 'measurements', 'other')),
  label text not null check (label = btrim(label) and char_length(label) between 1 and 120),
  state text not null default 'needed' check (state in ('needed', 'ordered', 'received')),
  expected_on date check (expected_on between date '2000-01-01' and date '2099-12-31'),
  -- A blocking item holds back the work that needs it. A non-blocking one is only a reminder.
  blocking boolean not null default true,
  note text not null default '' check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prerequisite_owner_id_key unique (owner_id, id),
  constraint prerequisite_order_fk foreign key (owner_id, order_id)
    references public.orders (owner_id, id) on delete cascade
);
comment on table public.prerequisite is
  'Fabric, lace, an approval, a booked measuring: something an order waits for. Which tasks need it comes in Stage 3.';
create index prerequisite_by_order on public.prerequisite (owner_id, order_id);

create trigger prerequisite_updated_at before update on public.prerequisite
  for each row execute function app.set_updated_at();

create trigger prerequisite_closed before insert or update or delete on public.prerequisite
  for each row execute function app.refuse_change_to_closed_order();

select app.secure_owner_table('public.prerequisite');

revoke update on public.prerequisite from authenticated;
grant update (kind, label, state, expected_on, blocking, note) on public.prerequisite to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Functions the screens call. Each does several steps in one transaction, so a mistake in a later step
-- never leaves the earlier ones behind.

-- Her latest measurements for a client, or null if she has none. The one place this is decided.
create function app.latest_measurement_set(p_client uuid) returns uuid
language sql stable
set search_path = ''
as $$
  select s.id from public.measurement_set s
  where s.client_id = p_client and s.owner_id = (select auth.uid())
  order by s.version desc limit 1;
$$;

-- Makes an order with its first garment. The client is an existing one, or made from a name. Returns the order's id.
-- p_number is optional (her next number is used). p_confirm makes it active at once.
create function public.create_order(
  p_client_id uuid,
  p_client_name text,
  p_client_phone text,
  p_number integer,
  p_delivery_on date,
  p_buffer_days integer,
  p_notes text,
  p_garment_type text,
  p_brief text,
  p_confirm boolean
) returns uuid
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_client uuid := p_client_id;
  v_order uuid;
begin
  if v_client is null then
    insert into public.client (name, phone) values (p_client_name, coalesce(p_client_phone, ''))
    returning id into v_client;
  end if;

  insert into public.orders (number, client_id, delivery_on, buffer_days, notes)
  values (p_number, v_client, p_delivery_on,
          coalesce(p_buffer_days, (select default_buffer_days from public.profile)),
          coalesce(p_notes, ''))
  returning id into v_order;

  insert into public.order_item (order_id, garment_type, brief, measurement_set_id)
  values (v_order, p_garment_type, coalesce(p_brief, ''), app.latest_measurement_set(v_client));

  if p_confirm then
    update public.orders set status = 'active' where id = v_order;
  end if;
  return v_order;
end;
$$;
revoke all on function public.create_order(uuid, text, text, integer, date, integer, text, text, text, boolean)
  from public, anon;
grant execute on function public.create_order(uuid, text, text, integer, date, integer, text, text, text, boolean)
  to authenticated;

-- Adds a garment to an order, made to the client's latest measurements.
create function public.add_garment(p_order_id uuid, p_garment_type text, p_brief text) returns uuid
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_item uuid;
  v_client uuid;
begin
  select o.client_id into v_client from public.orders o where o.id = p_order_id;
  if v_client is null then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  insert into public.order_item (order_id, garment_type, brief, measurement_set_id)
  values (p_order_id, p_garment_type, coalesce(p_brief, ''), app.latest_measurement_set(v_client))
  returning id into v_item;
  return v_item;
end;
$$;
revoke all on function public.add_garment(uuid, text, text) from public, anon;
grant execute on function public.add_garment(uuid, text, text) to authenticated;

-- Deletes an order that is still a draft, with its garments and preparation. Any other order is cancelled
-- instead, so its history stays. Runs with the owner's rights because the table does not allow deletes,
-- so it checks for itself that the order is hers.
create function public.delete_draft_order(p_order_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.orders o
  where o.id = p_order_id and o.owner_id = (select auth.uid()) and o.status = 'draft';
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    raise exception 'only one of your own draft orders can be deleted' using errcode = '23514';
  end if;
end;
$$;
revoke all on function public.delete_draft_order(uuid) from public, anon;
grant execute on function public.delete_draft_order(uuid) to authenticated;
