-- Unfinished steps move to today (decision 0080). A step not done by the end of its day, of a confirmed job or of her
-- own work, is moved to her today the next time she opens the app, and remembers the day it was first meant for.
-- Steps of a draft, a paused or a closed job stay where they are: those jobs are not on her calendar.

alter table public.task
  add column moved_from date;
comment on column public.task.moved_from is
  'The day a step was meant for before it was moved to today, unfinished (decision 0080). Cleared when she sets its day.';

grant update (moved_from) on public.task to authenticated;
grant insert (moved_from) on public.task to authenticated;

-- Moves her unfinished steps to her today; returns how many moved. Runs as her: row-level security limits it to hers.
-- Safe to run any number of times a day: a moved step is on today, so it is not moved again until tomorrow.
create function public.carry_over() returns integer
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_today date := app.today_for((select auth.uid()));
  v_moved integer;
begin
  if v_today is null then
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
revoke all on function public.carry_over() from public, anon;
grant execute on function public.carry_over() to authenticated;

create or replace function app.schema_version() returns text
language sql immutable
set search_path = ''
as $$ select '20261104090000'::text $$;
