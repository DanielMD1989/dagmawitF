-- A shared workspace (decision 0081). A second account can work in her workspace with the same rights as her: it sees
-- and changes the same clients, jobs, steps, pictures and calendar. Data stays keyed by `owner_id`, which is now the
-- workspace's owner (her), whoever is signed in; a person's profile (name, time zone, unit) stays their own. Who did
-- what is kept on each history line (`actor_id`), for the other to be told.

-- ---------------------------------------------------------------------------------------------
-- 1. Who works in whose workspace. In `app`, not `public`: not reachable through the API, and not part of the export
-- (a member is an account of this project, which a restored file elsewhere would not have).

create table app.member (
  user_id uuid primary key references auth.users (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  added_at timestamptz not null default now(),
  constraint member_not_self check (user_id <> owner_id)
);
comment on table app.member is 'An account that works in another''s workspace (decision 0081).';
create index member_owner on app.member (owner_id);
revoke all on table app.member from public, anon, authenticated;

-- The workspace of whoever is signed in: the one they were added to, else their own.
create function app.workspace() returns uuid
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select m.owner_id from app.member m where m.user_id = (select auth.uid())), (select auth.uid()));
$$;
revoke all on function app.workspace() from public, anon;
grant execute on function app.workspace() to authenticated;

-- For the app: the folder her pictures are kept under is the workspace's.
create function public.my_workspace() returns uuid
language sql stable
set search_path = ''
as $$ select app.workspace(); $$;
revoke all on function public.my_workspace() from public, anon;
grant execute on function public.my_workspace() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Every table of the workspace answers to the workspace; a profile stays its person's.

do $$
declare
  t text;
begin
  foreach t in array array['activity_log', 'attachment', 'calendar_exception', 'client', 'measurement_field',
                           'measurement_set', 'order_item', 'orders', 'task', 'work_week'] loop
    execute format('alter table public.%I alter column owner_id set default app.workspace()', t);
    execute format('drop policy %I on public.%I', t || '_select', t);
    execute format('drop policy %I on public.%I', t || '_insert', t);
    execute format('drop policy %I on public.%I', t || '_update', t);
    execute format('drop policy %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (owner_id = (select app.workspace()))',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (owner_id = (select app.workspace()))',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (owner_id = (select app.workspace())) '
      'with check (owner_id = (select app.workspace()))',
      t || '_update', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (owner_id = (select app.workspace()))',
      t || '_delete', t);
  end loop;
end;
$$;

-- A profile stays its person's to change; the people of one workspace may read each other's (her name on a history
-- line, and her day for both of them).
create function app.in_workspace(p_user uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_user = app.workspace()
      or exists (select 1 from app.member m where m.user_id = p_user and m.owner_id = app.workspace());
$$;
revoke all on function app.in_workspace(uuid) from public, anon;
grant execute on function app.in_workspace(uuid) to authenticated;

drop policy profile_select on public.profile;
create policy profile_select on public.profile for select to authenticated
  using (owner_id = (select auth.uid()) or app.in_workspace(owner_id));

-- A table added later is secured the same way.
create or replace function app.secure_owner_table(tbl regclass) returns void
language plpgsql
set search_path = ''
as $$
declare
  rel text := (select c.relname from pg_class c where c.oid = tbl);
begin
  if not exists (
    select 1 from pg_attribute a
    where a.attrelid = tbl and a.attname = 'owner_id' and not a.attisdropped
  ) then
    raise exception 'table % has no owner_id column, so it cannot be secured', tbl;
  end if;

  execute format('alter table %s enable row level security', tbl);
  execute format('alter table %s force row level security', tbl);
  execute format('revoke all on table %s from public, anon, authenticated', tbl);
  execute format('grant select, insert, update, delete on table %s to authenticated', tbl);
  execute format('alter table %s alter column owner_id set default app.workspace()', tbl);

  execute format(
    'create policy %I on %s for select to authenticated using (owner_id = (select app.workspace()))',
    rel || '_select', tbl);
  execute format(
    'create policy %I on %s for insert to authenticated with check (owner_id = (select app.workspace()))',
    rel || '_insert', tbl);
  execute format(
    'create policy %I on %s for update to authenticated using (owner_id = (select app.workspace())) '
    'with check (owner_id = (select app.workspace()))',
    rel || '_update', tbl);
  execute format(
    'create policy %I on %s for delete to authenticated using (owner_id = (select app.workspace()))',
    rel || '_delete', tbl);
end;
$$;
revoke all on function app.secure_owner_table(regclass) from public, anon, authenticated;

-- Pictures: the workspace's folder.
drop policy "order files: her folder, add" on storage.objects;
drop policy "order files: her folder, change" on storage.objects;
drop policy "order files: her folder, read" on storage.objects;
drop policy "order files: her folder, remove" on storage.objects;
create policy "order files: the workspace's folder, add" on storage.objects for insert to authenticated
  with check (bucket_id = 'order-files' and (storage.foldername(name))[1] = (select app.workspace())::text);
create policy "order files: the workspace's folder, change" on storage.objects for update to authenticated
  using (bucket_id = 'order-files' and (storage.foldername(name))[1] = (select app.workspace())::text)
  with check (bucket_id = 'order-files' and (storage.foldername(name))[1] = (select app.workspace())::text);
create policy "order files: the workspace's folder, read" on storage.objects for select to authenticated
  using (bucket_id = 'order-files' and (storage.foldername(name))[1] = (select app.workspace())::text);
create policy "order files: the workspace's folder, remove" on storage.objects for delete to authenticated
  using (bucket_id = 'order-files' and (storage.foldername(name))[1] = (select app.workspace())::text);

-- ---------------------------------------------------------------------------------------------
-- 3. The functions that meant "hers" now mean "the workspace's".

create or replace function app.latest_measurement_set(p_client uuid) returns uuid
language sql stable
set search_path = ''
as $$
  select s.id from public.measurement_set s
  where s.client_id = p_client and s.owner_id = (select app.workspace())
  order by s.version desc limit 1;
$$;

create or replace function public.replace_work_week(p_days jsonb) returns void
language plpgsql
set search_path = ''
as $$
begin
  if jsonb_typeof(p_days) is distinct from 'array' then
    raise exception 'p_days must be a JSON array' using errcode = '22023';
  end if;

  delete from public.work_week where owner_id = (select app.workspace());

  insert into public.work_week (weekday, start_time, end_time, breaks)
  select (d ->> 'weekday')::smallint,
         (d ->> 'start')::time,
         (d ->> 'end')::time,
         coalesce(d -> 'breaks', '[]'::jsonb)
  from jsonb_array_elements(p_days) as d;
end;
$$;

create or replace function public.delete_job(p_order_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  -- Its garments, steps and pictures go with it: the freeze on a finished job's parts looks for the job, which is
  -- gone by then (app.refuse_change_to_closed_order).
  delete from public.orders o where o.id = p_order_id and o.owner_id = (select app.workspace());
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    raise exception 'that job could not be found' using errcode = 'P0002';
  end if;
end;
$$;

-- Her day, for moving unfinished steps: the workspace's.
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
      or exists (select 1 from public.orders o where o.id = t.order_id and o.status = 'active'));
  get diagnostics v_moved = row_count;
  return v_moved;
end;
$$;

-- The export is the workspace's, made by its owner: her file holds her profile, and a member's profile is not part
-- of her workspace's data.
create or replace function public.export_my_data() returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_tables jsonb := '{}'::jsonb;
  v_rows jsonb;
  r record;
begin
  if v_owner is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if app.workspace() <> v_owner then
    raise exception 'only the workspace''s owner can download everything' using errcode = '42501';
  end if;
  for r in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    order by c.relname
  loop
    -- Sorted by the row's text, so the same data always gives the same file.
    execute format('select coalesce(jsonb_agg(to_jsonb(t) order by t::text), ''[]''::jsonb) from public.%I t',
                   r.relname)
      into v_rows;
    v_tables := v_tables || jsonb_build_object(r.relname, v_rows);
  end loop;
  return jsonb_build_object(
    'format', 'dagmawit-export',
    'schema', app.schema_version(),
    'exported_at', now(),
    'owner_id', v_owner,
    'tables', v_tables);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. Who did it: each history line keeps the account that made the change.

alter table public.activity_log
  add column actor_id uuid default auth.uid();
comment on column public.activity_log.actor_id is
  'The account that made the change (decision 0081); null for lines written before it was kept.';

-- A restore into another account carries her own history lines over to it, like her rows (replaces 0059's).
create or replace function app.restore_owner(p_owner uuid, p_data jsonb) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_old uuid;
  v_tables text[];
  v_in_file text[];
  v_columns text[];
  v_rows jsonb;
  v_count bigint;
  v_order text[] := '{}';
  v_next text[];
  v_triggers text[] := '{}';
  t text;
  r record;
begin
  if p_data->>'format' is distinct from 'dagmawit-export' then
    raise exception 'this is not a DAGMAWIT export' using errcode = '22023';
  end if;
  if p_data->>'schema' is distinct from app.schema_version() then
    raise exception 'the file is from schema %, the database is at %; restore it into a database at its own version, then migrate',
      coalesce(p_data->>'schema', 'unknown'), app.schema_version() using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_owner) then
    raise exception 'there is no account %', p_owner using errcode = '23503';
  end if;
  begin
    v_old := (p_data->>'owner_id')::uuid;
  exception when others then
    raise exception 'the file does not say whose it is' using errcode = '22023';
  end;
  if v_old is null then
    raise exception 'the file does not say whose it is' using errcode = '22023';
  end if;

  select array_agg(c.relname::text order by c.relname) into v_tables
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p');
  select array_agg(k order by k) into v_in_file from jsonb_object_keys(p_data->'tables') k;
  if v_in_file is distinct from v_tables then
    raise exception 'the file''s tables (%) are not this database''s (%)', v_in_file, v_tables using errcode = '22023';
  end if;

  -- Every row must be the old owner's and have exactly the table's columns: a missing column would be restored as
  -- empty, and an unknown one silently dropped.
  foreach t in array v_tables loop
    v_rows := p_data->'tables'->t;
    if jsonb_typeof(v_rows) is distinct from 'array' then
      raise exception 'the file''s % is not a list of rows', t using errcode = '22023';
    end if;
    select array_agg(a.attname::text order by a.attname) into v_columns
    from pg_attribute a
    where a.attrelid = format('public.%I', t)::regclass and a.attnum > 0 and not a.attisdropped;
    select count(*) into v_count
    from jsonb_array_elements(v_rows) e
    where jsonb_typeof(e) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(e) k) is distinct from v_columns
       or (e->>'owner_id') is distinct from v_old::text;
    if v_count > 0 then
      raise exception '% rows in the file''s % do not match the table or are not the file''s owner''s', v_count, t
        using errcode = '22023';
    end if;
  end loop;

  -- The order the links between tables allow: a table comes after every table it points at. The links stay on, so
  -- the database itself refuses a row that points at nothing.
  loop
    select array_agg(x order by x) into v_next
    from unnest(v_tables) x
    where not x = any(v_order)
      and not exists (
        select 1 from pg_constraint con
        where con.contype = 'f'
          and con.conrelid = format('public.%I', x)::regclass
          and con.confrelid in (
            select format('public.%I', y)::regclass from unnest(v_tables) y where not y = any(v_order)));
    exit when v_next is null;
    v_order := v_order || v_next;
  end loop;
  if cardinality(v_order) <> cardinality(v_tables) then
    raise exception 'the tables % point at each other in a loop; a restore cannot order them',
      (select array_agg(x) from unnest(v_tables) x where not x = any(v_order)) using errcode = '0A000';
  end if;

  -- The app's own triggers off, so rows go back as they were: history, counters and versions are the file's, not
  -- re-made (decision 0054). Only the ones that are on, and exactly those are turned back on below. The database's
  -- own triggers (the links between tables) stay on. As the tables' owner this needs no superuser, and it is undone
  -- with everything else if the restore fails.
  for r in
    select c.relname, t.tgname
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not t.tgisinternal and t.tgenabled = 'O'
    order by c.relname, t.tgname
  loop
    execute format('alter table public.%I disable trigger %I', r.relname, r.tgname);
    v_triggers := v_triggers || array[array[r.relname::text, r.tgname::text]];
  end loop;

  for i in reverse cardinality(v_order) .. 1 loop
    execute format('delete from public.%I where owner_id = $1', v_order[i]) using p_owner;
  end loop;

  foreach t in array v_order loop
    -- The new owner, and for a picture the owner part of its path (the path starts with the owner: a check on
    -- attachment refuses any other).
    if t = 'attachment' and exists (
      select 1 from jsonb_array_elements(p_data->'tables'->t) e
      where left(e->>'storage_path', char_length(v_old::text) + 1) <> v_old::text || '/') then
      raise exception 'a picture in the file is stored outside its owner''s folder' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(
             e || jsonb_build_object('owner_id', p_owner)
               -- Her own changes stay hers (decision 0081): a history line she made names the new owner.
               || case when e->>'actor_id' = v_old::text
                       then jsonb_build_object('actor_id', p_owner) else '{}'::jsonb end
               || case when t = 'attachment'
                       then jsonb_build_object('storage_path',
                              p_owner::text || substr(e->>'storage_path', char_length(v_old::text) + 1))
                       else '{}'::jsonb end), '[]'::jsonb)
      into v_rows
    from jsonb_array_elements(p_data->'tables'->t) e;
    execute format(
      'insert into public.%I overriding system value select * from jsonb_populate_recordset(null::public.%I, $1)',
      t, t) using v_rows;
  end loop;

  for i in 1 .. coalesce(array_length(v_triggers, 1), 0) loop
    execute format('alter table public.%I enable trigger %I', v_triggers[i][1], v_triggers[i][2]);
  end loop;

  -- Counters (the history's) move past the restored rows, never back.
  for r in
    select c.relname, a.attname, pg_get_serial_sequence(format('public.%I', c.relname), a.attname) as seq
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and a.attidentity <> '' and a.attnum > 0
  loop
    execute format('select coalesce(max(%I), 0) from public.%I', r.attname, r.relname) into v_count;
    perform setval(r.seq, greatest(v_count, coalesce(pg_sequence_last_value(r.seq::regclass), 0), 1), true);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. Adding and removing a member, and the people of a workspace.

-- She adds an account she has made (Authentication > Users) by its email. Only a workspace's owner adds; the account
-- must not already work in a workspace, nor have members of its own.
create function public.add_member(p_email text) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_user uuid;
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if exists (select 1 from app.member m where m.user_id = v_me) then
    raise exception 'only the workspace''s owner can add people' using errcode = '42501';
  end if;
  select u.id into v_user from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_user is null then
    raise exception 'there is no account with that email' using errcode = 'P0002';
  end if;
  if v_user = v_me then
    raise exception 'that is your own account' using errcode = '22023';
  end if;
  if exists (select 1 from app.member m where m.user_id = v_user) then
    raise exception 'that account already works in a workspace' using errcode = '23505';
  end if;
  if exists (select 1 from app.member m where m.owner_id = v_user) then
    raise exception 'that account has people of its own' using errcode = '22023';
  end if;
  insert into app.member (user_id, owner_id) values (v_user, v_me);
  return v_user;
end;
$$;
revoke all on function public.add_member(text) from public, anon;
grant execute on function public.add_member(text) to authenticated;

-- The owner removes a member; a member may leave.
create function public.remove_member(p_user uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_removed integer;
begin
  delete from app.member m where m.user_id = p_user and (m.owner_id = v_me or m.user_id = v_me);
  get diagnostics v_removed = row_count;
  if v_removed = 0 then
    raise exception 'that person is not in your workspace' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.remove_member(uuid) from public, anon;
grant execute on function public.remove_member(uuid) to authenticated;

-- The people of the signed-in person's workspace: its owner first, then its members, with their names and emails.
create function public.workspace_people()
returns table (user_id uuid, name text, email text, is_owner boolean, is_me boolean)
language sql stable security definer
set search_path = ''
as $$
  with w as (select app.workspace() as owner)
  select u.id, coalesce(p.name, ''), coalesce(u.email, ''), u.id = w.owner, u.id = (select auth.uid())
  from w
  join auth.users u on u.id = w.owner or u.id in (select m.user_id from app.member m where m.owner_id = w.owner)
  left join public.profile p on p.owner_id = u.id
  order by u.id = w.owner desc, p.name, u.email;
$$;
revoke all on function public.workspace_people() from public, anon;
grant execute on function public.workspace_people() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. The export's schema.

create or replace function app.schema_version() returns text
language sql immutable
set search_path = ''
as $$ select '20261105090000'::text $$;
