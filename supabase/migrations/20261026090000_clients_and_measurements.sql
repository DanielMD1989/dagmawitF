-- Stage 2, part 1: her clients, her list of measurements, and each client's measurements over time.
-- The model and the reasons are in docs/capture.md and decisions 0019 to 0021.
--
-- Two rules shape every table here:
--   * Each parent has unique (owner_id, id) and each child references (owner_id, parent_id). A foreign key
--     check does not go through row-level security, so a plain reference could point at another designer's
--     row. This makes that impossible, not merely hidden.
--   * What must never be rewritten is protected by taking the right away (column grants), not by hoping
--     every screen behaves.

-- Two defaults she can change in Settings.
alter table public.profile
  add column default_buffer_days smallint not null default 2
    check (default_buffer_days between 0 and 30),
  add column measurement_unit text not null default 'cm'
    check (measurement_unit in ('cm', 'in'));
comment on column public.profile.default_buffer_days is
  'Days kept free before handover on a new order. Each order can differ.';
comment on column public.profile.measurement_unit is
  'The unit new measurements are taken in. Every saved measurement keeps the unit it was taken in.';

-- ---------------------------------------------------------------------------------------------
-- Clients

create table public.client (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (name = btrim(name) and char_length(name) between 1 and 120),
  phone text not null default '' check (phone = '' or phone ~ '^[0-9+() .-]{5,30}$'),
  notes text not null default '' check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_owner_id_key unique (owner_id, id)
);
comment on table public.client is 'Only what planning and a phone call need.';
create index client_name_idx on public.client (owner_id, lower(name));

create trigger client_updated_at before update on public.client
  for each row execute function app.set_updated_at();

select app.secure_owner_table('public.client');

-- ---------------------------------------------------------------------------------------------
-- Her list of measurements. A field is renamed or hidden, never deleted: old measurements use its key.

create table public.measurement_field (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null check (label = btrim(label) and char_length(label) between 1 and 60),
  sort integer not null default 0 check (sort between 0 and 10000),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint measurement_field_key_unique unique (owner_id, key)
);
comment on table public.measurement_field is
  'Her own list of measurements. The key never changes; the label and order can.';
-- Two visible fields with the same name would be impossible to tell apart on a form.
create unique index measurement_field_visible_label on public.measurement_field (owner_id, lower(label))
  where not archived;

create trigger measurement_field_updated_at before update on public.measurement_field
  for each row execute function app.set_updated_at();

select app.secure_owner_table('public.measurement_field');

-- The key is what saved measurements refer to, so only these columns can be changed.
revoke update on public.measurement_field from authenticated;
grant update (label, sort, archived) on public.measurement_field to authenticated;
revoke delete on public.measurement_field from authenticated;

-- Puts her visible measurements in the order given (the first gets the smallest number). It is one statement, so
-- it happens completely or not at all; a list that is not entirely her own visible fields changes nothing.
create function public.reorder_measurement_fields(p_ids uuid[]) returns void
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_changed integer;
begin
  update public.measurement_field f
  set sort = (o.n * 10)::integer
  from unnest(p_ids) with ordinality as o(id, n)
  where f.id = o.id and not f.archived;
  get diagnostics v_changed = row_count;
  if v_changed <> coalesce(cardinality(p_ids), 0) then
    raise exception 'that list is not made only of your visible measurements' using errcode = '23514';
  end if;
end;
$$;
revoke all on function public.reorder_measurement_fields(uuid[]) from public, anon;
grant execute on function public.reorder_measurement_fields(uuid[]) to authenticated;

-- A starter list. She replaces it with her own words in Settings.
create function app.seed_measurement_fields(p_owner uuid) returns void
language sql security definer
set search_path = ''
as $$
  insert into public.measurement_field (owner_id, key, label, sort)
  select p_owner, v.key, v.label, v.sort
  from (values
    ('bust', 'Bust', 10),
    ('underbust', 'Under bust', 20),
    ('waist', 'Waist', 30),
    ('hip', 'Hip', 40),
    ('shoulder', 'Shoulder width', 50),
    ('back_length', 'Back length (neck to waist)', 60),
    ('sleeve', 'Sleeve length', 70),
    ('armhole', 'Armhole', 80),
    ('neck', 'Neck', 90),
    ('dress_length', 'Dress length (shoulder to hem)', 100),
    ('skirt_length', 'Skirt length (waist to hem)', 110),
    ('inseam', 'Inseam', 120)
  ) as v(key, label, sort)
  on conflict (owner_id, key) do nothing;
$$;
revoke all on function app.seed_measurement_fields(uuid) from public, anon, authenticated;

-- Every new user starts with the list. (Replaces the Stage 0 function; the rest of it is unchanged.)
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profile (owner_id, name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''));
  perform app.seed_measurement_fields(new.id);
  return new;
end;
$$;
revoke all on function app.handle_new_user() from public, anon, authenticated;

-- And so does everyone who already exists.
select app.seed_measurement_fields(owner_id) from public.profile;

-- ---------------------------------------------------------------------------------------------
-- A client's measurements on one day. Never edited: a change is the next version.

-- {"bust": 92.5, "waist": 70}: at least one, each above zero and at most 500, in tenths.
create function app.measurements_valid(v jsonb) returns boolean
language plpgsql immutable
set search_path = ''
as $$
declare
  k text;
  x jsonb;
  n numeric;
begin
  if jsonb_typeof(v) is distinct from 'object' or v = '{}'::jsonb then
    return false;
  end if;
  for k, x in select e.key, e.value from jsonb_each(v) as e loop
    if k !~ '^[a-z][a-z0-9_]{0,39}$' or jsonb_typeof(x) <> 'number' then
      return false;
    end if;
    n := (x #>> '{}')::numeric;
    if n <= 0 or n > 500 or n <> round(n, 1) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

create table public.measurement_set (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  client_id uuid not null,
  version integer not null check (version > 0),
  taken_on date not null,
  unit text not null check (unit in ('cm', 'in')),
  measures jsonb not null check (app.measurements_valid(measures)),
  note text not null default '' check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  constraint measurement_set_owner_id_key unique (owner_id, id),
  constraint measurement_set_one_version unique (owner_id, client_id, version),
  constraint measurement_set_client_fk foreign key (owner_id, client_id)
    references public.client (owner_id, id) on delete cascade
);
comment on table public.measurement_set is
  'One client''s measurements on one day. Immutable: a change is a new row with the next version.';

-- The database numbers the versions, and every measurement must be one of her fields.
create function app.measurement_set_before_insert() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select coalesce(max(s.version), 0) + 1 into new.version
  from public.measurement_set s
  where s.owner_id = new.owner_id and s.client_id = new.client_id;

  -- Only an object has keys to look at; any other shape is refused by the table's own check.
  if jsonb_typeof(new.measures) = 'object' and exists (
    select 1 from jsonb_object_keys(new.measures) as k
    where not exists (
      select 1 from public.measurement_field f where f.owner_id = new.owner_id and f.key = k
    )
  ) then
    raise exception 'a measurement is not in her list of measurements' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger measurement_set_before_insert before insert on public.measurement_set
  for each row execute function app.measurement_set_before_insert();

select app.secure_owner_table('public.measurement_set');

-- Nothing about a saved version can be changed. (Deleting a version nothing uses is allowed.)
revoke update on public.measurement_set from authenticated;
