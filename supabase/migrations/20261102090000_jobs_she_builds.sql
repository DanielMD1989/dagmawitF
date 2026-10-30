-- Jobs she builds (docs/calendar-first.md, second round; decision 0068). A job has no kind: it is for a client or for
-- nobody (an event, such as a bazaar), it says in a few words what it is, and its steps are the ones she picks, on the
-- days she sets. Templates become plain lists of step titles.

-- ---------------------------------------------------------------------------------------------
-- 1. What a job is, in her words. Existing jobs are named after their first garment.

alter table public.orders
  add column title text not null default '' check (title = btrim(title) and char_length(title) <= 120);
comment on column public.orders.title is 'What the job is, in her words: "Bridal gown", "Bazaar at the Hyatt".';

-- Her data, not a change she made: the app's own triggers stay off (a finished job is otherwise frozen).
alter table public.orders disable trigger user;
update public.orders o set title = left(btrim(g.garment_type), 120)
from (
  select distinct on (i.order_id) i.order_id, i.garment_type
  from public.order_item i
  order by i.order_id, i.created_at, i.id
) g
where g.order_id = o.id;
alter table public.orders enable trigger user;

-- ---------------------------------------------------------------------------------------------
-- 2. A job for nobody is an event, and an event has a name.

alter table public.orders
  alter column client_id drop not null,
  add constraint orders_event_has_title check (client_id is not null or title <> '');

alter table public.orders drop column kind;

revoke update on public.orders from authenticated;
grant update (client_id, title, status, delivery_on, hold_reason, cancel_reason, delivered_on, notes)
  on public.orders to authenticated;

-- Replaces 0066's: a change of client may be to or from nobody.
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
  if new.client_id is distinct from old.client_id then
    -- Names, not ids: the old client may be deleted later, and the history must still read.
    select c.name into v_from from public.client c where c.owner_id = new.owner_id and c.id = old.client_id;
    select c.name into v_to from public.client c where c.owner_id = new.owner_id and c.id = new.client_id;
    perform app.log_event(new.owner_id, new.id, null, 'client_changed',
      jsonb_strip_nulls(jsonb_build_object('from', v_from, 'to', v_to)));
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. Templates: lists of step titles. She gives the days on the job.

drop trigger template_before_update on public.template;
create or replace function app.template_before_update() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.name, new.notes) is distinct from (old.name, old.notes) then
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;
create trigger template_before_update before update on public.template
  for each row execute function app.template_before_update();

-- The one-step starters of 0066 nobody has changed are not lists; they go.
delete from public.template t
where t.version = 1
  and t.name in ('Fix', 'Appointment', 'Sketch', 'Delivery')
  and t.notes = 'A starting point. Change the steps and the days to how you work.';
update public.template set notes = '' where notes = 'A starting point. Change the steps and the days to how you work.';

alter table public.template drop column kind;
revoke update on public.template from authenticated;
grant update (name, notes) on public.template to authenticated;

alter table public.template_task
  drop column days_before,
  drop column span_days,
  drop column with_client;
revoke update on public.template_task from authenticated;
grant update (sort, title) on public.template_task to authenticated;

drop function app.seed_templates(uuid);
drop function app.write_template(uuid, jsonb);

-- Two lists to start from, only if she has none of that name.
create function app.seed_templates(p_owner uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_spec jsonb;
  v_template uuid;
  v_title text;
  v_n integer;
begin
  for v_spec in select * from jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('name', 'Bridal gown', 'steps', jsonb_build_array(
      'Appointment', 'Sketch', 'Buy fabric and lace', 'Cutting', 'Sewing', 'First fitting', 'Lace work',
      'Second fitting', 'Finishing and pressing', 'Final fitting', 'Delivery')),
    jsonb_build_object('name', 'Dress', 'steps', jsonb_build_array(
      'Buy fabric', 'Cutting', 'Sewing', 'Fitting', 'Finishing and pressing', 'Delivery'))
  )) loop
    if exists (
      select 1 from public.template t where t.owner_id = p_owner and lower(t.name) = lower(v_spec ->> 'name')
    ) then
      continue;
    end if;
    insert into public.template (owner_id, name) values (p_owner, v_spec ->> 'name') returning id into v_template;
    v_n := 0;
    for v_title in select jsonb_array_elements_text(v_spec -> 'steps') loop
      v_n := v_n + 10;
      insert into public.template_task (owner_id, template_id, sort, title) values (p_owner, v_template, v_n, v_title);
    end loop;
    update public.template set version = 1 where id = v_template;
  end loop;
end;
$$;
revoke all on function app.seed_templates(uuid) from public, anon, authenticated;

-- (app.handle_new_user calls app.seed_templates by name, so it follows.)

-- ---------------------------------------------------------------------------------------------
-- 4. Taking a job: for a client (new or existing) or for nobody, with the steps and days she set.

drop function public.create_job(text, uuid, text, text, integer, date, text, text, text, jsonb, boolean);

create function public.create_job(
  p_client_id uuid,
  p_client_name text,
  p_client_phone text,
  p_number integer,
  p_title text,
  p_due_on date,
  p_notes text,
  p_brief text,
  p_steps jsonb,
  p_confirm boolean
) returns uuid
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_client uuid := p_client_id;
  v_title text := btrim(coalesce(p_title, ''));
  v_order uuid;
  v_item uuid;
begin
  if jsonb_typeof(p_steps) is distinct from 'array' or jsonb_array_length(p_steps) > 100 then
    raise exception 'steps must be a list of at most 100' using errcode = '22023';
  end if;
  if v_client is null and nullif(btrim(coalesce(p_client_name, '')), '') is not null then
    insert into public.client (name, phone) values (btrim(p_client_name), coalesce(p_client_phone, ''))
    returning id into v_client;
  end if;

  insert into public.orders (number, client_id, title, delivery_on, notes)
  values (p_number, v_client, v_title, p_due_on, coalesce(p_notes, ''))
  returning id into v_order;

  -- What is made for a client is a garment: its brief, pictures and measurements hang from it.
  if v_client is not null and v_title <> '' then
    insert into public.order_item (order_id, garment_type, brief, measurement_set_id)
    values (v_order, left(v_title, 80), coalesce(p_brief, ''), app.latest_measurement_set(v_client))
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
revoke all on function public.create_job(uuid, text, text, integer, text, date, text, text, jsonb, boolean)
  from public, anon;
grant execute on function public.create_job(uuid, text, text, integer, text, date, text, text, jsonb, boolean)
  to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. A job made by mistake can be deleted whatever its status (she asked for it): the job, its garments, steps,
-- pictures and history go. Cancelling is still there for a job she wants to keep a record of. Runs with the owner's
-- rights because the table allows no deletes, so it checks for itself that the job is hers.

drop function public.delete_draft_order(uuid);

create function public.delete_job(p_order_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  -- Its garments, steps and pictures go with it: the freeze on a finished job's parts looks for the job, which is
  -- gone by then (app.refuse_change_to_closed_order).
  delete from public.orders o where o.id = p_order_id and o.owner_id = (select auth.uid());
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    raise exception 'that job could not be found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.delete_job(uuid) from public, anon;
grant execute on function public.delete_job(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. The export's schema.

create or replace function app.schema_version() returns text
language sql immutable
set search_path = ''
as $$ select '20261102090000'::text $$;
