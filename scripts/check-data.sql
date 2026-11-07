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
  'Client names used more than once: ' || (select n from clients) || '.'
) as report;
