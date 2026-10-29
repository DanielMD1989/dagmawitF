-- Stage 3, part 1: her library of templates. One per kind of garment: its tasks, how long each takes in her hands,
-- which follows which, and what the garment waits for. Applying one copies it into an order (part 2), so nothing here
-- is ever read by a plan. The model and the reasons are in docs/planning.md and decisions 0030 to 0037.
--
-- The same two rules as Stage 2: every reference carries her id, so it cannot point at another designer's row, and
-- what must not be rewritten is protected by taking the right away.

-- ---------------------------------------------------------------------------------------------
-- The template

create table public.template (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (name = btrim(name) and char_length(name) between 1 and 80),
  garment_type text not null check (garment_type = btrim(garment_type) and char_length(garment_type) between 1 and 80),
  notes text not null default '' check (char_length(notes) <= 2000),
  -- Counts up on every change to the template or its parts. A garment records the version it was planned from.
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint template_owner_id_key unique (owner_id, id)
);
comment on table public.template is 'One kind of garment, as she makes it. Copied into an order when applied.';
create unique index template_name_key on public.template (owner_id, lower(name));

create function app.template_before_update() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A change of its own words is a new version. (A change to its parts raises the version from their triggers.)
  if (new.name, new.garment_type, new.notes) is distinct from (old.name, old.garment_type, old.notes) then
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;
create trigger template_before_update before update on public.template
  for each row execute function app.template_before_update();
create trigger template_updated_at before update on public.template
  for each row execute function app.set_updated_at();

select app.secure_owner_table('public.template');
revoke update on public.template from authenticated;
grant update (name, garment_type, notes) on public.template to authenticated;

-- A change to a part of a template is a new version of it. Runs with the owner's rights because she may not
-- write the version herself.
create function app.template_part_changed() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_template uuid;
begin
  if tg_op = 'DELETE' then
    v_owner := old.owner_id;
    v_template := old.template_id;
  else
    v_owner := new.owner_id;
    v_template := new.template_id;
  end if;
  -- When the whole template is being deleted, it is no longer there and nothing is updated.
  update public.template t set version = t.version + 1 where t.owner_id = v_owner and t.id = v_template;
  return null;
end;
$$;
revoke all on function app.template_part_changed() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Its tasks. The kinds are the engine's (docs/engine.md); the screen calls `fixed` an appointment.

create table public.template_task (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  template_id uuid not null,
  sort integer not null default 0 check (sort between 0 and 100000),
  title text not null check (title = btrim(title) and char_length(title) between 1 and 120),
  kind text not null check (kind in ('work', 'wait', 'fixed', 'milestone')),
  -- Work and appointments take her minutes; a wait takes calendar days; a milestone takes neither.
  minutes integer check (minutes between 1 and 6000),
  days integer check (days between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint template_task_owner_id_key unique (owner_id, id),
  constraint template_task_in_template_key unique (owner_id, template_id, id),
  constraint template_task_template_fk foreign key (owner_id, template_id)
    references public.template (owner_id, id) on delete cascade,
  constraint template_task_minutes_match check ((kind in ('work', 'fixed')) = (minutes is not null)),
  constraint template_task_days_match check ((kind = 'wait') = (days is not null))
);
create index template_task_by_template on public.template_task (owner_id, template_id, sort);

create trigger template_task_updated_at before update on public.template_task
  for each row execute function app.set_updated_at();
create trigger template_task_changed after insert or update or delete on public.template_task
  for each row execute function app.template_part_changed();

select app.secure_owner_table('public.template_task');
revoke update on public.template_task from authenticated;
grant update (sort, title, kind, minutes, days) on public.template_task to authenticated;

-- ---------------------------------------------------------------------------------------------
-- What a garment of this kind waits for. Matched to the order's preparation by label when applied.

create table public.template_prerequisite (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  template_id uuid not null,
  sort integer not null default 0 check (sort between 0 and 100000),
  kind text not null check (kind in ('material', 'approval', 'measurements', 'other')),
  label text not null check (label = btrim(label) and char_length(label) between 1 and 120),
  blocking boolean not null default true,
  created_at timestamptz not null default now(),
  constraint template_prerequisite_owner_id_key unique (owner_id, id),
  constraint template_prerequisite_in_template_key unique (owner_id, template_id, id),
  constraint template_prerequisite_template_fk foreign key (owner_id, template_id)
    references public.template (owner_id, id) on delete cascade
);
-- Two items with the same name could not be told apart, and could not be matched to the order's.
create unique index template_prerequisite_label_key
  on public.template_prerequisite (owner_id, template_id, lower(label));

create trigger template_prerequisite_changed after insert or update or delete on public.template_prerequisite
  for each row execute function app.template_part_changed();

select app.secure_owner_table('public.template_prerequisite');
revoke update on public.template_prerequisite from authenticated;
grant update (sort, kind, label, blocking) on public.template_prerequisite to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Which task follows which. Both ends are in the same template: the reference carries the template too.

create table public.template_edge (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  template_id uuid not null,
  from_task uuid not null,
  to_task uuid not null,
  -- Calendar days of rest between the end of one and the start of the other.
  lag_days integer not null default 0 check (lag_days between 0 and 30),
  primary key (from_task, to_task),
  constraint template_edge_not_to_itself check (from_task <> to_task),
  constraint template_edge_template_fk foreign key (owner_id, template_id)
    references public.template (owner_id, id) on delete cascade,
  constraint template_edge_from_fk foreign key (owner_id, template_id, from_task)
    references public.template_task (owner_id, template_id, id) on delete cascade,
  constraint template_edge_to_fk foreign key (owner_id, template_id, to_task)
    references public.template_task (owner_id, template_id, id) on delete cascade
);
create index template_edge_by_template on public.template_edge (owner_id, template_id);

-- Refuses a link that would close a loop (A after B after A): no plan could ever be made from it.
-- Links of one template are written one transaction at a time, so two windows cannot each add half a loop.
create function app.template_edge_no_loop() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.template_id::text, 0));
  if exists (
    with recursive after_it (task) as (
      select e.to_task from public.template_edge e
      where e.owner_id = new.owner_id and e.from_task = new.to_task
      union
      select e.to_task from public.template_edge e join after_it a on e.from_task = a.task
      where e.owner_id = new.owner_id
    )
    select 1 from after_it where task = new.from_task
  ) or new.to_task = new.from_task then
    raise exception 'that link would make a loop: a task would have to come after itself' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger template_edge_no_loop before insert or update on public.template_edge
  for each row execute function app.template_edge_no_loop();
create trigger template_edge_changed after insert or update or delete on public.template_edge
  for each row execute function app.template_part_changed();

select app.secure_owner_table('public.template_edge');
revoke update on public.template_edge from authenticated;
grant update (lag_days) on public.template_edge to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Which task waits for which item. Both in the same template.

create table public.template_requires (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  template_id uuid not null,
  task_id uuid not null,
  prerequisite_id uuid not null,
  primary key (task_id, prerequisite_id),
  constraint template_requires_template_fk foreign key (owner_id, template_id)
    references public.template (owner_id, id) on delete cascade,
  constraint template_requires_task_fk foreign key (owner_id, template_id, task_id)
    references public.template_task (owner_id, template_id, id) on delete cascade,
  constraint template_requires_prerequisite_fk foreign key (owner_id, template_id, prerequisite_id)
    references public.template_prerequisite (owner_id, template_id, id) on delete cascade
);
create index template_requires_by_template on public.template_requires (owner_id, template_id);

create trigger template_requires_changed after insert or delete on public.template_requires
  for each row execute function app.template_part_changed();

select app.secure_owner_table('public.template_requires');
revoke update on public.template_requires from authenticated;

-- ---------------------------------------------------------------------------------------------
-- Starter templates. A starting point written without her: every duration is a guess she replaces.

-- Writes one template from a description:
--   { name, garment_type, notes,
--     prerequisites: [ { key, kind, label, blocking } ],
--     tasks: [ { key, title, kind, minutes?, days?, after?: [ { key, lag? } ], needs?: [ key ] } ] }
-- Keys only connect the parts of the description; they are not stored.
create function app.write_template(p_owner uuid, p_spec jsonb) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_template uuid;
  v_ids jsonb := '{}'::jsonb;
  v_prereqs jsonb := '{}'::jsonb;
  v_item jsonb;
  v_link jsonb;
  v_need jsonb;
  v_id uuid;
  v_n integer := 0;
begin
  insert into public.template (owner_id, name, garment_type, notes)
  values (p_owner, p_spec ->> 'name', p_spec ->> 'garment_type', coalesce(p_spec ->> 'notes', ''))
  returning id into v_template;

  for v_item in select * from jsonb_array_elements(coalesce(p_spec -> 'prerequisites', '[]'::jsonb)) loop
    v_n := v_n + 10;
    insert into public.template_prerequisite (owner_id, template_id, sort, kind, label, blocking)
    values (p_owner, v_template, v_n, v_item ->> 'kind', v_item ->> 'label',
            coalesce((v_item ->> 'blocking')::boolean, true))
    returning id into v_id;
    v_prereqs := v_prereqs || jsonb_build_object(v_item ->> 'key', v_id);
  end loop;

  v_n := 0;
  for v_item in select * from jsonb_array_elements(p_spec -> 'tasks') loop
    v_n := v_n + 10;
    insert into public.template_task (owner_id, template_id, sort, title, kind, minutes, days)
    values (p_owner, v_template, v_n, v_item ->> 'title', v_item ->> 'kind',
            (v_item ->> 'minutes')::integer, (v_item ->> 'days')::integer)
    returning id into v_id;
    v_ids := v_ids || jsonb_build_object(v_item ->> 'key', v_id);

    for v_link in select * from jsonb_array_elements(coalesce(v_item -> 'after', '[]'::jsonb)) loop
      insert into public.template_edge (owner_id, template_id, from_task, to_task, lag_days)
      values (p_owner, v_template, (v_ids ->> (v_link ->> 'key'))::uuid, v_id,
              coalesce((v_link ->> 'lag')::integer, 0));
    end loop;
    for v_need in select * from jsonb_array_elements(coalesce(v_item -> 'needs', '[]'::jsonb)) loop
      insert into public.template_requires (owner_id, template_id, task_id, prerequisite_id)
      values (p_owner, v_template, v_id, (v_prereqs ->> (v_need #>> '{}'))::uuid);
    end loop;
  end loop;

  -- Written in one go, it is version 1.
  update public.template set version = 1 where id = v_template;
  return v_template;
end;
$$;
revoke all on function app.write_template(uuid, jsonb) from public, anon, authenticated;

create function app.seed_templates(p_owner uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_note constant text :=
    'A starting point written without you. Replace every time with your own, from orders you have made.';
begin
  if exists (select 1 from public.template t where t.owner_id = p_owner) then
    return;
  end if;

  perform app.write_template(p_owner, jsonb_build_object(
    'name', 'Bridal gown', 'garment_type', 'Bridal gown', 'notes', v_note,
    'prerequisites', '[
      {"key": "design", "kind": "approval", "label": "Design approved by client"},
      {"key": "measure", "kind": "measurements", "label": "Measurements taken"},
      {"key": "fabric", "kind": "material", "label": "Main fabric"},
      {"key": "lining", "kind": "material", "label": "Lining"},
      {"key": "lace", "kind": "material", "label": "Lace"},
      {"key": "trims", "kind": "material", "label": "Zip, buttons and trims"}
    ]'::jsonb,
    'tasks', '[
      {"key": "confirm", "title": "Confirm design and neckline with the client", "kind": "work", "minutes": 60},
      {"key": "pattern", "title": "Draft the pattern", "kind": "work", "minutes": 240,
       "after": [{"key": "confirm"}], "needs": ["design", "measure"]},
      {"key": "toile", "title": "Make the toile", "kind": "work", "minutes": 240, "after": [{"key": "pattern"}]},
      {"key": "fit1", "title": "First fitting (toile)", "kind": "fixed", "minutes": 60, "after": [{"key": "toile"}]},
      {"key": "adjust", "title": "Adjust the pattern after the fitting", "kind": "work", "minutes": 90,
       "after": [{"key": "fit1"}]},
      {"key": "cut", "title": "Cut fabric and lining", "kind": "work", "minutes": 180,
       "after": [{"key": "adjust"}], "needs": ["fabric", "lining"]},
      {"key": "bodice", "title": "Construct the bodice", "kind": "work", "minutes": 480,
       "after": [{"key": "cut"}], "needs": ["trims"]},
      {"key": "skirt", "title": "Construct the skirt", "kind": "work", "minutes": 360, "after": [{"key": "cut"}]},
      {"key": "fit2", "title": "Second fitting", "kind": "fixed", "minutes": 60,
       "after": [{"key": "bodice"}, {"key": "skirt"}]},
      {"key": "alter", "title": "Alterations after the second fitting", "kind": "work", "minutes": 180,
       "after": [{"key": "fit2"}]},
      {"key": "lace", "title": "Apply the lace", "kind": "work", "minutes": 300,
       "after": [{"key": "alter"}], "needs": ["lace"]},
      {"key": "finish", "title": "Hand finishing and pressing", "kind": "work", "minutes": 240,
       "after": [{"key": "lace"}]},
      {"key": "ready", "title": "Ready for handover", "kind": "milestone", "after": [{"key": "finish"}]}
    ]'::jsonb));

  perform app.write_template(p_owner, jsonb_build_object(
    'name', 'Evening dress', 'garment_type', 'Evening dress', 'notes', v_note,
    'prerequisites', '[
      {"key": "design", "kind": "approval", "label": "Design approved by client"},
      {"key": "measure", "kind": "measurements", "label": "Measurements taken"},
      {"key": "fabric", "kind": "material", "label": "Main fabric"},
      {"key": "lining", "kind": "material", "label": "Lining"},
      {"key": "trims", "kind": "material", "label": "Zip, buttons and trims"}
    ]'::jsonb,
    'tasks', '[
      {"key": "confirm", "title": "Confirm design with the client", "kind": "work", "minutes": 45},
      {"key": "prewash", "title": "Pre-wash the fabric and let it dry", "kind": "wait", "days": 1, "needs": ["fabric"]},
      {"key": "pattern", "title": "Draft the pattern", "kind": "work", "minutes": 180,
       "after": [{"key": "confirm"}], "needs": ["design", "measure"]},
      {"key": "cut", "title": "Cut fabric and lining", "kind": "work", "minutes": 120,
       "after": [{"key": "pattern"}, {"key": "prewash"}], "needs": ["lining"]},
      {"key": "construct", "title": "Construct the dress", "kind": "work", "minutes": 420,
       "after": [{"key": "cut"}], "needs": ["trims"]},
      {"key": "fit", "title": "Fitting", "kind": "fixed", "minutes": 45, "after": [{"key": "construct"}]},
      {"key": "alter", "title": "Alterations after the fitting", "kind": "work", "minutes": 120,
       "after": [{"key": "fit"}]},
      {"key": "finish", "title": "Finishing and pressing", "kind": "work", "minutes": 120, "after": [{"key": "alter"}]},
      {"key": "ready", "title": "Ready for handover", "kind": "milestone", "after": [{"key": "finish"}]}
    ]'::jsonb));

  perform app.write_template(p_owner, jsonb_build_object(
    'name', 'Suit alteration', 'garment_type', 'Suit alteration', 'notes', v_note,
    'prerequisites', '[
      {"key": "suit", "kind": "other", "label": "Suit brought in by the client"}
    ]'::jsonb,
    'tasks', '[
      {"key": "fit", "title": "Fitting and pinning", "kind": "fixed", "minutes": 30, "needs": ["suit"]},
      {"key": "unpick", "title": "Unpick and mark", "kind": "work", "minutes": 60, "after": [{"key": "fit"}]},
      {"key": "alter", "title": "Alter the waist and the trousers", "kind": "work", "minutes": 150,
       "after": [{"key": "unpick"}]},
      {"key": "press", "title": "Press and finish", "kind": "work", "minutes": 45, "after": [{"key": "alter"}]},
      {"key": "ready", "title": "Ready for handover", "kind": "milestone", "after": [{"key": "press"}]}
    ]'::jsonb));
end;
$$;
revoke all on function app.seed_templates(uuid) from public, anon, authenticated;

-- Every new user starts with the measurement list and the templates. (Replaces the Stage 2 function.)
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profile (owner_id, name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''));
  perform app.seed_measurement_fields(new.id);
  perform app.seed_templates(new.id);
  return new;
end;
$$;
revoke all on function app.handle_new_user() from public, anon, authenticated;

-- And so does everyone who already exists.
select app.seed_templates(owner_id) from public.profile;
