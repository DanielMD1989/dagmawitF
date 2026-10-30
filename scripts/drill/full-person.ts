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

  // A client, her measurements, and a new order with its steps: one done, one over several days, one with a time.
  const order = await id(
    c,
    `select public.create_job('new_order', null, 'Selam Tesfaye', '0911 000 000', null, $1::date, 'Church wedding',
                              'Evening dress', 'Emerald silk, long sleeves', $2::jsonb, true) as id`,
    [
      await day(40),
      JSON.stringify([
        { title: 'Buy fabric', on_day: today },
        {
          title: 'Sewing',
          on_day: await day(10),
          until_day: await day(16),
          starts_at: '09:00',
          ends_at: '13:00',
        },
        { title: 'First fitting', on_day: await day(20), starts_at: '10:30', ends_at: '11:30' },
        { title: 'Delivery', on_day: await day(40) },
        { title: 'Pressing' },
      ]),
    ],
  );
  const client = await id(c, `select client_id as id from public.orders where id = $1`, [order]);
  await c.query(
    `insert into public.measurement_set (client_id, taken_on, unit, measures) values ($1, $2, 'cm', $3::jsonb)`,
    [client, today, JSON.stringify({ bust: 92, waist: 74, hip: 100 })],
  );
  await c.query(`update public.task set done_on = $2 where order_id = $1 and title = 'Buy fabric'`, [
    order,
    today,
  ]);

  // Her own template, changed.
  await c.query(
    `update public.template_task set days_before = 30 where title = 'Buy fabric'
       and template_id = (select id from public.template where name = 'Dress')`,
  );

  // A picture, and studio work with no job.
  const picture = await id(c, `select gen_random_uuid() as id`);
  const path = `${owner}/${order}/${picture}.jpg`;
  await c.query(
    `insert into public.attachment (id, order_id, kind, caption, storage_path, content_type, size_bytes)
     values ($1, $2, 'sketch', 'Front view', $3, 'image/jpeg', 2048)`,
    [picture, order, path],
  );
  await c.query(`insert into public.task (title, on_day, sort) values ('Sharpen the shears', $1, 100000)`, [
    await day(1),
  ]);

  // An appointment with a second client, no garment; and a draft fix.
  await c.query(
    `select public.create_job('appointment', null, 'Hanna Bekele', '', null, $1::date, '', null, '', $2::jsonb, true)`,
    [await day(2), JSON.stringify([{ title: 'Appointment', on_day: await day(2), starts_at: '14:00' }])],
  );
  await c.query(
    `select public.create_job('fix', null, 'Mimi Alemu', '', null, $1::date, '', 'Trousers', 'Shorten', $2::jsonb, false)`,
    [
      await day(5),
      JSON.stringify([
        { title: 'Fix', on_day: await day(3) },
        { title: 'Delivery', on_day: await day(5) },
      ]),
    ],
  );

  return { pictures: [path] };
}
