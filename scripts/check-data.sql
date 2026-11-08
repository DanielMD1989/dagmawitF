-- Read-only look at her data for orders entered twice and steps doubled (.github/workflows/check-data.yml).
-- Says no names: the repository is public. Order numbers, days, statuses and counts only.
with
  o as (
    select o.id, o.owner_id, o.number, o.client_id, lower(btrim(o.title)) as what, o.status, o.delivery_on,
           o.created_at,
           (select count(*) from public.task t where t.order_id = o.id) as steps,
           (select count(*) from public.task t where t.order_id = o.id and t.done_on is not null) as done
    from public.orders o
  ),
  said as (
    select '#' || number || ' (' || status || ', due ' || delivery_on || ', taken '
           || to_char(created_at at time zone 'Africa/Addis_Ababa', 'YYYY-MM-DD HH24:MI:SS') || ', '
           || done || '/' || steps || ' steps done)' as line, *
    from o
  ),
  twice as (
    select client_id, what, count(*) as n, string_agg(line, ' | ' order by number) as orders,
           max(created_at) - min(created_at) as apart
    from said where client_id is not null
    group by owner_id, client_id, what having count(*) > 1
  ),
  green as (
    select string_agg(line, ' | ' order by number) as orders from said where what like '%green complete%'
  ),
  doubled_steps as (
    select count(*) as n from (
      select t.order_id from public.task t where t.done_on is null
      group by t.order_id, lower(btrim(t.title)), t.on_day having count(*) > 1) x
  ),
  deliveries as (
    select count(*) as n from (
      select t.order_id from public.task t where lower(btrim(t.title)) = 'delivery'
      group by t.order_id having count(*) > 1) x
  ),
  clients as (
    select count(*) as n from (
      select 1 from public.client c group by c.owner_id, lower(btrim(c.name)) having count(*) > 1) x
  )
select concat_ws(E'\n',
  'Measurement fields (key=label sort, x if hidden):' ||
  coalesce((select string_agg(' ' || f.key || '=' || f.label || ' ' || f.sort || case when f.archived then ' x' else '' end,
       ' |' order by f.owner_id, f.sort) from public.measurement_field f), ' none'),
  'Measurement sets: ' || (select count(*) from public.measurement_set) || '; keys used:' ||
  coalesce((select string_agg(' ' || k || ' ' || n, ',' order by k) from
       (select k, count(*) as n from public.measurement_set s, jsonb_object_keys(s.measures) k group by k) x), ' none')
  || '; with a note: ' || (select count(*) from public.measurement_set where note <> '') || '; owners: '
  || (select count(distinct owner_id) from public.measurement_field),
  'Orders: ' || (select count(*) from o where client_id is not null) || ' for clients ('
    || coalesce((select string_agg(status || ' ' || n, ', ' order by status) from
         (select status, count(*) as n from o where client_id is not null group by status) s), 'none')
    || '), ' || (select count(*) from o where client_id is null) || ' events.',
  'The order "Green complete": ' || coalesce((select orders from green), 'not found'),
  'Same client and same title, more than once: ' || (select count(*) from twice) || ' time(s).',
  (select string_agg('  ' || n || ' orders, ' || to_char(apart, 'HH24:MI:SS') || ' apart: ' || orders, E'\n')
   from twice),
  'Open steps doubled within an order (same name, same day): ' || (select n from doubled_steps) || '.',
  'Orders with more than one Delivery step: ' || (select n from deliveries) || '.',
  'Client names used more than once: ' || (select n from clients) || '.',
  'Events by status: ' || coalesce((select string_agg(status || ' ' || n, ', ' order by status) from
       (select status, count(*) as n from o where client_id is null group by status) s), 'none') || '.',
  'Finished orders (due, delivered, marked):' ||
  (select string_agg(' #' || o.number || ' ' || o.delivery_on || ' ' || o.delivered_on || ' '
       || coalesce((select to_char(max(l.at) at time zone 'Africa/Addis_Ababa', 'MM-DD HH24:MI') from public.activity_log l
                    where l.order_id = o.id and l.action = 'status_changed' and l.details->>'to' = 'delivered'), '?'),
       ' |' order by o.number)
   from public.orders o where o.status = 'delivered'),
  'Delivery day moves on finished orders:' ||
  coalesce((select string_agg(' #' || o.number || ' ' || coalesce(l.details->>'from', '?') || '>'
       || coalesce(l.details->>'to', '?') || ' at ' || to_char(l.at at time zone 'Africa/Addis_Ababa', 'MM-DD HH24:MI'),
       ' |' order by o.number, l.seq)
   from public.activity_log l join public.orders o on o.id = l.order_id
   where o.status = 'delivered' and l.action = 'delivery_changed'), ' none'),
  'Status changes in the last 5 days, oldest first:' ||
  coalesce((select string_agg(' ' || to_char(l.at at time zone 'Africa/Addis_Ababa', 'MM-DD HH24:MI') || ' '
       || case when o.client_id is null then 'event' else 'order' end || ' #' || o.number || ' '
       || coalesce(l.details->>'from', '?') || '>' || coalesce(l.details->>'to', '?'), ' |' order by l.seq)
   from public.activity_log l join public.orders o on o.id = l.order_id
   where l.action = 'status_changed' and l.at > now() - interval '5 days'), ' none')
) as report;
