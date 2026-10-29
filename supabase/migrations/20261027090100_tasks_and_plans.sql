-- Stage 3, part 2: an order's tasks, the links between them, what each waits for, applying a template, and plans:
-- proposed, approved, replaced. The model and the reasons are in docs/planning.md and decisions 0030 to 0037.

-- ---------------------------------------------------------------------------------------------
-- References that must stay inside one order carry the order too, so the parent needs that key.

alter table public.order_item add constraint order_item_in_order_key unique (owner_id, order_id, id);
alter table public.prerequisite add constraint prerequisite_in_order_key unique (owner_id, order_id, id);

-- Which template, at which version, a garment was planned from. Written only by apply_template().
-- Deleting the template leaves the record of the version, and only forgets which template it was.
alter table public.order_item
  add column template_id uuid,
  add column template_version integer check (template_version > 0),
  add constraint order_item_template_fk foreign key (owner_id, template_id)
    references public.template (owner_id, id) on delete set null (template_id);

-- ---------------------------------------------------------------------------------------------
-- Tasks. No dates: dates belong to a plan. Kinds and their columns as in template_task.

create table public.task (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  order_id uuid not null,
  -- The garment the task is for.
  order_item_id uuid not null,
  sort integer not null default 0 check (sort between 0 and 100000),
  title text not null check (title = btrim(title) and char_length(title) between 1 and 120),
  kind text not null check (kind in ('work', 'wait', 'fixed', 'milestone')),
  minutes integer check (minutes between 1 and 6000),
  days integer check (days between 1 and 60),
  -- An appointment's day and clock time, agreed with the client. Both or neither: until then it is not planned.
  fixed_on date check (fixed_on between date '2000-01-01' and date '2099-12-31'),
  fixed_time time check (fixed_time is null or (extract(second from fixed_time) = 0)),
  -- The earliest day it may start.
  not_before date check (not_before between date '2000-01-01' and date '2099-12-31'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_owner_id_key unique (owner_id, id),
  constraint task_in_order_key unique (owner_id, order_id, id),
  constraint task_order_fk foreign key (owner_id, order_id)
    references public.orders (owner_id, id) on delete cascade,
  constraint task_garment_fk foreign key (owner_id, order_id, order_item_id)
    references public.order_item (owner_id, order_id, id) on delete cascade,
  constraint task_minutes_match check ((kind in ('work', 'fixed')) = (minutes is not null)),
  constraint task_days_match check ((kind = 'wait') = (days is not null)),
  constraint task_fixed_day_and_time check ((fixed_on is null) = (fixed_time is null)),
  constraint task_only_appointments_are_fixed check (kind = 'fixed' or fixed_on is null)
);
comment on table public.task is 'One step of one garment. Its days are in plan_slot, never here.';
create index task_by_order on public.task (owner_id, order_id, sort);

create trigger task_updated_at before update on public.task
  for each row execute function app.set_updated_at();
create trigger task_closed before insert or update or delete on public.task
  for each row execute function app.refuse_change_to_closed_order();

select app.secure_owner_table('public.task');
revoke update on public.task from authenticated;
grant update (sort, title, kind, minutes, days, fixed_on, fixed_time, not_before) on public.task to authenticated;

-- Which task follows which, inside one order: the engine refuses links between orders, so the table does too.
create table public.task_edge (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  order_id uuid not null,
  from_task uuid not null,
  to_task uuid not null,
  lag_days integer not null default 0 check (lag_days between 0 and 30),
  primary key (from_task, to_task),
  constraint task_edge_not_to_itself check (from_task <> to_task),
  constraint task_edge_order_fk foreign key (owner_id, order_id)
    references public.orders (owner_id, id) on delete cascade,
  constraint task_edge_from_fk foreign key (owner_id, order_id, from_task)
    references public.task (owner_id, order_id, id) on delete cascade,
  constraint task_edge_to_fk foreign key (owner_id, order_id, to_task)
    references public.task (owner_id, order_id, id) on delete cascade
);
create index task_edge_by_order on public.task_edge (owner_id, order_id);

create function app.task_edge_no_loop() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.order_id::text, 0));
  if exists (
    with recursive after_it (task) as (
      select e.to_task from public.task_edge e
      where e.owner_id = new.owner_id and e.from_task = new.to_task
      union
      select e.to_task from public.task_edge e join after_it a on e.from_task = a.task
      where e.owner_id = new.owner_id
    )
    select 1 from after_it where task = new.from_task
  ) then
    raise exception 'that link would make a loop: a task would have to come after itself' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger task_edge_no_loop before insert or update on public.task_edge
  for each row execute function app.task_edge_no_loop();
create trigger task_edge_closed before insert or update or delete on public.task_edge
  for each row execute function app.refuse_change_to_closed_order();

select app.secure_owner_table('public.task_edge');
revoke update on public.task_edge from authenticated;
grant update (lag_days) on public.task_edge to authenticated;

-- Which task waits for which preparation item, inside one order.
create table public.task_requires (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  order_id uuid not null,
  task_id uuid not null,
  prerequisite_id uuid not null,
  primary key (task_id, prerequisite_id),
  constraint task_requires_order_fk foreign key (owner_id, order_id)
    references public.orders (owner_id, id) on delete cascade,
  constraint task_requires_task_fk foreign key (owner_id, order_id, task_id)
    references public.task (owner_id, order_id, id) on delete cascade,
  constraint task_requires_prerequisite_fk foreign key (owner_id, order_id, prerequisite_id)
    references public.prerequisite (owner_id, order_id, id) on delete cascade
);
create index task_requires_by_order on public.task_requires (owner_id, order_id);

create trigger task_requires_closed before insert or delete on public.task_requires
  for each row execute function app.refuse_change_to_closed_order();

select app.secure_owner_table('public.task_requires');
revoke update on public.task_requires from authenticated;

-- ---------------------------------------------------------------------------------------------
-- History: two new events. (Replaces the Stage 2 list; a test compares it with the screen's.)

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
    'template_applied', 'plan_approved'
  ];
$$;

create function app.order_item_template_log() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_name text;
  v_tasks integer;
begin
  select t.name into v_name from public.template t where t.owner_id = new.owner_id and t.id = new.template_id;
  select count(*) into v_tasks from public.task k where k.owner_id = new.owner_id and k.order_item_id = new.id;
  perform app.log_event(new.owner_id, new.order_id, null, 'template_applied', jsonb_build_object(
    'garment_type', new.garment_type, 'template', v_name, 'version', new.template_version, 'tasks', v_tasks));
  return null;
end;
$$;
create trigger order_item_template_log after update of template_version on public.order_item
  for each row when (new.template_version is not null and new.template_version is distinct from old.template_version)
  execute function app.order_item_template_log();

-- ---------------------------------------------------------------------------------------------
-- Applying a template to a garment: one transaction, or nothing.

create function public.apply_template(p_garment uuid, p_template uuid) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  -- Runs with the owner's rights so it can record the template on the garment, which she may not write
  -- herself. Every row it reads or writes is therefore limited to her own, by hand.
  v_owner uuid := auth.uid();
  v_order uuid;
  v_version integer;
  v_prereq jsonb := '{}'::jsonb;
  v_task jsonb := '{}'::jsonb;
  v_row record;
  v_id uuid;
  v_sort integer;
  v_count integer := 0;
begin
  if v_owner is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select g.order_id into v_order from public.order_item g where g.owner_id = v_owner and g.id = p_garment;
  if v_order is null then
    raise exception 'garment not found' using errcode = 'P0002';
  end if;
  select t.version into v_version from public.template t where t.owner_id = v_owner and t.id = p_template;
  if v_version is null then
    raise exception 'template not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.task k where k.owner_id = v_owner and k.order_item_id = p_garment) then
    raise exception 'this garment already has tasks; remove them before applying a template' using errcode = '23514';
  end if;

  -- What the garment waits for: the order's item with the same label, or a new one.
  for v_row in
    select p.id, p.kind, p.label, p.blocking from public.template_prerequisite p
    where p.owner_id = v_owner and p.template_id = p_template order by p.sort, p.label
  loop
    select q.id into v_id from public.prerequisite q
    where q.owner_id = v_owner and q.order_id = v_order and lower(btrim(q.label)) = lower(btrim(v_row.label))
    order by q.created_at limit 1;
    if v_id is null then
      insert into public.prerequisite (owner_id, order_id, kind, label, blocking)
      values (v_owner, v_order, v_row.kind, v_row.label, v_row.blocking)
      returning id into v_id;
    end if;
    v_prereq := v_prereq || jsonb_build_object(v_row.id::text, v_id);
  end loop;

  -- The tasks, after any the order already has.
  select coalesce(max(k.sort), 0) into v_sort from public.task k where k.owner_id = v_owner and k.order_id = v_order;
  for v_row in
    select t.id, t.title, t.kind, t.minutes, t.days from public.template_task t
    where t.owner_id = v_owner and t.template_id = p_template order by t.sort, t.title
  loop
    v_sort := v_sort + 10;
    insert into public.task (owner_id, order_id, order_item_id, sort, title, kind, minutes, days)
    values (v_owner, v_order, p_garment, least(v_sort, 100000), v_row.title, v_row.kind, v_row.minutes, v_row.days)
    returning id into v_id;
    v_task := v_task || jsonb_build_object(v_row.id::text, v_id);
    v_count := v_count + 1;
  end loop;

  insert into public.task_edge (owner_id, order_id, from_task, to_task, lag_days)
  select v_owner, v_order, (v_task ->> e.from_task::text)::uuid, (v_task ->> e.to_task::text)::uuid, e.lag_days
  from public.template_edge e where e.owner_id = v_owner and e.template_id = p_template;

  insert into public.task_requires (owner_id, order_id, task_id, prerequisite_id)
  select v_owner, v_order, (v_task ->> r.task_id::text)::uuid, (v_prereq ->> r.prerequisite_id::text)::uuid
  from public.template_requires r where r.owner_id = v_owner and r.template_id = p_template
  on conflict do nothing;

  update public.order_item set template_id = p_template, template_version = v_version
  where owner_id = v_owner and id = p_garment;
  return v_count;
end;
$$;
revoke all on function public.apply_template(uuid, uuid) from public, anon;
grant execute on function public.apply_template(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The planning epoch: counts up whenever a fact the engine reads changes, so a plan made before the change can
-- be recognised as out of date, and can never be approved (decision 0034).

alter table public.profile add column plan_epoch bigint not null default 0;
comment on column public.profile.plan_epoch is
  'Raised by triggers whenever a planning fact changes. A plan made at another epoch is out of date.';

-- She may change her own settings, but never the epoch: it is the database's own count.
revoke update, delete on public.profile from authenticated;
grant update (name, timezone, locale, calendar, planning_ratio, default_buffer_days, measurement_unit)
  on public.profile to authenticated;

create function app.bump_plan_epoch(p_owner uuid) returns void
language sql security definer
set search_path = ''
as $$
  update public.profile set plan_epoch = plan_epoch + 1 where owner_id = p_owner;
$$;
revoke all on function app.bump_plan_epoch(uuid) from public, anon, authenticated;

create function app.planning_fact_changed() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform app.bump_plan_epoch(old.owner_id);
  else
    perform app.bump_plan_epoch(new.owner_id);
  end if;
  return null;
end;
$$;
revoke all on function app.planning_fact_changed() from public, anon, authenticated;

create trigger task_epoch after insert or update or delete on public.task
  for each row execute function app.planning_fact_changed();
create trigger task_edge_epoch after insert or update or delete on public.task_edge
  for each row execute function app.planning_fact_changed();
create trigger task_requires_epoch after insert or delete on public.task_requires
  for each row execute function app.planning_fact_changed();
create trigger prerequisite_epoch after insert or delete on public.prerequisite
  for each row execute function app.planning_fact_changed();
create trigger prerequisite_epoch_update after update on public.prerequisite
  for each row when ((new.state, new.expected_on, new.blocking, new.label)
                     is distinct from (old.state, old.expected_on, old.blocking, old.label))
  execute function app.planning_fact_changed();
create trigger orders_epoch after insert or delete on public.orders
  for each row execute function app.planning_fact_changed();
create trigger orders_epoch_update after update on public.orders
  for each row when ((new.status, new.delivery_on, new.buffer_days)
                     is distinct from (old.status, old.delivery_on, old.buffer_days))
  execute function app.planning_fact_changed();
create trigger work_week_epoch after insert or update or delete on public.work_week
  for each row execute function app.planning_fact_changed();
create trigger calendar_exception_epoch after insert or update or delete on public.calendar_exception
  for each row execute function app.planning_fact_changed();

create function app.profile_epoch() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.planning_ratio, new.timezone) is distinct from (old.planning_ratio, old.timezone) then
    new.plan_epoch := old.plan_epoch + 1;
  end if;
  return new;
end;
$$;
create trigger profile_epoch before update on public.profile
  for each row execute function app.profile_epoch();

-- ---------------------------------------------------------------------------------------------
-- Plans. Written and decided only through the functions below; nothing edits a plan afterwards.

create table public.plan_version (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- 1, 2, 3 ... per designer, as she sees them.
  number integer not null check (number > 0),
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'superseded', 'rejected')),
  -- The approved plan this one was built on, if there was one.
  base_number integer check (base_number > 0),
  -- The planning epoch it was made at, and the day it was made for.
  epoch bigint not null,
  made_for date not null,
  -- What the engine found (orders, tasks, findings), the calendar it used, and the names of that moment.
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint plan_version_owner_id_key unique (owner_id, id),
  constraint plan_version_number_key unique (owner_id, number),
  constraint plan_version_decided check ((status = 'proposed') = (decided_at is null))
);
comment on table public.plan_version is 'A proposed or approved plan for the whole atelier. Never edited.';
-- Only one plan is ever approved.
create unique index plan_version_one_approved on public.plan_version (owner_id) where status = 'approved';

select app.secure_owner_table('public.plan_version');
revoke insert, update, delete on public.plan_version from authenticated;

create table public.plan_slot (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  plan_id uuid not null,
  task_id uuid not null,
  day date not null,
  minutes integer not null check (minutes between 1 and 1440),
  -- Its place in the day, 1 first.
  rank integer not null check (rank > 0),
  -- Only appointments have a clock time.
  at_time time,
  primary key (plan_id, task_id, day),
  constraint plan_slot_plan_fk foreign key (owner_id, plan_id)
    references public.plan_version (owner_id, id) on delete cascade,
  constraint plan_slot_task_fk foreign key (owner_id, task_id)
    references public.task (owner_id, id) on delete cascade
);
comment on table public.plan_slot is 'Minutes of one task on one day in one plan. My Day reads today''s, by rank.';
create index plan_slot_by_day on public.plan_slot (owner_id, plan_id, day, rank);

select app.secure_owner_table('public.plan_slot');
revoke insert, update, delete on public.plan_slot from authenticated;

-- Stores a proposal made by the engine. Refuses if the facts changed while it was being made, or if it was made
-- for a day that is not her today. Returns its number.
create function public.save_proposal(p_epoch bigint, p_made_for date, p_result jsonb, p_slots jsonb)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_epoch bigint;
  v_base integer;
  v_number integer;
  v_id uuid;
begin
  if v_owner is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  -- One proposal or approval at a time per designer, and the epoch cannot move under us.
  select p.plan_epoch into v_epoch from public.profile p where p.owner_id = v_owner for update;
  if v_epoch is distinct from p_epoch then
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

  insert into public.plan_version (owner_id, number, base_number, epoch, made_for, result)
  values (v_owner, v_number, v_base, p_epoch, p_made_for, p_result)
  returning id into v_id;

  insert into public.plan_slot (owner_id, plan_id, task_id, day, minutes, rank, at_time)
  select v_owner, v_id, s.task_id, s.day, s.minutes, s.rank, s.at_time
  from jsonb_to_recordset(p_slots) as s(task_id uuid, day date, minutes integer, rank integer, at_time time);

  return v_number;
end;
$$;
revoke all on function public.save_proposal(bigint, date, jsonb, jsonb) from public, anon;
grant execute on function public.save_proposal(bigint, date, jsonb, jsonb) to authenticated;

-- Approves a proposal: the one approved plan becomes replaced, as does every other open proposal.
create function public.approve_plan(p_number integer) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_plan public.plan_version;
  v_epoch bigint;
  v_current integer;
begin
  if v_owner is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select p.plan_epoch into v_epoch from public.profile p where p.owner_id = v_owner for update;
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
revoke all on function public.approve_plan(integer) from public, anon;
grant execute on function public.approve_plan(integer) to authenticated;

create function public.reject_plan(p_number integer) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_changed integer;
begin
  if v_owner is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  update public.plan_version set status = 'rejected', decided_at = now()
  where owner_id = v_owner and number = p_number and status = 'proposed';
  get diagnostics v_changed = row_count;
  if v_changed = 0 then
    raise exception 'only an open proposal can be rejected' using errcode = '23514';
  end if;
end;
$$;
revoke all on function public.reject_plan(integer) from public, anon;
grant execute on function public.reject_plan(integer) to authenticated;

-- Each order in an approved plan gets a line in its history: the plan's number, the order's state and its ready day.
create function app.plan_version_log() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_order jsonb;
begin
  for v_order in select * from jsonb_array_elements(coalesce(new.result -> 'orders', '[]'::jsonb)) loop
    if exists (
      select 1 from public.orders o where o.owner_id = new.owner_id and o.id::text = v_order ->> 'id'
    ) then
      perform app.log_event(new.owner_id, (v_order ->> 'id')::uuid, null, 'plan_approved', jsonb_strip_nulls(
        jsonb_build_object('number', new.number, 'state', v_order ->> 'state', 'ready_on', v_order ->> 'readyOn')));
    end if;
  end loop;
  return null;
end;
$$;
create trigger plan_version_log after update of status on public.plan_version
  for each row when (new.status = 'approved' and old.status <> 'approved')
  execute function app.plan_version_log();
