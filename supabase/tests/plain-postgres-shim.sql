-- Stand-in for the parts of Supabase our migrations rely on, so the database tests can
-- run on a plain PostgreSQL server (no Docker). Never applied to a real Supabase project:
-- the test setup applies it only when auth.uid() does not already exist.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

create schema if not exists auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Same definition Supabase ships: the signed-in user's id, read from the request claims.
create function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Supabase hands new public tables to the API roles by default. Reproduce that, so the
-- tests prove our migrations take those rights back rather than relying on a quiet default.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- Supabase Storage keeps its buckets and objects in the `storage` schema. Only the pieces our migrations
-- and policies use are reproduced: the two tables (with row-level security on, as Supabase has them) and
-- the helper that splits an object's path into folders. The real service stores the files themselves
-- elsewhere; here only the rows exist, which is all the policies look at.
create schema if not exists storage;

create table storage.buckets (
  id text primary key,
  name text not null unique,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz not null default now(),
  constraint objects_bucket_name unique (bucket_id, name)
);
alter table storage.objects enable row level security;

-- Same behaviour as Supabase's: every part of the path except the file name.
create function storage.foldername(name text) returns text[]
language plpgsql
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;

grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
