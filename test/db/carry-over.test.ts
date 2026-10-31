import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { actAs, createUser, inTransaction } from './helpers';

// Unfinished steps move to today (decision 0080).

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

async function signedIn<T>(fn: (c: PoolClient, userId: string) => Promise<T>) {
  return inTransaction(async (c) => {
    const id = await createUser(c, 'a@example.test', 'Dagmawit');
    await actAs(c, id);
    return fn(c, id);
  });
}

/** A job in a status, with no steps yet. */
async function job(c: PoolClient, status: 'draft' | 'active' | 'on_hold' = 'active') {
  const client = (
    await one<{ id: string }>(c, `insert into public.client (name) values ('Selam') returning id`)
  ).id;
  const id = (
    await one<{ id: string }>(
      c,
      `insert into public.orders (client_id, delivery_on) values ($1, $2) returning id`,
      [client, await inDays(c, 30)],
    )
  ).id;
  if (status !== 'draft') await c.query(`update public.orders set status = 'active' where id = $1`, [id]);
  if (status === 'on_hold')
    await c.query(`update public.orders set status = 'on_hold', hold_reason = 'Abroad' where id = $1`, [id]);
  return id;
}

const step = async (c: PoolClient, order: string | null, title: string, fields: Record<string, unknown>) => {
  const all = { order_id: order, title, ...fields };
  const names = Object.keys(all);
  await c.query(
    `insert into public.task (${names.join(', ')}) values (${names.map((_, i) => `$${i + 1}`).join(', ')})`,
    Object.values(all),
  );
};

const where = (c: PoolClient, title: string) =>
  one<{ on_day: string | null; until_day: string | null; moved_from: string | null }>(
    c,
    `select on_day::text, until_day::text, moved_from::text from public.task where title = $1`,
    [title],
  );

describe('unfinished steps', () => {
  it('move to today, remembering the day they were meant for; done and future ones stay', async () => {
    await signedIn(async (c) => {
      const active = await job(c);
      const [yesterday, lastWeek, today, tomorrow] = await Promise.all([
        inDays(c, -1),
        inDays(c, -7),
        inDays(c, 0),
        inDays(c, 1),
      ]);
      await step(c, active, 'Cutting', { on_day: yesterday, starts_at: '10:00' });
      await step(c, active, 'Sewing', { on_day: lastWeek, until_day: yesterday });
      await step(c, active, 'Buy fabric', { on_day: lastWeek, done_on: lastWeek });
      await step(c, active, 'Fitting', { on_day: tomorrow });
      await step(c, active, 'Lace work', {});
      await step(c, null, 'Sharpen the shears', { on_day: yesterday });

      expect(await one(c, `select public.carry_over() as n`)).toEqual({ n: 3 });
      expect(await where(c, 'Cutting')).toEqual({ on_day: today, until_day: null, moved_from: yesterday });
      // A step over several days moves as one day, today; it was meant to end yesterday.
      expect(await where(c, 'Sewing')).toEqual({ on_day: today, until_day: null, moved_from: yesterday });
      expect(await where(c, 'Sharpen the shears')).toMatchObject({ on_day: today, moved_from: yesterday });
      expect(await where(c, 'Buy fabric')).toMatchObject({ on_day: lastWeek, moved_from: null });
      expect(await where(c, 'Fitting')).toMatchObject({ on_day: tomorrow, moved_from: null });
      expect(await where(c, 'Lace work')).toMatchObject({ on_day: null, moved_from: null });
      // Its time stays: she can change it.
      expect(await one(c, `select starts_at::text from public.task where title = 'Cutting'`)).toEqual({
        starts_at: '10:00:00',
      });
    });
  });

  it('runs any number of times a day, and keeps the first day a step was meant for', async () => {
    await signedIn(async (c) => {
      const active = await job(c);
      const lastWeek = await inDays(c, -7);
      await step(c, active, 'Cutting', { on_day: await inDays(c, -1), moved_from: lastWeek });
      expect(await one(c, `select public.carry_over() as n`)).toEqual({ n: 1 });
      expect(await one(c, `select public.carry_over() as n`)).toEqual({ n: 0 });
      expect(await where(c, 'Cutting')).toMatchObject({ on_day: await inDays(c, 0), moved_from: lastWeek });
    });
  });

  it('leave the steps of a draft or a paused job where they are', async () => {
    await signedIn(async (c) => {
      const yesterday = await inDays(c, -1);
      await step(c, await job(c, 'draft'), 'Sketch', { on_day: yesterday });
      await step(c, await job(c, 'on_hold'), 'Fitting', { on_day: yesterday });
      expect(await one(c, `select public.carry_over() as n`)).toEqual({ n: 0 });
      expect(await where(c, 'Sketch')).toMatchObject({ on_day: yesterday, moved_from: null });
    });
  });

  it('move only her own: another designer’s stay', async () => {
    await inTransaction(async (c) => {
      const a = await createUser(c, 'a@example.test');
      const b = await createUser(c, 'b@example.test');
      await actAs(c, a);
      await step(c, null, 'Hers', { on_day: await inDays(c, -1) });
      await actAs(c, b);
      expect(await one(c, `select public.carry_over() as n`)).toEqual({ n: 0 });
      await actAs(c, a);
      expect(await where(c, 'Hers')).toMatchObject({ moved_from: null });
    });
  });
});
