import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { actAs, actAsOwner, attempt, createUser, idOf, inTransaction } from './helpers';

// Calendar first in the database (docs/calendar-first.md, decision 0066): a job's steps with their days, her studio
// work, and her library of templates that suggest the days.

const CHECK = '23514';
const UNIQUE = '23505';
const FOREIGN_KEY = '23503';
const NO_RIGHT = '42501';

async function signedIn<T>(fn: (c: PoolClient, userId: string) => Promise<T>) {
  return inTransaction(async (c) => {
    const id = await createUser(c, 'a@example.test', 'Dagmawit');
    await actAs(c, id);
    return fn(c, id);
  });
}

const one = async <T = Record<string, unknown>>(c: PoolClient, sql: string, params: unknown[] = []) =>
  (await c.query(sql, params)).rows[0] as T;

const inDays = async (c: PoolClient, n: number) =>
  (
    await one<{ d: string }>(
      c,
      `select to_char(app.today_for((select auth.uid())) + $1::int, 'YYYY-MM-DD') as d`,
      [n],
    )
  ).d;

/** A draft job with one garment, and its ids. */
async function addJob(c: PoolClient) {
  const client = (
    await one<{ id: string }>(c, `insert into public.client (name) values ('Selam') returning id`)
  ).id;
  const order = (
    await one<{ id: string }>(
      c,
      `insert into public.orders (client_id, delivery_on) values ($1, $2) returning id`,
      [client, await inDays(c, 40)],
    )
  ).id;
  const item = (
    await one<{ id: string }>(
      c,
      `insert into public.order_item (order_id, garment_type) values ($1, 'Bridal gown') returning id`,
      [order],
    )
  ).id;
  return { client, order, item };
}

const addStep = async (c: PoolClient, order: string | null, fields: Record<string, unknown> = {}) => {
  const all = { order_id: order, title: 'Sewing', ...fields };
  const names = Object.keys(all);
  return attempt(
    c,
    `insert into public.task (${names.join(', ')}) values (${names.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
    Object.values(all),
  );
};

describe('a step', () => {
  it('has a day, maybe a last day, maybe a time; or no day yet', async () => {
    await signedIn(async (c) => {
      const { order } = await addJob(c);
      for (const fields of [
        {},
        { on_day: '2030-01-10' },
        { on_day: '2030-01-10', until_day: '2030-01-17' },
        { on_day: '2030-01-10', starts_at: '09:00' },
        { on_day: '2030-01-10', until_day: '2030-01-12', starts_at: '09:00', ends_at: '13:00' },
      ]) {
        expect(await addStep(c, order, fields), JSON.stringify(fields)).toMatchObject({ ok: true });
      }
    });
  });

  it.each([
    ['a last day with no first day', { until_day: '2030-01-17' }],
    ['a last day on the first day', { on_day: '2030-01-10', until_day: '2030-01-10' }],
    ['a last day before the first', { on_day: '2030-01-10', until_day: '2030-01-09' }],
    ['a time with no day', { starts_at: '09:00' }],
    ['an end with no start', { on_day: '2030-01-10', ends_at: '10:00' }],
    ['an end before the start', { on_day: '2030-01-10', starts_at: '10:00', ends_at: '09:30' }],
    ['an end at the start', { on_day: '2030-01-10', starts_at: '10:00', ends_at: '10:00' }],
    ['seconds in a time', { on_day: '2030-01-10', starts_at: '10:00:30' }],
    ['an empty title', { title: ' ' }],
    ['a title of 121 letters', { title: 'x'.repeat(121) }],
    ['a day in another century', { on_day: '2100-01-01' }],
  ])('refuses %s', async (_, fields) => {
    await signedIn(async (c) => {
      const { order } = await addJob(c);
      expect(await addStep(c, order, fields)).toMatchObject({ ok: false, code: CHECK });
    });
  });

  it('is done on a day that has come, and can be opened again', async () => {
    await signedIn(async (c) => {
      const { order } = await addJob(c);
      const r = await addStep(c, order, { on_day: await inDays(c, 0) });
      const id = idOf(r);
      const done = (day: string | null) =>
        attempt(c, `update public.task set done_on = $2 where id = $1`, [id, day]);
      expect(await done(await inDays(c, 1))).toMatchObject({ ok: false, code: CHECK });
      expect(await done(await inDays(c, 0))).toMatchObject({ ok: true });
      expect(await done(null)).toMatchObject({ ok: true });
    });
  });

  it('belongs to a garment of its own job, and stays when the garment goes', async () => {
    await signedIn(async (c) => {
      const one = await addJob(c);
      const two = await addJob(c);
      expect(await addStep(c, one.order, { order_item_id: two.item })).toMatchObject({
        ok: false,
        code: FOREIGN_KEY,
      });
      expect(await addStep(c, one.order, { order_item_id: one.item })).toMatchObject({ ok: true });
      await c.query(`delete from public.order_item where id = $1`, [one.item]);
      expect((await c.query(`select order_item_id from public.task`)).rows).toEqual([
        { order_item_id: null },
      ]);
    });
  });

  it('cannot be moved to another job or handed to someone', async () => {
    await signedIn(async (c) => {
      const one = await addJob(c);
      const two = await addJob(c);
      await addStep(c, one.order);
      expect(await attempt(c, `update public.task set order_id = $1`, [two.order])).toMatchObject({
        ok: false,
        code: NO_RIGHT,
      });
    });
  });

  it('is frozen with its job once the job is delivered or cancelled, and free again when reopened', async () => {
    await signedIn(async (c) => {
      const { order } = await addJob(c);
      await addStep(c, order, { on_day: await inDays(c, 3) });
      await c.query(`update public.orders set status = 'active' where id = $1`, [order]);
      await c.query(`update public.orders set status = 'delivered', delivered_on = $2 where id = $1`, [
        order,
        await inDays(c, 0),
      ]);
      expect(await attempt(c, `update public.task set on_day = $1`, [await inDays(c, 4)])).toMatchObject({
        ok: false,
        code: CHECK,
      });
      expect(await addStep(c, order)).toMatchObject({ ok: false, code: CHECK });
      await c.query(`update public.orders set status = 'active' where id = $1`, [order]);
      expect(await attempt(c, `update public.task set on_day = $1`, [await inDays(c, 4)])).toMatchObject({
        ok: true,
      });
    });
  });

  it('tells the job’s history when it is done, once', async () => {
    await signedIn(async (c) => {
      const { order } = await addJob(c);
      const id = idOf(await addStep(c, order, { title: 'Cutting' }));
      const today = await inDays(c, 0);
      await c.query(`update public.task set done_on = $2 where id = $1`, [id, today]);
      await c.query(`update public.task set title = 'Cutting the silk' where id = $1`, [id]);
      const { rows } = await c.query(
        `select action, details from public.activity_log where action = 'task_done' order by seq`,
      );
      expect(rows).toEqual([{ action: 'task_done', details: { title: 'Cutting', done_on: today } }]);
    });
  });
});

describe('studio work', () => {
  it('is a step of no job, and never has a garment without its job', async () => {
    await signedIn(async (c) => {
      const { item } = await addJob(c);
      expect(await addStep(c, null, { title: 'Sharpen the shears', on_day: '2030-01-10' })).toMatchObject({
        ok: true,
      });
      expect(await addStep(c, null, { order_item_id: item })).toMatchObject({ ok: false, code: CHECK });
    });
  });
});

describe('steps of one designer', () => {
  it('are invisible to another, who cannot change or add to them', async () => {
    await inTransaction(async (c) => {
      const a = await createUser(c, 'a@example.test');
      const b = await createUser(c, 'b@example.test');
      await actAs(c, a);
      const { order } = await addJob(c);
      await addStep(c, order);
      await addStep(c, null, { title: 'Walk-in hem' });
      await actAs(c, b);
      expect((await c.query(`select 1 from public.task`)).rowCount).toBe(0);
      expect(await attempt(c, `update public.task set title = 'Mine'`)).toMatchObject({
        ok: true,
        rowCount: 0,
      });
      expect(await addStep(c, order)).toMatchObject({ ok: false, code: FOREIGN_KEY });
      await actAsOwner(c);
      expect((await c.query(`select title from public.task order by title`)).rows).toEqual([
        { title: 'Sewing' },
        { title: 'Walk-in hem' },
      ]);
    });
  });
});

describe('a new account', () => {
  it('starts with a working week, Monday to Saturday', async () => {
    await signedIn(async (c) => {
      const { rows } = await c.query(
        `select weekday, start_time::text, end_time::text, breaks from public.work_week order by weekday`,
      );
      expect(rows.map((r) => r.weekday)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(rows[0]).toEqual({
        weekday: 1,
        start_time: '08:30:00',
        end_time: '17:00:00',
        breaks: [{ start: '12:30', end: '13:30' }],
      });
    });
  });

  it('starts with a template for each kind of job, and a bridal gown', async () => {
    await signedIn(async (c) => {
      const { rows } = await c.query(
        `select t.name, t.kind, t.version, count(s.id)::int as steps,
                max(s.days_before) as first, min(s.days_before) as last
         from public.template t join public.template_task s on s.template_id = t.id
         group by t.id order by t.name`,
      );
      expect(rows).toEqual([
        { name: 'Appointment', kind: 'appointment', version: 1, steps: 1, first: 0, last: 0 },
        { name: 'Bridal gown', kind: 'new_order', version: 1, steps: 11, first: 56, last: 0 },
        { name: 'Delivery', kind: 'delivery', version: 1, steps: 1, first: 0, last: 0 },
        { name: 'Dress', kind: 'new_order', version: 1, steps: 8, first: 28, last: 0 },
        { name: 'Fix', kind: 'fix', version: 1, steps: 2, first: 2, last: 0 },
        { name: 'Sketch', kind: 'sketch', version: 1, steps: 2, first: 3, last: 0 },
      ]);
      const dress = (
        await c.query(
          `select s.title, s.days_before, s.span_days, s.with_client from public.template_task s
           join public.template t on t.id = s.template_id where t.name = 'Dress' order by s.sort`,
        )
      ).rows;
      expect(dress[0]).toEqual({ title: 'Buy fabric', days_before: 28, span_days: 1, with_client: false });
      expect(dress.find((s) => s.title === 'Sewing')).toMatchObject({ days_before: 21, span_days: 7 });
      expect(dress.find((s) => s.title === 'First fitting')).toMatchObject({ with_client: true });
    });
  });
});

describe('her library of templates', () => {
  const dressId = async (c: PoolClient) =>
    (await one<{ id: string }>(c, `select id from public.template where name = 'Dress'`)).id;
  const version = async (c: PoolClient, id: string) =>
    (await one<{ version: number }>(c, `select version from public.template where id = $1`, [id])).version;

  it('counts a new version for every change to a template or its steps, and only then', async () => {
    await signedIn(async (c) => {
      const id = await dressId(c);
      await c.query(`update public.template set notes = 'Mine' where id = $1`, [id]);
      expect(await version(c, id)).toBe(2);
      await c.query(`update public.template set notes = 'Mine' where id = $1`, [id]);
      expect(await version(c, id)).toBe(2);
      await c.query(
        `update public.template_task set days_before = 30 where template_id = $1 and title = 'Buy fabric'`,
        [id],
      );
      expect(await version(c, id)).toBe(3);
      await c.query(
        `insert into public.template_task (template_id, title, days_before) values ($1, 'Embroidery', 15)`,
        [id],
      );
      expect(await version(c, id)).toBe(4);
      expect(await attempt(c, `update public.template set version = 1 where id = $1`, [id])).toMatchObject({
        ok: false,
        code: NO_RIGHT,
      });
    });
  });

  it.each([
    ['days before of -1', { days_before: -1 }],
    ['days before of 366', { days_before: 366 }],
    ['a span of 0 days', { span_days: 0 }],
    ['a span of 61 days', { span_days: 61 }],
  ])('refuses a step with %s', async (_, fields) => {
    await signedIn(async (c) => {
      const id = await dressId(c);
      const names = Object.keys(fields);
      expect(
        await attempt(
          c,
          `insert into public.template_task (template_id, title, ${names.join(', ')})
           values ($1, 'X', ${names.map((_, i) => `$${i + 2}`).join(', ')})`,
          [id, ...Object.values(fields)],
        ),
      ).toMatchObject({ ok: false, code: CHECK });
    });
  });

  it('refuses two templates with the same name, in any capitals, and a kind it does not know', async () => {
    await signedIn(async (c) => {
      expect(
        await attempt(c, `insert into public.template (name, kind) values ('DRESS', 'new_order')`),
      ).toMatchObject({
        ok: false,
        code: UNIQUE,
      });
      expect(
        await attempt(c, `insert into public.template (name, kind) values ('Gown', 'repair')`),
      ).toMatchObject({
        ok: false,
        code: CHECK,
      });
    });
  });

  it('keeps one designer’s templates from another', async () => {
    await inTransaction(async (c) => {
      const a = await createUser(c, 'a@example.test');
      const b = await createUser(c, 'b@example.test');
      await actAs(c, a);
      const id = await dressId(c);
      await actAs(c, b);
      const mine = (await c.query(`select id from public.template`)).rows.map((r) => r.id);
      expect(mine).not.toContain(id);
      expect(
        await attempt(c, `insert into public.template_task (template_id, title) values ($1, 'X')`, [id]),
      ).toMatchObject({ ok: false, code: FOREIGN_KEY });
      expect(await attempt(c, `update public.template set notes = 'x' where id = $1`, [id])).toMatchObject({
        ok: true,
        rowCount: 0,
      });
    });
  });
});
