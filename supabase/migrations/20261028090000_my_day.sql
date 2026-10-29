-- Stage 4: living the approved plan. Progress on a task, studio work with no order, a second counter for progress,
-- and the proposal and approval functions that use it. The model and the reasons are in docs/my-day.md and
-- decisions 0040 to 0045.

-- ---------------------------------------------------------------------------------------------
-- Studio work: a task may belong to no order (and then to no garment). Both or neither.

alter table public.task
  alter column order_id drop not null,
  alter column order_item_id drop not null,
  add constraint task_order_and_garment check ((order_id is null) = (order_item_id is null));

-- ---------------------------------------------------------------------------------------------
-- Progress

alter table public.task
  add column status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'done')),
  add column started_at timestamptz,
  add column done_on date check (done_on between date '2000-01-01' and date '2099-12-31'),
  -- The time it really took, in total. Her estimate (minutes) is kept beside it.
  add column actual_minutes integer check (actual_minutes between 1 and 6000),
  -- About how much is left, while it is in progress.
  add column remaining_minutes integer check (remaining_minutes between 1 and 6000),
  add column hold_reason text not null default '' check (hold_reason = btrim(hold_reason) and char_length(hold_reason) <= 200),
  add constraint task_done_has_day check ((status = 'done') = (done_on is not null)),
  add constraint task_actual_only_when_done check (actual_minutes is null or status = 'done'),
  add constraint task_done_work_has_actual check (
    status <> 'done' or kind not in ('work', 'fixed') or actual_minutes is not null),
  add constraint task_actual_only_for_time check (actual_minutes is null or kind in ('work', 'fixed')),
  add constraint task_remaining_only_in_progress check (remaining_minutes is null or status = 'in_progress'),
  add constraint task_remaining_only_for_time check (remaining_minutes is null or kind in ('work', 'fixed'));

comment on column public.task.minutes is 'Her estimate. Never overwritten by progress: the actual time is kept beside it.';

-- Keeps the progress columns whole: leaving a status clears what belonged to it, and starting records when.
-- Only a move clears: a value written for a status the task is not in is refused by the table's checks.
create function app.task_progress() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.status = 'done' and new.status <> 'done' then
    new.done_on := null;
    new.actual_minutes := null;
  end if;
  if tg_op = 'UPDATE' and old.status = 'in_progress' and new.status <> 'in_progress' then
    new.remaining_minutes := null;
  end if;
  if new.status in ('in_progress', 'done') and new.started_at is null then
    new.started_at := now();
  end if;
  if new.status = 'not_started' then
    new.started_at := null;
  end if;
  if new.done_on is not null and new.done_on > app.today_for(new.owner_id) then
    raise exception 'a task cannot be finished on a day that has not come yet' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger task_progress before insert or update on public.task
  for each row execute function app.task_progress();

grant update (status, done_on, actual_minutes, remaining_minutes, hold_reason) on public.task to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Two counters (decision 0040): the shape of the plan, and progress on it.

alter table public.profile add column progress_epoch bigint not null default 0;
comment on column public.profile.progress_epoch is
  'Raised by triggers whenever progress is recorded on a task. A proposal made before it cannot be approved.';

create function app.progress_recorded() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.profile set progress_epoch = progress_epoch + 1 where owner_id = new.owner_id;
  return null;
end;
$$;
revoke all on function app.progress_recorded() from public, anon, authenticated;

drop trigger task_epoch on public.task;
create trigger task_epoch after insert or delete on public.task
  for each row execute function app.planning_fact_changed();
create trigger task_epoch_update after update on public.task
  for each row when ((new.title, new.kind, new.minutes, new.days, new.fixed_on, new.fixed_time, new.not_before,
                      new.hold_reason, new.order_id, new.sort)
                     is distinct from (old.title, old.kind, old.minutes, old.days, old.fixed_on, old.fixed_time,
                                       old.not_before, old.hold_reason, old.order_id, old.sort))
  execute function app.planning_fact_changed();
create trigger task_progress_epoch after update on public.task
  for each row when ((new.status, new.done_on, new.actual_minutes, new.remaining_minutes)
                     is distinct from (old.status, old.done_on, old.actual_minutes, old.remaining_minutes))
  execute function app.progress_recorded();

alter table public.plan_version add column progress_epoch bigint not null default 0;

-- Replaces Stage 3's: the proposal keeps the progress counter too.
drop function public.save_proposal(bigint, date, jsonb, jsonb);
create function public.save_proposal(p_epoch bigint, p_progress bigint, p_made_for date, p_result jsonb, p_slots jsonb)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_epoch bigint;
  v_progress bigint;
  v_base integer;
  v_number integer;
  v_id uuid;
begin
  if v_owner is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select p.plan_epoch, p.progress_epoch into v_epoch, v_progress
  from public.profile p where p.owner_id = v_owner for update;
  if v_epoch is distinct from p_epoch or v_progress is distinct from p_progress then
    raise exception 'something changed while the plan was being made; make it again' using errcode = '23514';
  end if;
  if p_made_for is distinct from app.today_for(v_owner) then
    raise exception 'the plan was made for another day; make it again' using errcode = '23514';
  end if;
  if jsonb_typeof(p_slots) is distinct from 'array' then
    raise exception 'slots must be a list' using errcode = '22023';
  end if;

  select v.number into v_base from public.plan_version v where v.owner_id = v_owner and v.status = 'approved';
  select coalesce(max(v.number), 0) + 1 into v_number from public.plan_version v where v.owner_id = v_owner;

  insert into public.plan_version (owner_id, number, base_number, epoch, progress_epoch, made_for, result)
  values (v_owner, v_number, v_base, p_epoch, p_progress, p_made_for, p_result)
  returning id into v_id;

  insert into public.plan_slot (owner_id, plan_id, task_id, day, minutes, rank, at_time)
  select v_owner, v_id, s.task_id, s.day, s.minutes, s.rank, s.at_time
  from jsonb_to_recordset(p_slots) as s(task_id uuid, day date, minutes integer, rank integer, at_time time);

  return v_number;
end;
$$;
revoke all on function public.save_proposal(bigint, bigint, date, jsonb, jsonb) from public, anon;
grant execute on function public.save_proposal(bigint, bigint, date, jsonb, jsonb) to authenticated;

-- Replaces Stage 3's: also refuses a proposal made before progress was recorded (decision 0041).
create or replace function public.approve_plan(p_number integer) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_plan public.plan_version;
  v_epoch bigint;
  v_progress bigint;
  v_current integer;
begin
  if v_owner is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select p.plan_epoch, p.progress_epoch into v_epoch, v_progress
  from public.profile p where p.owner_id = v_owner for update;
  select * into v_plan from public.plan_version v where v.owner_id = v_owner and v.number = p_number for update;
  if v_plan.id is null then
    raise exception 'plan not found' using errcode = 'P0002';
  end if;
  if v_plan.status <> 'proposed' then
    raise exception 'this plan was already % and cannot be approved', v_plan.status using errcode = '23514';
  end if;
  if v_plan.made_for <> app.today_for(v_owner) then
    raise exception 'this proposal was made for an earlier day; make a new one' using errcode = '23514';
  end if;
  if v_plan.epoch <> v_epoch then
    raise exception 'something has changed since this proposal was made; make a new one' using errcode = '23514';
  end if;
  if v_plan.progress_epoch <> v_progress then
    raise exception 'work was marked since this proposal was made; make a new one' using errcode = '23514';
  end if;
  select v.number into v_current from public.plan_version v where v.owner_id = v_owner and v.status = 'approved';
  if v_current is distinct from v_plan.base_number then
    raise exception 'another plan was approved after this one was made; make a new one' using errcode = '23514';
  end if;

  update public.plan_version set status = 'superseded', decided_at = now()
  where owner_id = v_owner and status = 'approved';
  update public.plan_version set status = 'superseded', decided_at = now()
  where owner_id = v_owner and status = 'proposed' and id <> v_plan.id;
  update public.plan_version set status = 'approved', decided_at = now() where id = v_plan.id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- History: a task done, a task held or released. (Replaces Stage 3's list; a test compares it with the screen's.)

create or replace function app.history_actions() returns text[]
language sql immutable
set search_path = ''
as $$
  select array[
    'order_created', 'status_changed', 'delivery_changed', 'buffer_changed', 'client_changed',
    'garment_added', 'garment_changed', 'garment_removed', 'garment_measurements',
    'prerequisite_added', 'prerequisite_state', 'prerequisite_date', 'prerequisite_blocking',
    'prerequisite_removed',
    'file_added', 'file_removed',
    'measurements_recorded',
    'template_applied', 'plan_approved',
    'task_done', 'task_hold'
  ];
$$;

create function app.task_log() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.order_id is null then
    return null; -- studio work has no order, and no history
  end if;
  if new.status = 'done' and old.status <> 'done' then
    perform app.log_event(new.owner_id, new.order_id, null, 'task_done', jsonb_strip_nulls(jsonb_build_object(
      'title', new.title, 'done_on', new.done_on, 'actual', new.actual_minutes, 'estimate', new.minutes)));
  end if;
  if new.hold_reason <> old.hold_reason then
    perform app.log_event(new.owner_id, new.order_id, null, 'task_hold', jsonb_build_object(
      'title', new.title, 'reason', nullif(new.hold_reason, '')));
  end if;
  return null;
end;
$$;
create trigger task_log after update on public.task
  for each row execute function app.task_log();
