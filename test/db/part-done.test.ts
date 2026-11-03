import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { actAs, attempt, createUser, inTransaction } from './helpers';

// A step partly done (decision 0087): started, with what is left; still open, moved on like any unfinished step.

const one = async <T = Record<string, unknown>>(c: PoolClient, sql: string, params: unknown[] = []) =>
  (await c.query(sql, params)).rows[0] as T;

async function signedIn<T>(fn: (c: PoolClient) => Promise<T>) {
  return inTransaction(async (c) => {
    await actAs(c, await createUser(c, 'a@example.test', 'Dagmawit'));
    return fn(c);
  });
}

/** An active order with one step, on the day given (days from her today). */
async function orderWithStep(c: PoolClient, title: string, inDays = 0) {
  const client = (
    await one<{ id: string }>(c, `insert into public.client (name) values ('Selam') returning id`)
  ).id;
  const order = (
    await one<{ id: string }>(
      c,
      `insert into public.orders (client_id, delivery_on) values ($1, app.today_for((select auth.uid())) + 30)
       returning id`,
      [client],
    )
  ).id;
  await c.query(`update public.orders set status = 'active' where id = $1`, [order]);
  const step = (
    await one<{ id: string }>(
      c,
      `insert into public.task (order_id, title, on_day) values ($1, $2, app.today_for((select auth.uid())) + $3::int)
       returning id`,
      [order, title, inDays],
    )
  ).id;
  return { order, step };
}

const start = (c: PoolClient, step: string, left: string | null, daysAgo = 0) =>
  attempt(
    c,
    `update public.task set started_on = app.today_for((select auth.uid())) - $3::int, left_note = $2 where id = $1`,
    [step, left, daysAgo],
  );

describe('a step part done', () => {
  it('is kept with what is left, still open, and said on the order’s history', async () => {
    await signedIn(async (c) => {
      const { order, step } = await orderWithStep(c, 'Sewing');
      expect(await start(c, step, 'Bodice and sleeves')).toMatchObject({ ok: true, rowCount: 1 });
      expect(await one(c, `select done_on, left_note from public.task where id = $1`, [step])).toEqual({
        done_on: null,
        left_note: 'Bodice and sleeves',
      });
      expect(
        await one(
          c,
          `select action, details from public.activity_log where order_id = $1 order by seq desc limit 1`,
          [order],
        ),
      ).toEqual({ action: 'task_started', details: { title: 'Sewing', left: 'Bodice and sleeves' } });
      // What is left changed again: on the history again; done: "Done", as before.
      await start(c, step, 'Sleeves');
      await c.query(`update public.task set done_on = app.today_for((select auth.uid())) where id = $1`, [
        step,
      ]);
      const actions = (
        await c.query(
          `select action from public.activity_log where order_id = $1 and action like 'task_%' order by seq`,
          [order],
        )
      ).rows.map((r) => r.action);
      expect(actions).toEqual(['task_started', 'task_started', 'task_done']);
    });
  });

  it('moves to today when its day has passed, with what is left', async () => {
    await signedIn(async (c) => {
      const { step } = await orderWithStep(c, 'Sewing', -1);
      await start(c, step, 'Bodice', 1);
      expect(await one(c, `select public.carry_over() as n`)).toEqual({ n: 1 });
      expect(
        await one(
          c,
          `select on_day = app.today_for((select auth.uid())) as today, left_note from public.task where id = $1`,
          [step],
        ),
      ).toEqual({ today: true, left_note: 'Bodice' });
    });
  });

  it('is refused for a Delivery, a note with no start, and an empty or overlong note', async () => {
    await signedIn(async (c) => {
      const { step: delivery } = await orderWithStep(c, 'DELIVERY');
      expect(await start(c, delivery, null)).toMatchObject({ ok: false, code: '23514' });
      const { step } = await orderWithStep(c, 'Sewing');
      expect(
        await attempt(c, `update public.task set left_note = 'Bodice' where id = $1`, [step]),
      ).toMatchObject({ ok: false, code: '23514' });
      expect(await start(c, step, '   ')).toMatchObject({ ok: false, code: '23514' });
      expect(await start(c, step, 'x'.repeat(201))).toMatchObject({ ok: false, code: '23514' });
      // A started step cannot be renamed Delivery either.
      await start(c, step, null);
      expect(
        await attempt(c, `update public.task set title = 'Delivery' where id = $1`, [step]),
      ).toMatchObject({ ok: false, code: '23514' });
    });
  });
});
