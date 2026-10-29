-- Stage 2, part 3: sketches and photos (kept private), and the history of what happened to an order.
-- See docs/capture.md and decisions 0020, 0022 and 0023.

-- ---------------------------------------------------------------------------------------------
-- Sketches and photos. The file is in private storage; this row says whose it is and what it shows.

create table public.attachment (
  -- The id is chosen before the file is stored, because the file's path contains it.
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  order_id uuid not null,
  kind text not null check (kind in ('sketch', 'inspiration', 'fabric', 'fitting', 'other')),
  caption text not null default '' check (caption = btrim(caption) and char_length(caption) <= 200),
  -- Sketch 1, Sketch 2: counted per order and kind by the database, so a revised sketch keeps the first.
  version integer not null check (version > 0),
  storage_path text not null,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  created_at timestamptz not null default now(),
  constraint attachment_owner_id_key unique (owner_id, id),
  constraint attachment_path_key unique (storage_path),
  constraint attachment_order_fk foreign key (owner_id, order_id)
    references public.orders (owner_id, id) on delete cascade,
  -- <her id>/<order id>/<this row's id>.<jpg|png|webp>: a row can only point at its own file, in her folder.
  constraint attachment_path_is_hers check (
    storage_path ~ ('^' || owner_id::text || '/' || order_id::text || '/' || id::text || '\.(jpg|png|webp)$')
  )
);
comment on table public.attachment is 'A sketch or photo of an order. The file is in the private bucket order-files.';
create index attachment_by_order on public.attachment (owner_id, order_id, kind, version);

create function app.attachment_before_insert() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.attachment a where a.owner_id = new.owner_id and a.order_id = new.order_id) >= 40 then
    raise exception 'an order can have at most 40 sketches and photos' using errcode = '23514';
  end if;
  select coalesce(max(a.version), 0) + 1 into new.version
  from public.attachment a
  where a.owner_id = new.owner_id and a.order_id = new.order_id and a.kind = new.kind;
  return new;
end;
$$;
create trigger attachment_before_insert before insert on public.attachment
  for each row execute function app.attachment_before_insert();

create trigger attachment_closed before insert or update or delete on public.attachment
  for each row execute function app.refuse_change_to_closed_order();

select app.secure_owner_table('public.attachment');

-- Only the caption can change. A different picture is a new row.
revoke update on public.attachment from authenticated;
grant update (caption) on public.attachment to authenticated;

-- The private bucket. Nothing in it is ever public; pages reach a file through /files/<id>, which
-- hands out a link that lasts a minute. Five megabytes, images only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('order-files', 'order-files', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- A signed-in designer can use only the folder named after her own id.
create policy "order files: her folder, read" on storage.objects for select to authenticated
  using (bucket_id = 'order-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "order files: her folder, add" on storage.objects for insert to authenticated
  with check (bucket_id = 'order-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "order files: her folder, change" on storage.objects for update to authenticated
  using (bucket_id = 'order-files' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'order-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "order files: her folder, remove" on storage.objects for delete to authenticated
  using (bucket_id = 'order-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------------------------
-- History. Written only by the triggers below: a screen cannot forget to log a change, and the log
-- cannot be edited. A row is a code and a few facts; the words are made in src/domain/orders/history.ts.

-- The one list of event codes. A test compares it with the screen's list.
create function app.history_actions() returns text[]
language sql immutable
set search_path = ''
as $$
  select array[
    'order_created', 'status_changed', 'delivery_changed', 'buffer_changed', 'client_changed',
    'garment_added', 'garment_changed', 'garment_removed', 'garment_measurements',
    'prerequisite_added', 'prerequisite_state', 'prerequisite_date', 'prerequisite_blocking',
    'prerequisite_removed',
    'file_added', 'file_removed',
    'measurements_recorded'
  ];
$$;

create table public.activity_log (
  -- Gives a stable order to events that happen in the same instant.
  seq bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- An event is about one order or, for new measurements, one client.
  order_id uuid,
  client_id uuid,
  action text not null check (action = any (app.history_actions())),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  at timestamptz not null default clock_timestamp(),
  constraint activity_log_about_one_thing check (num_nonnulls(order_id, client_id) = 1),
  constraint activity_log_order_fk foreign key (owner_id, order_id)
    references public.orders (owner_id, id) on delete cascade,
  constraint activity_log_client_fk foreign key (owner_id, client_id)
    references public.client (owner_id, id) on delete cascade
);
comment on table public.activity_log is 'Append only. Written by triggers, never through the API.';
create index activity_log_by_order on public.activity_log (owner_id, order_id, seq desc);
create index activity_log_by_client on public.activity_log (owner_id, client_id, seq desc);

select app.secure_owner_table('public.activity_log');
revoke insert, update, delete on public.activity_log from authenticated;

create function app.log_event(p_owner uuid, p_order uuid, p_client uuid, p_action text, p_details jsonb)
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.activity_log (owner_id, order_id, client_id, action, details)
  values (p_owner, p_order, p_client, p_action, p_details);
$$;
revoke all on function app.log_event(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;

-- Orders ----------------------------------------------------------------------------------------

create function app.orders_log_insert() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.log_event(new.owner_id, new.id, null, 'order_created',
    jsonb_build_object('number', new.number, 'delivery_on', new.delivery_on));
  return null;
end;
$$;
create trigger orders_log_insert after insert on public.orders
  for each row execute function app.orders_log_insert();

create function app.orders_log_update() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_from text;
  v_to text;
begin
  if new.status <> old.status then
    perform app.log_event(new.owner_id, new.id, null, 'status_changed', jsonb_strip_nulls(jsonb_build_object(
      'from', old.status,
      'to', new.status,
      'reason', nullif(case new.status when 'on_hold' then new.hold_reason when 'cancelled' then new.cancel_reason end, ''),
      'delivered_on', new.delivered_on
    )));
  end if;
  if new.delivery_on <> old.delivery_on then
    perform app.log_event(new.owner_id, new.id, null, 'delivery_changed',
      jsonb_build_object('from', old.delivery_on, 'to', new.delivery_on));
  end if;
  if new.buffer_days <> old.buffer_days then
    perform app.log_event(new.owner_id, new.id, null, 'buffer_changed',
      jsonb_build_object('from', old.buffer_days, 'to', new.buffer_days));
  end if;
  if new.client_id <> old.client_id then
    -- Names, not ids: the old client may be deleted later, and the history must still read.
    select c.name into v_from from public.client c where c.owner_id = new.owner_id and c.id = old.client_id;
    select c.name into v_to from public.client c where c.owner_id = new.owner_id and c.id = new.client_id;
    perform app.log_event(new.owner_id, new.id, null, 'client_changed',
      jsonb_build_object('from', v_from, 'to', v_to));
  end if;
  return null;
end;
$$;
create trigger orders_log_update after update on public.orders
  for each row execute function app.orders_log_update();

-- Garments --------------------------------------------------------------------------------------

create function app.order_item_log() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_from integer;
  v_to integer;
begin
  if tg_op = 'INSERT' then
    perform app.log_event(new.owner_id, new.order_id, null, 'garment_added',
      jsonb_build_object('garment_type', new.garment_type));
  elsif tg_op = 'DELETE' then
    -- When the whole order is being deleted its garments go too, and there is no order left to log against.
    if exists (select 1 from public.orders o where o.owner_id = old.owner_id and o.id = old.order_id) then
      perform app.log_event(old.owner_id, old.order_id, null, 'garment_removed',
        jsonb_build_object('garment_type', old.garment_type));
    end if;
  else
    if new.garment_type <> old.garment_type or new.brief <> old.brief then
      perform app.log_event(new.owner_id, new.order_id, null, 'garment_changed',
        jsonb_build_object('garment_type', new.garment_type, 'was', old.garment_type));
    end if;
    if new.measurement_set_id is distinct from old.measurement_set_id and new.measurement_set_id is not null then
      select s.version into v_from from public.measurement_set s where s.owner_id = old.owner_id and s.id = old.measurement_set_id;
      select s.version into v_to from public.measurement_set s where s.owner_id = new.owner_id and s.id = new.measurement_set_id;
      perform app.log_event(new.owner_id, new.order_id, null, 'garment_measurements',
        jsonb_strip_nulls(jsonb_build_object('garment_type', new.garment_type, 'from', v_from, 'to', v_to)));
    end if;
  end if;
  return null;
end;
$$;
create trigger order_item_log after insert or update or delete on public.order_item
  for each row execute function app.order_item_log();

-- Preparation -----------------------------------------------------------------------------------

create function app.prerequisite_log() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.log_event(new.owner_id, new.order_id, null, 'prerequisite_added',
      jsonb_build_object('label', new.label, 'kind', new.kind));
  elsif tg_op = 'DELETE' then
    if exists (select 1 from public.orders o where o.owner_id = old.owner_id and o.id = old.order_id) then
      perform app.log_event(old.owner_id, old.order_id, null, 'prerequisite_removed',
        jsonb_build_object('label', old.label));
    end if;
  else
    if new.state <> old.state then
      perform app.log_event(new.owner_id, new.order_id, null, 'prerequisite_state',
        jsonb_build_object('label', new.label, 'kind', new.kind, 'from', old.state, 'to', new.state));
    end if;
    if new.expected_on is distinct from old.expected_on then
      perform app.log_event(new.owner_id, new.order_id, null, 'prerequisite_date',
        jsonb_strip_nulls(jsonb_build_object('label', new.label, 'from', old.expected_on, 'to', new.expected_on)));
    end if;
    if new.blocking <> old.blocking then
      perform app.log_event(new.owner_id, new.order_id, null, 'prerequisite_blocking',
        jsonb_build_object('label', new.label, 'blocking', new.blocking));
    end if;
  end if;
  return null;
end;
$$;
create trigger prerequisite_log after insert or update or delete on public.prerequisite
  for each row execute function app.prerequisite_log();

-- Files and measurements -------------------------------------------------------------------------

create function app.attachment_log() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.log_event(new.owner_id, new.order_id, null, 'file_added',
      jsonb_build_object('kind', new.kind, 'version', new.version, 'caption', new.caption));
  elsif exists (select 1 from public.orders o where o.owner_id = old.owner_id and o.id = old.order_id) then
    perform app.log_event(old.owner_id, old.order_id, null, 'file_removed',
      jsonb_build_object('kind', old.kind, 'version', old.version, 'caption', old.caption));
  end if;
  return null;
end;
$$;
create trigger attachment_log after insert or delete on public.attachment
  for each row execute function app.attachment_log();

create function app.measurement_set_log() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.log_event(new.owner_id, null, new.client_id, 'measurements_recorded',
    jsonb_build_object('version', new.version, 'taken_on', new.taken_on));
  return null;
end;
$$;
create trigger measurement_set_log after insert on public.measurement_set
  for each row execute function app.measurement_set_log();
