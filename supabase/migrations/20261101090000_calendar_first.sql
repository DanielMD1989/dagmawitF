-- Calendar first (docs/calendar-first.md, decision 0066). Her work is jobs of a kind, and each job's steps have days
-- on the calendar. Hours are optional. Nothing is planned by an engine, nothing is approved, nothing blocks.
--
-- What she has entered is kept: a task keeps the day it already had (an appointment's day and time, a pinned day,
-- or the days the approved plan gave it), and preparation not yet in becomes a step with its expected day.

-- ---------------------------------------------------------------------------------------------
-- 1. Steps: a day, an optional last day, an optional time. Carried over before anything is dropped.

alter table public.task
  add column on_day date check (on_day between date '2000-01-01' and date '2099-12-31'),
  add column until_day date check (until_day between date '2000-01-01' and date '2099-12-31'),
  add column starts_at time check (starts_at is null or extract(second from starts_at) = 0),
  add column ends_at time check (ends_at is null or extract(second from ends_at) = 0);

-- The app's own triggers stay off while the days are copied: a task of a delivered order is otherwise frozen, and
-- this is not a change she made.
alter table public.task disable trigger user;

-- The days the approved plan gave each task: its first and its last.
with planned as (
  select s.task_id, min(s.day) as first_day, max(s.day) as last_day
  from public.plan_slot s
  join public.plan_version v on v.owner_id = s.owner_id and v.id = s.plan_id
  where v.status = 'approved'
  group by s.task_id
)
update public.task k set
  on_day = coalesce(k.fixed_on, k.pinned_on, x.first_day),
  until_day = case
    when k.fixed_on is null and k.pinned_on is null and x.last_day > x.first_day then x.last_day
  end,
  starts_at = k.fixed_time,
  -- An appointment's end: its start plus its minutes, when that is still the same day.
  ends_at = case
    when k.fixed_time is not null and k.minutes is not null
         and app.time_to_min(k.fixed_time) + k.minutes < 1440
      then k.fixed_time + make_interval(mins => k.minutes)
  end
from (
  select t.id, p.first_day, p.last_day from public.task t left join planned p on p.task_id = t.id
) x
where x.id = k.id;

alter table public.task enable trigger user;

-- Preparation not yet in becomes a step on its expected day, for orders that can still change. Kept aside here,
-- written as steps once the step table has its new shape (part 3).
create temporary table carried_preparation as
select q.owner_id, q.order_id,
       least(100000, coalesce((select max(k.sort) from public.task k
                               where k.owner_id = q.owner_id and k.order_id = q.order_id), 0)
                     + 10 * row_number() over (partition by q.owner_id, q.order_id order by q.created_at, q.id))
         as sort,
       left(case when q.kind = 'material' and q.state = 'needed' then 'Buy ' || q.label
                 when q.kind = 'material' then 'Collect ' || q.label
                 else q.label end, 120) as title,
       q.expected_on as on_day
from public.prerequisite q
join public.orders o on o.owner_id = q.owner_id and o.id = q.order_id
where q.state <> 'received' and o.status in ('draft', 'active', 'on_hold');

-- ---------------------------------------------------------------------------------------------
-- 2. What goes: plans, the counters that guarded them, links, preparation (decision 0066).

drop function public.save_proposal(bigint, bigint, date, jsonb, jsonb);
drop function public.approve_plan(integer);
drop function public.reject_plan(integer);
drop function public.apply_template(uuid, uuid);
drop function public.create_order(uuid, text, text, integer, date, integer, text, text, text, boolean);

drop table public.plan_slot;
drop table public.plan_version;
drop function app.plan_version_log();

-- Dropping these functions drops every trigger that called them (the epoch and progress triggers on task, orders,
-- work_week, calendar_exception, prerequisite, task_edge, task_requires and profile).
drop function app.planning_fact_changed() cascade;
drop function app.progress_recorded() cascade;
drop function app.profile_epoch() cascade;
drop function app.bump_plan_epoch(uuid);

drop table public.task_requires;
drop table public.task_edge;
drop function app.task_edge_no_loop();
drop table public.template_requires;
drop table public.template_edge;
drop function app.template_edge_no_loop();
drop table public.template_prerequisite;
drop table public.prerequisite;
drop function app.prerequisite_log();

drop trigger order_item_template_log on public.order_item;
drop function app.order_item_template_log();
alter table public.order_item drop column template_id, drop column template_version;

alter table public.profile
  drop column plan_epoch,
  drop column progress_epoch,
  drop column planning_ratio,
  drop column default_buffer_days;

-- ---------------------------------------------------------------------------------------------
-- 3. The step table, reshaped.

drop trigger task_progress on public.task;
drop function app.task_progress();
drop trigger task_log on public.task;
drop function app.task_log();

alter table public.task
  drop constraint task_order_and_garment,
  drop column kind,
  drop column minutes,
  drop column days,
  drop column fixed_on,
  drop column fixed_time,
  drop column not_before,
  drop column pinned_on,
  drop column status,
  drop column started_at,
  drop column actual_minutes,
  drop column remaining_minutes,
  drop column hold_reason;

-- A garment only within a job; a step of no job is her own studio work.
alter table public.task
  add constraint task_garment_needs_job check (order_item_id is null or order_id is not null),
  add constraint task_until_after_on check (until_day is null or (on_day is not null and until_day > on_day)),
  add constraint task_time_needs_day check (starts_at is null or on_day is not null),
  add constraint task_end_after_start check (ends_at is null or (starts_at is not null and ends_at > starts_at));

-- Removing a garment keeps the job's steps; they are simply no longer about that garment.
alter table public.task drop constraint task_garment_fk;
alter table public.task add constraint task_garment_fk foreign key (owner_id, order_id, order_item_id)
  references public.order_item (owner_id, order_id, id) on delete set null (order_item_id);

insert into public.task (owner_id, order_id, sort, title, on_day)
select owner_id, order_id, sort, title, on_day from carried_preparation;
drop table carried_preparation;

comment on table public.task is
  'One step of a job (or of no job: her own studio work). A day, an optional last day, an optional time.';
comment on column public.task.on_day is 'The day of the step, or its first day. Empty: not given a day yet.';
comment on column public.task.until_day is 'The last day, for a step that runs over several days.';
comment on column public.task.starts_at is 'Optional: when on its day (each of its days) she does it.';
comment on column public.task.done_on is 'The day she ticked it done. Empty: still to do.';

create function app.task_done_not_in_future() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.done_on is not null and new.done_on > app.today_for(new.owner_id) then
    raise exception 'a step cannot be done on a day that has not come yet' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger task_done_not_in_future before insert or update on public.task
  for each row execute function app.task_done_not_in_future();

revoke update on public.task from authenticated;
grant update (sort, title, order_item_id, on_day, until_day, starts_at, ends_at, done_on) on public.task
  to authenticated;

create index task_by_day on public.task (owner_id, on_day) where done_on is null;

create function app.task_log() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.order_id is not null and new.done_on is not null and old.done_on is null then
    perform app.log_event(new.owner_id, new.order_id, null, 'task_done',
      jsonb_build_object('title', new.title, 'done_on', new.done_on));
  end if;
  return null;
end;
$$;
create trigger task_log after update on public.task
  for each row execute function app.task_log();

-- ---------------------------------------------------------------------------------------------
-- 4. Jobs: a kind, and no garment needed. The table keeps its name; the screens say "job".

alter table public.orders
  add column kind text not null default 'new_order'
    check (kind in ('new_order', 'fix', 'appointment', 'sketch', 'delivery'));
comment on column public.orders.kind is
  'What kind of job: a new order (the usual, so the default), a fix, an appointment, a sketch, a delivery.';
comment on column public.orders.delivery_on is 'The due day: delivery, or the day of the appointment.';

drop trigger orders_log_update on public.orders;
alter table public.orders drop column buffer_days;

revoke update on public.orders from authenticated;
grant update (client_id, kind, status, delivery_on, hold_reason, cancel_reason, delivered_on, notes)
  on public.orders to authenticated;

drop trigger order_keeps_a_garment on public.order_item;
drop function app.order_keeps_a_garment();

-- Replaces Stage 2's: a job is confirmed without a garment.
create or replace function app.orders_before_update() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  today date := app.today_for(new.owner_id);
begin
  if old.status in ('delivered', 'cancelled') and new.status = old.status
     and (to_jsonb(new) - 'notes' - 'updated_at') <> (to_jsonb(old) - 'notes' - 'updated_at') then
    raise exception 'a % order can only have its notes changed; reopen it first', old.status
      using errcode = '23514';
  end if;

  if new.status <> old.status then
    if not app.order_move_allowed(old.status, new.status) then
      raise exception 'an order cannot go from % to %', old.status, new.status using errcode = '23514';
    end if;

    -- Leaving a status clears what belonged to it. (What the new status needs is checked by the table.)
    if old.status = 'on_hold' then new.hold_reason := ''; end if;
    if old.status = 'cancelled' then new.cancel_reason := ''; end if;
    if old.status = 'delivered' then new.delivered_on := null; end if;

    if new.status = 'active' and new.delivery_on < today then
      raise exception 'the handover day has passed; choose a new one' using errcode = '23514';
    end if;
    if new.status = 'delivered' and new.delivered_on > today then
      raise exception 'an order cannot be delivered in the future' using errcode = '23514';
    end if;
  elsif new.status = 'active' and new.delivery_on <> old.delivery_on and new.delivery_on < today then
    raise exception 'the handover day of an active order cannot be in the past' using errcode = '23514';
  end if;

  return new;
end;
$$;

-- Replaces Stage 2's: no safety margin any more.
create or replace function app.orders_log_update() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_from text;
  v_to text;
begin
  if new.status <> old.status then
    perform app.log_event(new.owner_id, new.id, null, 'status_changed', jsonb_strip_nulls(jsonb_build_object(
      'from', old.status,
      'to', new.status,
      'reason', nullif(case new.status when 'on_hold' then new.hold_reason when 'cancelled' then new.cancel_reason end, ''),
      'delivered_on', new.delivered_on
    )));
  end if;
  if new.delivery_on <> old.delivery_on then
    perform app.log_event(new.owner_id, new.id, null, 'delivery_changed',
      jsonb_build_object('from', old.delivery_on, 'to', new.delivery_on));
  end if;
  if new.client_id <> old.client_id then
    -- Names, not ids: the old client may be deleted later, and the history must still read.
    select c.name into v_from from public.client c where c.owner_id = new.owner_id and c.id = old.client_id;
    select c.name into v_to from public.client c where c.owner_id = new.owner_id and c.id = new.client_id;
    perform app.log_event(new.owner_id, new.id, null, 'client_changed',
      jsonb_build_object('from', v_from, 'to', v_to));
  end if;
  return null;
end;
$$;
create trigger orders_log_update after update on public.orders
  for each row execute function app.orders_log_update();

-- ---------------------------------------------------------------------------------------------
-- 5. Templates: a list of steps for one kind of job, each with how many days before the due day it starts and how
-- many days it runs. They suggest days; the job keeps the days she settles on.

alter table public.template add column kind text not null default 'new_order'
  check (kind in ('new_order', 'fix', 'appointment', 'sketch', 'delivery'));

drop trigger template_before_update on public.template;
create or replace function app.template_before_update() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.name, new.kind, new.notes) is distinct from (old.name, old.kind, old.notes) then
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;
create trigger template_before_update before update on public.template
  for each row execute function app.template_before_update();
alter table public.template drop column garment_type;

revoke update on public.template from authenticated;
grant update (name, kind, notes) on public.template to authenticated;

alter table public.template_task
  add column days_before integer not null default 0 check (days_before between 0 and 365),
  add column span_days integer not null default 1 check (span_days between 1 and 60),
  -- A step done with the client there (a fitting, the appointment itself): it asks for a time.
  add column with_client boolean not null default false;

-- The starter templates nobody has changed are replaced by the new starters below
-- (first: reshaping the steps below counts as a change).
delete from public.template t
where t.version = 1 and t.name in ('Bridal gown', 'Evening dress', 'Suit alteration')
  and t.notes like 'A starting point written without you.%';

-- Her own templates keep their steps, spread over four weeks before the due day in their order; she adjusts them.
-- An appointment of the old kind is done with the client.
update public.template_task t set
  days_before = case when n.total > 1 then round(28.0 * (n.total - n.position) / (n.total - 1))::integer else 0 end,
  with_client = (t.kind = 'fixed')
from (
  select x.id, row_number() over (partition by x.template_id order by x.sort, x.title) as position,
         count(*) over (partition by x.template_id) as total
  from public.template_task x
) n
where n.id = t.id;

alter table public.template_task
  drop column kind,
  drop column minutes,
  drop column days;

revoke update on public.template_task from authenticated;
grant update (sort, title, days_before, span_days, with_client) on public.template_task to authenticated;

drop function app.seed_templates(uuid);
drop function app.write_template(uuid, jsonb);

-- Writes one template: { name, kind, notes, steps: [ { title, before, span?, client? } ] }.
create function app.write_template(p_owner uuid, p_spec jsonb) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_template uuid;
  v_step jsonb;
  v_n integer := 0;
begin
  insert into public.template (owner_id, name, kind, notes)
  values (p_owner, p_spec ->> 'name', p_spec ->> 'kind', coalesce(p_spec ->> 'notes', ''))
  returning id into v_template;
  for v_step in select * from jsonb_array_elements(p_spec -> 'steps') loop
    v_n := v_n + 10;
    insert into public.template_task (owner_id, template_id, sort, title, days_before, span_days, with_client)
    values (p_owner, v_template, v_n, v_step ->> 'title', (v_step ->> 'before')::integer,
            coalesce((v_step ->> 'span')::integer, 1), coalesce((v_step ->> 'client')::boolean, false));
  end loop;
  update public.template set version = 1 where id = v_template;
  return v_template;
end;
$$;
revoke all on function app.write_template(uuid, jsonb) from public, anon, authenticated;

-- One starter per kind, and a bridal gown. Only names she does not already have.
create function app.seed_templates(p_owner uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_note constant text := 'A starting point. Change the steps and the days to how you work.';
  v_spec jsonb;
begin
  for v_spec in select * from jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('name', 'Dress', 'kind', 'new_order', 'steps', '[
      {"title": "Buy fabric", "before": 28},
      {"title": "Cutting", "before": 24},
      {"title": "Sewing", "before": 21, "span": 7},
      {"title": "First fitting", "before": 13, "client": true},
      {"title": "Alterations", "before": 11, "span": 3},
      {"title": "Second fitting", "before": 6, "client": true},
      {"title": "Finishing and pressing", "before": 3, "span": 2},
      {"title": "Delivery", "before": 0, "client": true}
    ]'::jsonb),
    jsonb_build_object('name', 'Bridal gown', 'kind', 'new_order', 'steps', '[
      {"title": "Design agreed with the client", "before": 56, "client": true},
      {"title": "Buy fabric and lace", "before": 49},
      {"title": "Cutting", "before": 42},
      {"title": "Sewing", "before": 40, "span": 10},
      {"title": "First fitting", "before": 28, "client": true},
      {"title": "Alterations", "before": 26, "span": 3},
      {"title": "Lace work", "before": 21, "span": 7},
      {"title": "Second fitting", "before": 12, "client": true},
      {"title": "Finishing and pressing", "before": 8, "span": 4},
      {"title": "Final fitting", "before": 3, "client": true},
      {"title": "Delivery", "before": 0, "client": true}
    ]'::jsonb),
    jsonb_build_object('name', 'Fix', 'kind', 'fix', 'steps', '[
      {"title": "Fix", "before": 2},
      {"title": "Delivery", "before": 0, "client": true}
    ]'::jsonb),
    jsonb_build_object('name', 'Appointment', 'kind', 'appointment', 'steps', '[
      {"title": "Appointment", "before": 0, "client": true}
    ]'::jsonb),
    jsonb_build_object('name', 'Sketch', 'kind', 'sketch', 'steps', '[
      {"title": "Sketch", "before": 3, "span": 2},
      {"title": "Show the client", "before": 0, "client": true}
    ]'::jsonb),
    jsonb_build_object('name', 'Delivery', 'kind', 'delivery', 'steps', '[
      {"title": "Delivery", "before": 0, "client": true}
    ]'::jsonb)
  )) loop
    if not exists (
      select 1 from public.template t where t.owner_id = p_owner and lower(t.name) = lower(v_spec ->> 'name')
    ) then
      perform app.write_template(p_owner, v_spec || jsonb_build_object('notes', v_note));
    end if;
  end loop;
end;
$$;
revoke all on function app.seed_templates(uuid) from public, anon, authenticated;

-- A working week to start from: Monday to Saturday, 8:30 to 17:00 with lunch. Only for someone with none.
create function app.seed_work_week(p_owner uuid) returns void
language sql security definer
set search_path = ''
as $$
  insert into public.work_week (owner_id, weekday, start_time, end_time, breaks)
  select p_owner, d, time '08:30', time '17:00', '[{"start": "12:30", "end": "13:30"}]'::jsonb
  from generate_series(1, 6) d
  where not exists (select 1 from public.work_week w where w.owner_id = p_owner);
$$;
revoke all on function app.seed_work_week(uuid) from public, anon, authenticated;

create or replace function app.handle_new_user() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profile (owner_id, name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''));
  perform app.seed_measurement_fields(new.id);
  perform app.seed_templates(new.id);
  perform app.seed_work_week(new.id);
  return new;
end;
$$;
revoke all on function app.handle_new_user() from public, anon, authenticated;

select app.seed_templates(owner_id), app.seed_work_week(owner_id) from public.profile;

-- ---------------------------------------------------------------------------------------------
-- 6. What the screens call.

-- A new job in one go: the client (new or existing), the job, its garment if it has one, and its steps with the
-- days the app suggested (src/domain/steps). Returns the job's id.
create function public.create_job(
  p_kind text,
  p_client_id uuid,
  p_client_name text,
  p_client_phone text,
  p_number integer,
  p_due_on date,
  p_notes text,
  p_garment_type text,
  p_brief text,
  p_steps jsonb,
  p_confirm boolean
) returns uuid
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_client uuid := p_client_id;
  v_order uuid;
  v_item uuid;
begin
  if jsonb_typeof(p_steps) is distinct from 'array' or jsonb_array_length(p_steps) > 100 then
    raise exception 'steps must be a list of at most 100' using errcode = '22023';
  end if;
  if v_client is null then
    insert into public.client (name, phone) values (p_client_name, coalesce(p_client_phone, ''))
    returning id into v_client;
  end if;

  insert into public.orders (kind, number, client_id, delivery_on, notes)
  values (p_kind, p_number, v_client, p_due_on, coalesce(p_notes, ''))
  returning id into v_order;

  if nullif(btrim(coalesce(p_garment_type, '')), '') is not null then
    insert into public.order_item (order_id, garment_type, brief, measurement_set_id)
    values (v_order, btrim(p_garment_type), coalesce(p_brief, ''), app.latest_measurement_set(v_client))
    returning id into v_item;
  end if;

  insert into public.task (order_id, order_item_id, sort, title, on_day, until_day, starts_at, ends_at)
  select v_order, v_item, (e.n * 10)::integer, e.step ->> 'title', (e.step ->> 'on_day')::date,
         (e.step ->> 'until_day')::date, (e.step ->> 'starts_at')::time, (e.step ->> 'ends_at')::time
  from jsonb_array_elements(p_steps) with ordinality as e(step, n);

  if p_confirm then
    update public.orders set status = 'active' where id = v_order;
  end if;
  return v_order;
end;
$$;
revoke all on function public.create_job(text, uuid, text, text, integer, date, text, text, text, jsonb, boolean)
  from public, anon;
grant execute on function public.create_job(text, uuid, text, text, integer, date, text, text, text, jsonb, boolean)
  to authenticated;

-- Moves a job's due day, and with it, if she says so, every step not yet done, by the same number of days.
create function public.move_due_day(p_order_id uuid, p_due_on date, p_move_steps boolean) returns integer
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_old date;
  v_moved integer := 0;
begin
  select o.delivery_on into v_old from public.orders o where o.id = p_order_id for update;
  if v_old is null then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  update public.orders set delivery_on = p_due_on where id = p_order_id;
  if p_move_steps and p_due_on <> v_old then
    update public.task k set
      on_day = k.on_day + (p_due_on - v_old),
      until_day = k.until_day + (p_due_on - v_old)
    where k.order_id = p_order_id and k.done_on is null and k.on_day is not null;
    get diagnostics v_moved = row_count;
  end if;
  return v_moved;
end;
$$;
revoke all on function public.move_due_day(uuid, date, boolean) from public, anon;
grant execute on function public.move_due_day(uuid, date, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 7. The export's schema.

create or replace function app.schema_version() returns text
language sql immutable
set search_path = ''
as $$ select '20261101090000'::text $$;
