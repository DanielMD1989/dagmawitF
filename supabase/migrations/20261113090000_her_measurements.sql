-- Her own measurements, in the order she takes them (decision 0102), and a client added with them in one go.
--
-- The starter list (decision 0019) was never hers: long names ("Back length (neck to waist)") and measurements she
-- does not take. Her list, in her order: Bust, Waist, Hip, Shoulder to bust, Shoulder to waist, Coat length, Back
-- shoulder, Half shoulder, Sleeve, Armhole, Trouser waist, Skirt length, Height; and "Extra", in words, which is the
-- note a set of measurements already has. Nothing has been measured yet, so a starter measurement that is not hers is
-- removed; one any saved set used would be hidden instead, so that set still reads.
--
-- Released before the app (decision 0082): the live app reads her list as data, so it shows the new list as it is.

create or replace function app.seed_measurement_fields(p_owner uuid) returns void
language sql security definer
set search_path = ''
as $$
  insert into public.measurement_field (owner_id, key, label, sort, archived)
  select p_owner, v.key, v.label, v.sort, false
  from (values
    ('bust', 'Bust', 10),
    ('waist', 'Waist', 20),
    ('hip', 'Hip', 30),
    ('shoulder_to_bust', 'Shoulder to bust', 40),
    ('shoulder_to_waist', 'Shoulder to waist', 50),
    ('coat_length', 'Coat length', 60),
    ('back_shoulder', 'Back shoulder', 70),
    ('half_shoulder', 'Half shoulder', 80),
    ('sleeve', 'Sleeve', 90),
    ('armhole', 'Armhole', 100),
    ('trouser_waist', 'Trouser waist', 110),
    ('skirt_length', 'Skirt length', 120),
    ('height', 'Height', 130)
  ) as v(key, label, sort)
  on conflict (owner_id, key) do update set label = excluded.label, sort = excluded.sort, archived = false;
$$;
revoke all on function app.seed_measurement_fields(uuid) from public, anon, authenticated;

-- The starter measurements that are not hers: removed when no saved set uses them, hidden when one does.
with hers(key) as (
  values ('bust'), ('waist'), ('hip'), ('shoulder_to_bust'), ('shoulder_to_waist'), ('coat_length'),
         ('back_shoulder'), ('half_shoulder'), ('sleeve'), ('armhole'), ('trouser_waist'), ('skirt_length'), ('height')
),
used as (
  select f.id from public.measurement_field f
  where exists (select 1 from public.measurement_set s where s.owner_id = f.owner_id and s.measures ? f.key)
)
delete from public.measurement_field f
where f.key not in (select key from hers) and f.id not in (select id from used);

update public.measurement_field f
set archived = true
where f.key not in ('bust', 'waist', 'hip', 'shoulder_to_bust', 'shoulder_to_waist', 'coat_length', 'back_shoulder',
                    'half_shoulder', 'sleeve', 'armhole', 'trouser_waist', 'skirt_length', 'height')
  and not f.archived;

select app.seed_measurement_fields(owner_id) from (select distinct owner_id from public.measurement_field) o;

-- ---------------------------------------------------------------------------------------------
-- A new client with her first measurements, on one form (decision 0102): both saved, or neither, so a refused
-- measurement never leaves the client behind to be added twice. Without measurements it adds the client alone.

create function public.add_client(
  p_name text,
  p_phone text,
  p_notes text,
  p_measures jsonb,
  p_extra text,
  p_unit text,
  p_taken_on date
) returns uuid
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_client uuid;
begin
  if coalesce(p_extra, '') <> '' and (p_measures is null or p_measures = '{}'::jsonb) then
    raise exception 'extra words go with measurements' using errcode = '23514';
  end if;
  insert into public.client (name, phone, notes) values (p_name, p_phone, p_notes) returning id into v_client;
  if p_measures is not null and p_measures <> '{}'::jsonb then
    insert into public.measurement_set (client_id, taken_on, unit, measures, note)
    values (v_client, p_taken_on, p_unit, p_measures, coalesce(p_extra, ''));
  end if;
  return v_client;
end;
$$;
revoke all on function public.add_client(text, text, text, jsonb, text, text, date) from public, anon;
grant execute on function public.add_client(text, text, text, jsonb, text, text, date) to authenticated;

create or replace function app.schema_version() returns text
language sql immutable
set search_path = ''
as $$ select '20261113090000'::text $$;
