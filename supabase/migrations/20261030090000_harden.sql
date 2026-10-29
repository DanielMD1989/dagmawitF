-- Stage 6: her data can leave as one file and come back. The contract is in docs/harden.md, the reasons in
-- decisions 0051 to 0054.

-- ---------------------------------------------------------------------------------------------
-- Which schema an export belongs to: the name of this, the last migration. A test compares it with the migrations
-- folder, so a later migration that forgets to change it fails the check.

create or replace function app.schema_version() returns text
language sql immutable
set search_path = ''
as $$ select '20261030090000'::text $$;
grant execute on function app.schema_version() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The export (decision 0051). Runs as her: row-level security decides what is in it. Every table in `public` is
-- read, so a table added later is exported without being listed here.
--
-- STABLE matters: a stable function sees the snapshot of the statement that called it, so every table is read from
-- the same moment. (A volatile one would take a new snapshot for each table.) A test checks it stays stable.

create function public.export_my_data() returns jsonb
language plpgsql stable security invoker
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
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The restore (decisions 0052 to 0054). Run by whoever looks after the app, as the owner of the tables (the
-- `postgres` role on Supabase, which is not a superuser); never reachable from the API. Replaces everything of
-- `p_owner` with the file's rows, in the caller's transaction.

create function app.restore_owner(p_owner uuid, p_data jsonb) returns void
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
revoke all on function app.restore_owner(uuid, jsonb) from public, anon, authenticated, service_role;
