import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Client } from 'pg';
import { connect, migrate, scratchDatabase, type Scratch } from '../../scripts/drill/database';

// The migration to jobs she builds (decision 0068) runs on her real data: jobs with kinds, finished ones, one with no
// garment, and her templates. This builds the database before it, fills it, migrates, and checks nothing is lost.

const BEFORE = '20261101090000';
let scratch: Scratch;
let db: Client;
let her: string;
const job: Record<string, string> = {};

const one = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
  (await db.query(sql, params)).rows[0] as T;

beforeAll(async () => {
  scratch = await scratchDatabase(inject('adminUrl'), 'dagmawit_build', BEFORE);
  db = await connect(scratch.url);
  her = (
    await one<{ id: string }>(
      `insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), 'her@example.test', '{}') returning id`,
    )
  ).id;
  const client = (
    await one<{ id: string }>(
      `insert into public.client (owner_id, name) values ($1, 'Megan') returning id`,
      [her],
    )
  ).id;
  const make = async (name: string, kind: string, garments: string[], finish = false) => {
    const id = (
      await one<{ id: string }>(
        `insert into public.orders (owner_id, client_id, kind, delivery_on) values ($1, $2, $3, current_date + 10) returning id`,
        [her, client, kind],
      )
    ).id;
    for (const g of garments) {
      await db.query(`insert into public.order_item (owner_id, order_id, garment_type) values ($1, $2, $3)`, [
        her,
        id,
        g,
      ]);
    }
    await db.query(
      `insert into public.task (owner_id, order_id, title, on_day, starts_at) values ($1, $2, 'Appointment', current_date + 1, '14:00')`,
      [her, id],
    );
    await db.query(`update public.orders set status = 'active' where id = $1`, [id]);
    if (finish)
      await db.query(
        `update public.orders set status = 'delivered', delivered_on = current_date where id = $1`,
        [id],
      );
    job[name] = id;
  };
  await make('gown', 'new_order', ['Bridal gown', 'Veil']);
  await make('appointment', 'appointment', []);
  await make('finished', 'fix', ['Trousers'], true);
  // She changed the Fix starter: it is hers, and stays. The Sketch starter is untouched.
  await db.query(
    `update public.template_task set title = 'Fix the hem' where title = 'Fix' and owner_id = $1`,
    [her],
  );
  await migrate(db, { from: BEFORE });
});

afterAll(async () => {
  await db?.end();
  await scratch?.drop();
});

describe('the migration to jobs she builds, on data entered with kinds', () => {
  it('names each job after its first garment, finished ones too, and keeps every garment and step', async () => {
    const { rows } = await db.query(
      `select o.id, o.title, o.status, (select count(*)::int from public.order_item i where i.order_id = o.id) as garments,
              (select count(*)::int from public.task k where k.order_id = o.id) as steps
       from public.orders o order by o.number`,
    );
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by[job.gown!]).toMatchObject({ title: 'Bridal gown', garments: 2, steps: 1 });
    expect(by[job.appointment!]).toMatchObject({ title: '', garments: 0, steps: 1 });
    expect(by[job.finished!]).toMatchObject({
      title: 'Trousers',
      status: 'delivered',
      garments: 1,
      steps: 1,
    });
  });

  it('has no kinds any more, and a job may be for nobody only with a name', async () => {
    const r = await one<{ n: number }>(
      `select count(*)::int as n from information_schema.columns
       where table_schema = 'public' and table_name in ('orders', 'template') and column_name = 'kind'`,
    );
    expect(r.n).toBe(0);
    await db.query('begin');
    await expect(
      db.query(`insert into public.orders (owner_id, delivery_on) values ($1, current_date)`, [her]),
    ).rejects.toThrow(/orders_event_has_title/);
    await db.query('rollback');
  });

  it('keeps her lists as titles: the untouched one-step starters go, the one she changed stays', async () => {
    const { rows } = await db.query(
      `select t.name, array_agg(s.title order by s.sort) as steps from public.template t
       left join public.template_task s on s.template_id = t.id where t.owner_id = $1 group by t.name order by t.name`,
      [her],
    );
    expect(rows.map((r) => r.name)).toEqual(['Bridal gown', 'Dress', 'Fix']);
    expect(rows.find((r) => r.name === 'Fix')!.steps).toEqual(['Fix the hem', 'Delivery']);
  });
});
