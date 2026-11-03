-- A step partly done (decision 0087). When part of a step is done but not all of it, she marks it started and notes
-- what is left ("bodice and sleeves left"). It stays open: on her calendar until it is done, and moved to her today
-- when its day has passed, like any unfinished step (decision 0080). A Delivery is done or not: it is never started.
--
-- Released before the app that uses it (decision 0082): two new columns, empty on every step, so the app that is
-- live keeps working; nothing writes them until the new app does.

alter table public.task
  add column started_on date,
  add column left_note text,
  add constraint task_left_note_length check (left_note is null or char_length(btrim(left_note)) between 1 and 200),
  add constraint task_left_note_needs_start check (left_note is null or started_on is not null),
  add constraint task_delivery_not_started check (started_on is null or lower(btrim(title)) <> 'delivery');
comment on column public.task.started_on is
  'The day she marked the step part done (decision 0087); null for a step not started. Kept when it is done.';
comment on column public.task.left_note is
  'What is left of a step part done, in her words (decision 0087).';

grant update (started_on, left_note) on public.task to authenticated;

-- "Part done" is on the order's history, and so in the others' notifications (decision 0083), with what is left.
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
    'task_done', 'task_hold', 'task_started'
  ];
$$;

create or replace function app.task_log() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.order_id is not null and new.done_on is not null and old.done_on is null then
    perform app.log_event(new.owner_id, new.order_id, null, 'task_done',
      jsonb_build_object('title', new.title, 'done_on', new.done_on));
  elsif new.order_id is not null and new.done_on is null and new.started_on is not null
    and (old.started_on is null or new.left_note is distinct from old.left_note) then
    perform app.log_event(new.owner_id, new.order_id, null, 'task_started',
      jsonb_strip_nulls(jsonb_build_object('title', new.title, 'left', new.left_note)));
  end if;
  return null;
end;
$$;

create or replace function app.schema_version() returns text
language sql immutable
set search_path = ''
as $$ select '20261107090000'::text $$;
