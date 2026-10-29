-- Foundation: helpers shared by every later migration.
--
-- Rules this file establishes (see docs/architecture.md):
--   * Helpers live in the `app` schema, which Supabase does not expose through its API.
--   * Every table that holds her data has an `owner_id` and is secured with
--     app.secure_owner_table(). That is the only way a table gets its policies.
--   * Times of day are plain local clock values. Dates are plain dates.

create schema if not exists app;
grant usage on schema app to authenticated, service_role;

-- Keeps updated_at honest without every caller remembering to set it.
create function app.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Minutes since local midnight for a time of day. 24:00 gives 1440.
create function app.time_to_min(t time) returns integer
language sql immutable strict
set search_path = ''
as $$
  select (extract(hour from t) * 60 + extract(minute from t))::integer;
$$;

-- Minutes since local midnight for an 'HH:MM' string. Callers validate the format first.
create function app.hhmm_to_min(s text) returns integer
language sql immutable strict
set search_path = ''
as $$
  select split_part(s, ':', 1)::integer * 60 + split_part(s, ':', 2)::integer;
$$;

-- True when the name is a time zone Postgres knows (for example Africa/Addis_Ababa).
create function app.is_valid_timezone(tz text) returns boolean
language plpgsql stable strict
set search_path = ''
as $$
begin
  perform now() at time zone tz;
  return true;
exception when others then
  return false;
end;
$$;

-- Secures a table that holds her data. One call does everything, so no table can be
-- left half protected:
--   * row-level security is switched on and forced, so even the table owner obeys it
--   * the anonymous role gets nothing
--   * the signed-in role may read and write, but only rows whose owner_id is its own
-- The table must have an owner_id column.
create function app.secure_owner_table(tbl regclass) returns void
language plpgsql
set search_path = ''
as $$
declare
  rel text;
begin
  select c.relname into rel from pg_catalog.pg_class c where c.oid = tbl;

  if not exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = tbl and a.attname = 'owner_id' and not a.attisdropped
  ) then
    raise exception 'table % has no owner_id column, so it cannot be secured', tbl;
  end if;

  execute format('alter table %s enable row level security', tbl);
  execute format('alter table %s force row level security', tbl);
  execute format('revoke all on table %s from public, anon, authenticated', tbl);
  execute format('grant select, insert, update, delete on table %s to authenticated', tbl);

  execute format(
    'create policy %I on %s for select to authenticated using (owner_id = (select auth.uid()))',
    rel || '_select', tbl);
  execute format(
    'create policy %I on %s for insert to authenticated with check (owner_id = (select auth.uid()))',
    rel || '_insert', tbl);
  execute format(
    'create policy %I on %s for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))',
    rel || '_update', tbl);
  execute format(
    'create policy %I on %s for delete to authenticated using (owner_id = (select auth.uid()))',
    rel || '_delete', tbl);
end;
$$;

revoke all on function app.secure_owner_table(regclass) from public, anon, authenticated;
