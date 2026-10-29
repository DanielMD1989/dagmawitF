-- She works in English, with Gregorian dates (decision 0061). The two settings kept for the day she might want
-- Amharic or the Ethiopian calendar are removed: a setting nothing reads is a second, unused way to describe her.

alter table public.profile drop column locale, drop column calendar;

-- An export names the schema it belongs to (decision 0053): this is now the last migration.
create or replace function app.schema_version() returns text
language sql immutable
set search_path = ''
as $$ select '20261031090000'::text $$;
