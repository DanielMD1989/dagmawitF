-- Reminders on her phone, with the app closed (decision 0095). Two kinds, for every phone of a workspace that has
-- notifications turned on:
--   - a morning summary at 7:30 on her clock: what is on today (steps not done, earlier ones not done yet, and the
--     orders due today), on days with something on;
--   - an hour before a step with a time: "At 10:30 · Fitting", with whose it is.
--
-- How it runs: a timer in the database (pg_cron) calls the `remind` Edge Function every five minutes; the function
-- asks `app.claim_due_reminders()` what is due now, which also notes each as sent so it is never sent twice, and
-- sends them. The function takes nothing from its caller: whoever calls it, it can only send what is due, once. The
-- timer is switched on by the Database workflow for her project only (`app.schedule_reminders`), so a test database
-- never calls out.
--
-- Released before anything uses it (decision 0082): nothing calls these until the function is deployed and the timer
-- is on.

create table app.reminder_sent (
  workspace_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('morning', 'step')),
  -- The day, for a morning summary; the step and its day, for a step.
  key text not null check (char_length(key) <= 100),
  sent_at timestamptz not null default now(),
  primary key (workspace_id, kind, key)
);
revoke all on table app.reminder_sent from public, anon, authenticated;

-- The morning summary's hour and how long before a timed step, on her clock.
create function app.reminder_morning() returns time language sql immutable set search_path = '' as $$ select time '07:30' $$;
create function app.reminder_ahead() returns interval language sql immutable set search_path = '' as $$ select interval '1 hour' $$;

-- "Selam Bekele · Wedding guest dress", "Selam Bekele", or an event's name: whose a step is, in a few words.
create function app.whose(p_order_id uuid) returns text
language sql stable
set search_path = ''
as $$
  select case
    when c.name is null then o.title
    when o.title = '' then c.name
    else c.name || ' · ' || o.title
  end
  from public.orders o left join public.client c on c.owner_id = o.owner_id and c.id = o.client_id
  where o.id = p_order_id;
$$;

-- Every reminder due at `p_now`, one row per phone, each noted as sent. Runs as the database's owner (the function's
-- caller is the `remind` Edge Function, connected as the database owner): it reads every workspace.
create function app.claim_due_reminders(p_now timestamptz default now())
returns table (endpoint text, p256dh text, auth text, title text, body text, url text, tag text)
language plpgsql
set search_path = ''
as $$
declare
  w record;
  v_local timestamp;
  v_today date;
  v_lines text[];
  v_steps integer;
  v_deliveries integer;
  v_title text;
  s record;
begin
  -- Old notes go; a week is more than enough to know what was sent. One clock throughout: `p_now`.
  delete from app.reminder_sent r where r.sent_at < p_now - interval '7 days';

  -- Each workspace: an owner, with her clock. A person added to a workspace is reminded of its work, not her own.
  for w in
    select p.owner_id as id, p.timezone
    from public.profile p
    where not exists (select 1 from app.member m where m.user_id = p.owner_id)
      and exists (
        select 1 from app.push_subscription ps
        where ps.user_id = p.owner_id or ps.user_id in (select m.user_id from app.member m where m.owner_id = p.owner_id))
  loop
    v_local := p_now at time zone w.timezone;
    v_today := v_local::date;

    -- The morning summary: from 7:30 until 11:00, once a day (a timer that was down does not send it at night).
    if v_local::time >= app.reminder_morning() and v_local::time < time '11:00'
       and not exists (
         select 1 from app.reminder_sent r
         where r.workspace_id = w.id and r.kind = 'morning' and r.key = v_today::text) then
      insert into app.reminder_sent (workspace_id, kind, key, sent_at) values (w.id, 'morning', v_today::text, p_now);

      -- Today's steps not done, and earlier ones not done yet (they come to today when she opens the app), of her
      -- confirmed orders and her own work; timed ones first, by time.
      select count(*)::int,
             coalesce(array_agg(line order by late desc, starts_at nulls last, sort) filter (where line is not null), '{}')
      into v_steps, v_lines
      from (
        select t.starts_at, t.sort, coalesce(t.until_day, t.on_day) < v_today as late,
               concat_ws(' ',
                 to_char(t.starts_at, 'HH24:MI'),
                 t.title || coalesce(' · ' || app.whose(t.order_id), ''),
                 case when coalesce(t.until_day, t.on_day) < v_today then '(not done yet)' end) as line
        from public.task t
        where t.owner_id = w.id and t.done_on is null and t.on_day is not null and t.on_day <= v_today
          and (t.order_id is null
            or exists (select 1 from public.orders o where o.id = t.order_id and o.status = 'active'))
      ) x;

      -- Orders due today with no Delivery step today said already.
      select count(*)::int into v_deliveries
      from public.orders o
      where o.owner_id = w.id and o.status = 'active' and o.delivery_on = v_today and o.client_id is not null
        and not exists (
          select 1 from public.task t
          where t.order_id = o.id and lower(btrim(t.title)) = 'delivery' and t.done_on is null and t.on_day <= v_today);
      v_lines := v_lines || array(
        select 'Delivery · ' || app.whose(o.id)
        from public.orders o
        where o.owner_id = w.id and o.status = 'active' and o.delivery_on = v_today and o.client_id is not null
          and not exists (
            select 1 from public.task t
            where t.order_id = o.id and lower(btrim(t.title)) = 'delivery' and t.done_on is null and t.on_day <= v_today)
        order by o.number);

      if v_steps + v_deliveries > 0 then
        v_title := 'Today: ' || concat_ws(' · ',
          case when v_steps > 0 then v_steps || ' step' || case when v_steps = 1 then '' else 's' end end,
          case when v_deliveries > 0 then v_deliveries || ' deliver' || case when v_deliveries = 1 then 'y' else 'ies' end end);
        return query
          select ps.endpoint, ps.p256dh, ps.auth, v_title,
                 left(array_to_string(v_lines[1:4], E'\n')
                   || case when cardinality(v_lines) > 4 then E'\nand ' || (cardinality(v_lines) - 4) || ' more' else '' end, 300),
                 '/'::text,
                 -- Its own tag on the phone, so a later notification does not replace it.
                 'morning-' || v_today::text
          from app.push_subscription ps
          where ps.user_id = w.id or ps.user_id in (select m.user_id from app.member m where m.owner_id = w.id);
      end if;
    end if;

    -- An hour before each step with a time today, not done, of a confirmed order or her own work; once.
    for s in
      select t.id, t.title, t.starts_at, t.order_id
      from public.task t
      where t.owner_id = w.id and t.done_on is null and t.starts_at is not null
        and v_today between t.on_day and coalesce(t.until_day, t.on_day)
        and v_local::time >= t.starts_at - app.reminder_ahead() and v_local::time < t.starts_at
        and (t.order_id is null
          or exists (select 1 from public.orders o where o.id = t.order_id and o.status = 'active'))
        and not exists (
          select 1 from app.reminder_sent r
          where r.workspace_id = w.id and r.kind = 'step' and r.key = t.id::text || '/' || v_today::text)
      order by t.starts_at, t.sort
    loop
      insert into app.reminder_sent (workspace_id, kind, key, sent_at) values (w.id, 'step', s.id::text || '/' || v_today::text, p_now);
      return query
        select ps.endpoint, ps.p256dh, ps.auth,
               'At ' || to_char(s.starts_at, 'HH24:MI') || ' · ' || s.title,
               coalesce(app.whose(s.order_id), 'Your own'),
               case when s.order_id is null then '/' else '/orders/' || s.order_id end,
               'step-' || s.id::text
        from app.push_subscription ps
        where ps.user_id = w.id or ps.user_id in (select m.user_id from app.member m where m.owner_id = w.id);
    end loop;
  end loop;
end;
$$;
revoke all on function app.claim_due_reminders(timestamptz) from public, anon, authenticated;

-- Switches the timer on: every five minutes, a call to the `remind` function at `p_url`. Run by the Database workflow
-- for her project only; safe to run again (the job is replaced). The extensions are created here, not by the
-- migration, so a database without them (a test one) still migrates.
create function app.schedule_reminders(p_url text) returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_url !~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/remind$' then
    raise exception 'not a reminder address: %', p_url using errcode = '22023';
  end if;
  execute 'create extension if not exists pg_net with schema extensions';
  execute 'create extension if not exists pg_cron';
  execute format(
    'select cron.schedule(%L, %L, %L)',
    'dagmawit-reminders',
    '*/5 * * * *',
    format('select net.http_post(url := %L, body := %L::jsonb, timeout_milliseconds := 20000)', p_url, '{}'));
end;
$$;
revoke all on function app.schedule_reminders(text) from public, anon, authenticated;

create or replace function app.schema_version() returns text
language sql immutable
set search_path = ''
as $$ select '20261109090000'::text $$;
