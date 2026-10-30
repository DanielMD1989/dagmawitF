-- No lists of steps (decision 0075). Her steps are the same few every time, so the step buttons on a job (the common
-- steps and those she repeats) are all she needs; the Library and its lists (Bridal gown, Dress) go, and a new account
-- no longer gets them. Jobs and their steps are not touched: a step never pointed at a list. History that says a
-- list's steps were added stays as it was written.

-- A new account: her profile, her measurements list and her working week; no lists.
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profile (owner_id, name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''));
  perform app.seed_measurement_fields(new.id);
  perform app.seed_work_week(new.id);
  return new;
end;
$$;

drop function app.seed_templates(uuid);
drop table public.template_task;
drop table public.template;
drop function app.template_part_changed();
drop function app.template_before_update();

-- The export's schema.
create or replace function app.schema_version() returns text
language sql immutable
set search_path = ''
as $$ select '20261103090000'::text $$;
