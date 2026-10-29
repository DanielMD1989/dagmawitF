/**
 * A person with something in every table: the data the restore drill and the backup tests round-trip
 * (docs/harden.md, "The drill"). Runs as that person: the caller has already switched to her (role and claims),
 * so every row goes through the same rules as the app's.
 */

export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

const one = async (c: Queryable, sql: string, params: unknown[] = []) => {
  const { rows } = await c.query(sql, params);
  return rows[0] as Record<string, unknown>;
};
const id = async (c: Queryable, sql: string, params: unknown[] = []) =>
  String((await one(c, sql, params)).id);

/** Fills every table for the signed-in person and returns the storage paths of her pictures. */
export async function fillPerson(c: Queryable): Promise<{ pictures: string[] }> {
  const day = async (offset: number) =>
    String(
      (
        await one(c, `select to_char(app.today_for((select auth.uid())) + $1::int, 'YYYY-MM-DD') as id`, [
          offset,
        ])
      ).id,
    );
  const today = await day(0);
  const owner = await id(c, `select (select auth.uid()) as id`);

  // Her calendar: a working week and a short day.
  const week = [1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    start: '08:30',
    end: '17:00',
    breaks: [{ start: '12:30', end: '13:30' }],
  }));
  await c.query(`select public.replace_work_week($1::jsonb)`, [JSON.stringify(week)]);
  await c.query(
    `insert into public.calendar_exception (day, minutes_available, reason) values ($1, 120, 'Fabric market')`,
    [await day(3)],
  );

  // A client, her measurements, an active order made from a template, with progress on it.
  const order = await id(
    c,
    `select public.create_order(null, 'Selam Tesfaye', '0911 000 000', null, $1::date, null, 'Church wedding',
                                'Evening dress', 'Emerald silk, long sleeves', true) as id`,
    [await day(40)],
  );
  const client = await id(c, `select client_id as id from public.orders where id = $1`, [order]);
  await c.query(
    `insert into public.measurement_set (client_id, taken_on, unit, measures) values ($1, $2, 'cm', $3::jsonb)`,
    [client, today, JSON.stringify({ bust: 92, waist: 74, hip: 100 })],
  );
  const garment = await id(c, `select id from public.order_item where order_id = $1`, [order]);
  const template = await id(c, `select id from public.template where name = 'Evening dress'`);
  await c.query(`select public.apply_template($1, $2)`, [garment, template]);

  const work = (
    await c.query(`select id from public.task where order_id = $1 and kind = 'work' order by sort`, [order])
  ).rows.map((r) => String(r.id));
  await c.query(`update public.task set status = 'done', done_on = $2, actual_minutes = 50 where id = $1`, [
    work[0],
    today,
  ]);
  await c.query(`update public.task set status = 'in_progress', remaining_minutes = 30 where id = $1`, [
    work[1],
  ]);
  await c.query(`update public.task set hold_reason = 'Client is away' where id = $1`, [work[2]]);
  await c.query(`update public.task set pinned_on = $2 where id = $1`, [work[3], await day(2)]);
  await c.query(
    `update public.prerequisite set state = 'ordered', expected_on = $2
     where id = (select id from public.prerequisite where order_id = $1 order by label limit 1)`,
    [order, await day(5)],
  );

  // A picture, and studio work with no order.
  const picture = await id(c, `select gen_random_uuid() as id`);
  const path = `${owner}/${order}/${picture}.jpg`;
  await c.query(
    `insert into public.attachment (id, order_id, kind, caption, storage_path, content_type, size_bytes)
     values ($1, $2, 'sketch', 'Front view', $3, 'image/jpeg', 2048)`,
    [picture, order, path],
  );
  await c.query(
    `insert into public.task (title, kind, minutes, sort) values ('Sharpen the shears', 'work', 45, 100000)`,
  );

  // A draft order for a second client.
  await c.query(
    `select public.create_order(null, 'Hanna Bekele', '', null, $1::date, 3, '', 'Suit alteration', '', false)`,
    [await day(20)],
  );

  // An approved plan with a slot, and a rejected one.
  const counters = await one(c, `select plan_epoch as e, progress_epoch as p from public.profile`);
  const slots = JSON.stringify([{ task_id: work[1], day: today, minutes: 30, rank: 1, at_time: null }]);
  const first = Number(
    (
      await one(c, `select public.save_proposal($1, $2, $3::date, $4::jsonb, $5::jsonb) as n`, [
        counters.e,
        counters.p,
        today,
        JSON.stringify({ drill: true }),
        slots,
      ])
    ).n,
  );
  await c.query(`select public.approve_plan($1)`, [first]);
  const second = Number(
    (
      await one(c, `select public.save_proposal($1, $2, $3::date, $4::jsonb, $5::jsonb) as n`, [
        counters.e,
        counters.p,
        today,
        JSON.stringify({ drill: 'second' }),
        '[]',
      ])
    ).n,
  );
  await c.query(`select public.reject_plan($1)`, [second]);

  return { pictures: [path] };
}
