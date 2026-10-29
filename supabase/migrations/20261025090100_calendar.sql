-- Stage 0 data: her profile, her working week, and the days that differ from it.
-- Column names follow the Data model board, except calendar_exception.date is `day`.

-- Valid breaks: a list of {"start":"HH:MM","end":"HH:MM"} that sit inside the working
-- hours, in order, without overlapping. At most six.
create function app.breaks_are_valid(start_time time, end_time time, breaks jsonb) returns boolean
language plpgsql immutable
set search_path = ''
as $$
declare
  item jsonb;
  s text;
  e text;
  sm integer;
  em integer;
  prev_end integer := app.time_to_min(start_time);
  last_allowed integer := app.time_to_min(end_time);
begin
  if jsonb_typeof(breaks) is distinct from 'array' or jsonb_array_length(breaks) > 6 then
    return false;
  end if;

  for item in select value from jsonb_array_elements(breaks) with ordinality order by ordinality
  loop
    if jsonb_typeof(item) is distinct from 'object' then
      return false;
    end if;
    s := item ->> 'start';
    e := item ->> 'end';
    if s is null or e is null
       or s !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or e !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      return false;
    end if;
    sm := app.hhmm_to_min(s);
    em := app.hhmm_to_min(e);
    if sm >= em or sm < prev_end or em > last_allowed then
      return false;
    end if;
    prev_end := em;
  end loop;

  return true;
end;
$$;

create table public.profile (
  owner_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  name text not null default '' check (char_length(name) <= 120),
  timezone text not null default 'Africa/Addis_Ababa' check (app.is_valid_timezone(timezone)),
  locale text not null default 'en' check (locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  calendar text not null default 'gregorian' check (calendar in ('gregorian', 'ethiopian')),
  -- The share of working hours the engine will fill. The rest stays free for walk-ins.
  planning_ratio numeric(3, 2) not null default 0.70 check (planning_ratio between 0.30 and 1.00),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.profile.planning_ratio is
  'Share of working hours the engine will fill. 0.70 leaves 30% free for walk-ins and overruns.';

create table public.work_week (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  start_time time not null,
  end_time time not null,
  breaks jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_week_one_row_per_day unique (owner_id, weekday),
  constraint work_week_whole_minutes check (
    extract(second from start_time) = 0 and extract(second from end_time) = 0
  ),
  constraint work_week_hours_valid check (start_time < end_time),
  constraint work_week_breaks_valid check (app.breaks_are_valid(start_time, end_time, breaks))
);
comment on table public.work_week is
  'One row per working day. A weekday with no row is a day off. weekday is ISO: 1 = Monday, 7 = Sunday.';

create table public.calendar_exception (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  minutes_available integer not null check (minutes_available between 0 and 1440),
  reason text not null default '' check (char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_exception_one_row_per_day unique (owner_id, day)
);
comment on table public.calendar_exception is
  'Holidays, half days and leave. minutes_available replaces the working week for that date; 0 means closed.';

create trigger profile_updated_at before update on public.profile
  for each row execute function app.set_updated_at();
create trigger work_week_updated_at before update on public.work_week
  for each row execute function app.set_updated_at();
create trigger calendar_exception_updated_at before update on public.calendar_exception
  for each row execute function app.set_updated_at();

select app.secure_owner_table('public.profile');
select app.secure_owner_table('public.work_week');
select app.secure_owner_table('public.calendar_exception');

-- Every user gets a profile the moment they exist, so the app never has to wonder.
create function app.handle_new_user() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profile (owner_id, name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''));
  return new;
end;
$$;
revoke all on function app.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

-- Replaces her whole working week in one transaction. Either every day is saved or
-- none is, so a mistake in one row can never leave her with a half-written week.
-- Runs with her own rights, so row-level security still applies.
-- p_days: [{"weekday":1,"start":"08:30","end":"17:00","breaks":[{"start":"12:30","end":"13:30"}]}]
create function public.replace_work_week(p_days jsonb) returns void
language plpgsql security invoker
set search_path = ''
as $$
begin
  if jsonb_typeof(p_days) is distinct from 'array' then
    raise exception 'p_days must be a JSON array' using errcode = '22023';
  end if;

  delete from public.work_week where owner_id = (select auth.uid());

  insert into public.work_week (weekday, start_time, end_time, breaks)
  select (d ->> 'weekday')::smallint,
         (d ->> 'start')::time,
         (d ->> 'end')::time,
         coalesce(d -> 'breaks', '[]'::jsonb)
  from jsonb_array_elements(p_days) as d;
end;
$$;
revoke all on function public.replace_work_week(jsonb) from public, anon;
grant execute on function public.replace_work_week(jsonb) to authenticated;
