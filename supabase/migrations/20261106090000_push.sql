-- Phone notifications (decision 0083). Each phone that turned them on keeps a push subscription; after a change, the
-- app asks for the history lines its person made and has not yet announced, words them, and the `push` Edge Function
-- sends them to the other people of the workspace. Subscriptions and the announcing cursor are in `app`: not reachable
-- through the API and not part of the export (a phone's subscription belongs to that phone, not to her data).

create table app.push_subscription (
  endpoint text primary key check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  user_id uuid not null references auth.users (id) on delete cascade,
  p256dh text not null check (char_length(p256dh) between 1 and 200),
  auth text not null check (char_length(auth) between 1 and 100),
  created_at timestamptz not null default now()
);
create index push_subscription_user on app.push_subscription (user_id);
revoke all on table app.push_subscription from public, anon, authenticated;

create table app.news_cursor (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_seq bigint not null
);
revoke all on table app.news_cursor from public, anon, authenticated;

-- This phone, for the signed-in person. A phone moved to another account is theirs now.
create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  insert into app.push_subscription (endpoint, user_id, p256dh, auth)
  values (p_endpoint, (select auth.uid()), p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
end;
$$;
revoke all on function public.save_push_subscription(text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;

-- A phone that turned them off, or one the push service says is gone: its own person, or anyone of the workspace.
create function public.drop_push_subscription(p_endpoint text) returns void
language sql security definer
set search_path = ''
as $$
  delete from app.push_subscription s
  where s.endpoint = p_endpoint and (s.user_id = (select auth.uid()) or app.in_workspace(s.user_id));
$$;
revoke all on function public.drop_push_subscription(text) from public, anon;
grant execute on function public.drop_push_subscription(text) to authenticated;

-- Whether this phone is the signed-in person's and on.
create function public.has_push_subscription(p_endpoint text) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.push_subscription s where s.endpoint = p_endpoint and s.user_id = (select auth.uid()));
$$;
revoke all on function public.has_push_subscription(text) from public, anon;
grant execute on function public.has_push_subscription(text) to authenticated;

-- The phones of the other people of the signed-in person's workspace: where her news goes.
create function public.workspace_push_targets()
returns table (endpoint text, p256dh text, auth text)
language sql stable security definer
set search_path = ''
as $$
  select s.endpoint, s.p256dh, s.auth
  from app.push_subscription s
  where s.user_id <> (select auth.uid()) and app.in_workspace(s.user_id);
$$;
revoke all on function public.workspace_push_targets() from public, anon;
grant execute on function public.workspace_push_targets() to authenticated;

-- The history lines the signed-in person made in the last few minutes and has not announced yet, oldest first; they
-- are then marked announced. A line older than ten minutes is never sent.
create function public.claim_my_news()
returns table (seq bigint, order_id uuid, action text, details jsonb, at timestamptz)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_last bigint;
  v_max bigint;
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select c.last_seq into v_last from app.news_cursor c where c.user_id = v_me for update;
  select max(l.seq) into v_max from public.activity_log l where l.actor_id = v_me;
  if v_max is null then
    return;
  end if;
  insert into app.news_cursor (user_id, last_seq) values (v_me, v_max)
  on conflict (user_id) do update set last_seq = excluded.last_seq;
  -- With no cursor yet, the ten-minute window alone keeps old news out.
  v_last := coalesce(v_last, 0);
  return query
    select l.seq, l.order_id, l.action, l.details, l.at
    from public.activity_log l
    where l.actor_id = v_me and l.owner_id = app.workspace() and l.seq > v_last and l.seq <= v_max
      and l.at > now() - interval '10 minutes'
    order by l.seq;
end;
$$;
revoke all on function public.claim_my_news() from public, anon;
grant execute on function public.claim_my_news() to authenticated;

create or replace function app.schema_version() returns text
language sql immutable
set search_path = ''
as $$ select '20261106090000'::text $$;
