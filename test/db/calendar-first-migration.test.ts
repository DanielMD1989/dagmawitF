import { inject, describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { Client } from 'pg';
import { connect, migrate, scratchDatabase, type Scratch } from '../../scripts/drill/database';

// The calendar-first migration (decision 0066) runs on her real data. This builds a database at the version before
// it, fills it the way the old screens did, migrates, and checks that nothing she entered is lost.

const BEFORE = '20261031090000';

let scratch: Scratch;
let db: Client;
let her: string;
let other: string;
let activeOrder: string;
let deliveredOrder: string;

const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => {
  const { rows } = await db.query(sql, params);
  return rows[0] as T;
};

beforeAll(async () => {
  scratch = await scratchDatabase(inject('adminUrl'), 'dagmawit_migrate', BEFORE);
  db = await connect(scratch.url);

  her = (
    await one<{ id: string }>(
      `insert into auth.users (id, email, raw_user_meta_data)
       values (gen_random_uuid(), 'her@example.test', '{"name": "Dagmawit"}') returning id`,
    )
  ).id;
  other = (
    await one<{ id: string }>(
      `insert into auth.users (id, email) values (gen_random_uuid(), 'other@example.test') returning id`,
    )
  ).id;
  // The other designer had set her own week: it is hers, and stays.
  await db.query(
    `insert into public.work_week (owner_id, weekday, start_time, end_time) values ($1, 2, '10:00', '15:00')`,
    [other],
  );
  // She had edited one starter template, so it is hers now; the other starters are untouched.
  await db.query(
    `update public.template set notes = 'Mine now' where owner_id = $1 and name = 'Evening dress'`,
    [her],
  );

  const client = (
    await one<{ id: string }>(`insert into public.client (owner_id, name) values ($1, 'Hana') returning id`, [
      her,
    ])
  ).id;
  const makeOrder = async (number: number) => {
    const order = (
      await one<{ id: string }>(
        `insert into public.orders (owner_id, number, client_id, delivery_on, buffer_days)
         values ($1, $2, $3, date '2030-03-01', 2) returning id`,
        [her, number, client],
      )
    ).id;
    const garment = (
      await one<{ id: string }>(
        `insert into public.order_item (owner_id, order_id, garment_type) values ($1, $2, 'Bridal gown') returning id`,
        [her, order],
      )
    ).id;
    await db.query(`update public.orders set status = 'active' where id = $1`, [order]);
    return { order, garment };
  };
  const a = await makeOrder(1);
  activeOrder = a.order;
  const task = async (title: string, fields: string, values: unknown[]) =>
    (
      await one<{ id: string }>(
        `insert into public.task (owner_id, order_id, order_item_id, sort, title, ${fields})
         values ($1, $2, $3, $4, $5, ${values.map((_, i) => `$${i + 6}`).join(', ')}) returning id`,
        [her, a.order, a.garment, 10, title, ...values],
      )
    ).id;
  await task('First fitting', 'kind, minutes, fixed_on, fixed_time', ['fixed', 60, '2030-02-01', '10:30']);
  await task('Late fitting', 'kind, minutes, fixed_on, fixed_time', ['fixed', 120, '2030-02-02', '23:00']);
  await task('Cut the lace', 'kind, minutes, pinned_on', ['work', 180, '2030-01-20']);
  const sewing = await task('Sewing', 'kind, minutes', ['work', 900]);
  const pattern = await task('Draft the pattern', 'kind, minutes', ['work', 240]);
  await task('Hem', 'kind, minutes, status, done_on, actual_minutes', ['work', 60, 'done', '2026-10-01', 75]);
  await task('Ready for handover', 'kind', ['milestone']);

  const plan = (
    await one<{ id: string }>(
      `insert into public.plan_version (owner_id, number, status, epoch, made_for, result, decided_at)
       values ($1, 1, 'approved', 0, current_date, '{}', now()) returning id`,
      [her],
    )
  ).id;
  for (const [t, day] of [
    [sewing, '2030-01-10'],
    [sewing, '2030-01-11'],
    [sewing, '2030-01-14'],
    [pattern, '2030-01-05'],
  ] as const) {
    await db.query(
      `insert into public.plan_slot (owner_id, plan_id, task_id, day, minutes, rank) values ($1, $2, $3, $4, 60, 1)`,
      [her, plan, t, day],
    );
  }

  for (const [kind, label, state, expected] of [
    ['material', 'Lace', 'needed', '2030-01-08'],
    ['material', 'Main fabric', 'ordered', null],
    ['material', 'Lining', 'received', null],
    ['approval', 'Design approved by client', 'needed', null],
  ] as const) {
    await db.query(
      `insert into public.prerequisite (owner_id, order_id, kind, label, state, expected_on)
       values ($1, $2, $3, $4, $5, $6)`,
      [her, a.order, kind, label, state, expected],
    );
  }

  const d = await makeOrder(2);
  deliveredOrder = d.order;
  await db.query(
    `insert into public.task (owner_id, order_id, order_item_id, title, kind, minutes, fixed_on, fixed_time)
     values ($1, $2, $3, 'Old fitting', 'fixed', 30, date '2026-09-01', '09:00')`,
    [her, d.order, d.garment],
  );
  await db.query(
    `insert into public.prerequisite (owner_id, order_id, kind, label) values ($1, $2, 'material', 'Buttons')`,
    [her, d.order],
  );
  await db.query(
    `update public.orders set status = 'delivered', delivered_on = date '2026-09-05' where id = $1`,
    [d.order],
  );

  await migrate(db, { from: BEFORE, upTo: '20261101090000' });
});

afterAll(async () => {
  await db?.end();
  await scratch?.drop();
});

const stepsOf = async (order: string) =>
  (
    await db.query<{
      title: string;
      on_day: string | null;
      until_day: string | null;
      starts_at: string | null;
      ends_at: string | null;
      done_on: string | null;
    }>(
      `select title, on_day::text, until_day::text, starts_at::text, ends_at::text, done_on::text
       from public.task where order_id = $1 order by title`,
      [order],
    )
  ).rows;

describe('the calendar-first migration, on data entered the old way', () => {
  it('keeps every task, each on the day it already had', async () => {
    const steps = await stepsOf(activeOrder);
    const by = Object.fromEntries(steps.map((s) => [s.title, s]));
    // An appointment: its day, its time, and its end from its minutes.
    expect(by['First fitting']).toMatchObject({
      on_day: '2030-02-01',
      starts_at: '10:30:00',
      ends_at: '11:30:00',
    });
    // One that would end after midnight keeps its start only.
    expect(by['Late fitting']).toMatchObject({ on_day: '2030-02-02', starts_at: '23:00:00', ends_at: null });
    // A pinned piece of work: its pinned day.
    expect(by['Cut the lace']).toMatchObject({ on_day: '2030-01-20', until_day: null, starts_at: null });
    // Work the approved plan spread over days: its first and last day.
    expect(by['Sewing']).toMatchObject({ on_day: '2030-01-10', until_day: '2030-01-14' });
    expect(by['Draft the pattern']).toMatchObject({ on_day: '2030-01-05', until_day: null });
    // Done stays done, on its day.
    expect(by['Hem']).toMatchObject({ done_on: '2026-10-01' });
    // Never given a day: still none.
    expect(by['Ready for handover']).toMatchObject({ on_day: null, done_on: null });
  });

  it('turns preparation not yet in into steps; what was received is not work any more', async () => {
    const by = Object.fromEntries((await stepsOf(activeOrder)).map((s) => [s.title, s]));
    expect(by['Buy Lace']).toMatchObject({ on_day: '2030-01-08', done_on: null });
    expect(by['Collect Main fabric']).toMatchObject({ on_day: null });
    expect(by['Design approved by client']).toMatchObject({ on_day: null });
    expect(Object.keys(by).some((t) => t.includes('Lining'))).toBe(false);
  });

  it('leaves a delivered order as it was, its old appointment on its day', async () => {
    const steps = await stepsOf(deliveredOrder);
    expect(steps).toEqual([
      {
        title: 'Old fitting',
        on_day: '2026-09-01',
        until_day: null,
        starts_at: '09:00:00',
        ends_at: '09:30:00',
        done_on: null,
      },
    ]);
  });

  it('makes every existing order a new order, keeping its garment', async () => {
    const r = await one<{ kinds: string[]; garments: number }>(
      `select array_agg(distinct kind) as kinds,
              (select count(*)::int from public.order_item where owner_id = $1) as garments
       from public.orders where owner_id = $1`,
      [her],
    );
    expect(r).toEqual({ kinds: ['new_order'], garments: 2 });
  });

  it('replaces the untouched starter templates and keeps hers, with its steps spread before the due day', async () => {
    const { rows } = await db.query<{ name: string; kind: string }>(
      `select name, kind from public.template where owner_id = $1 order by name`,
      [her],
    );
    expect(rows).toEqual([
      { name: 'Appointment', kind: 'appointment' },
      { name: 'Bridal gown', kind: 'new_order' },
      { name: 'Delivery', kind: 'delivery' },
      { name: 'Dress', kind: 'new_order' },
      { name: 'Evening dress', kind: 'new_order' },
      { name: 'Fix', kind: 'fix' },
      { name: 'Sketch', kind: 'sketch' },
    ]);
    const steps = (
      await db.query<{ title: string; days_before: number; with_client: boolean }>(
        `select s.title, s.days_before, s.with_client from public.template_task s
         join public.template t on t.id = s.template_id
         where t.owner_id = $1 and t.name = 'Evening dress' order by s.sort`,
        [her],
      )
    ).rows;
    expect(steps).toHaveLength(9);
    expect(steps[0]!.days_before).toBe(28);
    expect(steps.at(-1)!.days_before).toBe(0);
    expect(steps.map((s) => s.days_before)).toEqual(
      [...steps.map((s) => s.days_before)].sort((x, y) => y - x),
    );
    expect(steps.find((s) => s.title === 'Fitting')!.with_client).toBe(true);
  });

  it('gives a working week to whoever had none, and leaves a week someone had set', async () => {
    const weeks = (
      await db.query<{ owner_id: string; days: number[] }>(
        `select owner_id, array_agg(weekday order by weekday) as days from public.work_week group by owner_id`,
      )
    ).rows;
    expect(Object.fromEntries(weeks.map((w) => [w.owner_id, w.days]))).toEqual({
      [her]: [1, 2, 3, 4, 5, 6],
      [other]: [2],
    });
  });

  it('removes the planning tables', async () => {
    const r = await one<{ left: string[] | null }>(
      `select array_agg(relname::text) as left from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and relname in
         ('plan_version', 'plan_slot', 'task_edge', 'task_requires', 'prerequisite',
          'template_edge', 'template_requires', 'template_prerequisite')`,
    );
    expect(r.left).toBeNull();
  });
});
