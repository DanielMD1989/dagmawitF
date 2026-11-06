import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Client, PoolClient } from 'pg';
import { connect, migrate, scratchDatabase, type Scratch } from '../../scripts/drill/database';
import { actAs, actAsOwner, attempt, createUser, inTransaction } from './helpers';

// Every customer order has its Delivery as a step, on its delivery day (decision 0096).

const one = async <T = Record<string, unknown>>(
  c: PoolClient | Client,
  sql: string,
  params: unknown[] = [],
) => (await c.query(sql, params)).rows[0] as T;

const day = async (c: PoolClient, n: number) =>
  (await one<{ d: string }>(c, `select (app.today_for((select auth.uid())) + $1::int)::text as d`, [n])).d;

async function signedIn<T>(fn: (c: PoolClient) => Promise<T>) {
  return inTransaction(async (c) => {
    await actAs(c, await createUser(c, 'a@example.test', 'Dagmawit'));
    return fn(c);
  });
}

/** A customer order due in `inDays`, confirmed. */
async function order(c: PoolClient, inDays = 10) {
  const client = (
    await one<{ id: string }>(c, `insert into public.client (name) values ('Selam') returning id`)
  ).id;
  const id = (
    await one<{ id: string }>(
      c,
      `insert into public.orders (client_id, delivery_on) values ($1, $2) returning id`,
      [client, await day(c, inDays)],
    )
  ).id;
  await c.query(`update public.orders set status = 'active' where id = $1`, [id]);
  return id;
}

const deliveries = (c: PoolClient, id: string) =>
  c
    .query<{ on_day: string; done_on: string | null; starts_at: string | null }>(
      `select on_day::text, done_on::text, starts_at::text from public.task where order_id = $1 and title = 'Delivery'`,
      [id],
    )
    .then((r) => r.rows);

const dueOn = async (c: PoolClient, id: string) =>
  (await one<{ d: string }>(c, `select delivery_on::text as d from public.orders where id = $1`, [id])).d;

describe('an order’s Delivery step', () => {
  it('comes with every customer order, on its delivery day; an event has none', async () => {
    await signedIn(async (c) => {
      const id = await order(c);
      expect(await deliveries(c, id)).toEqual([{ on_day: await day(c, 10), done_on: null, starts_at: null }]);
      const event = (
        await one<{ id: string }>(
          c,
          `insert into public.orders (title, delivery_on) values ('Bazaar', $1) returning id`,
          [await day(c, 5)],
        )
      ).id;
      expect(await deliveries(c, event)).toEqual([]);
    });
  });

  it('stays last: a step added at the end comes before it', async () => {
    await signedIn(async (c) => {
      const id = await order(c);
      for (const [title, sort] of [
        ['Cutting', 10],
        ['Fitting', 100000],
      ] as const)
        await c.query(`insert into public.task (order_id, title, sort) values ($1, $2, $3)`, [
          id,
          title,
          sort,
        ]);
      const titles = (
        await c.query(`select title from public.task where order_id = $1 order by sort`, [id])
      ).rows.map((r) => r.title);
      expect(titles).toEqual(['Cutting', 'Fitting', 'Delivery']);
    });
  });

  it('is the delivery day: changing either moves the other', async () => {
    await signedIn(async (c) => {
      const id = await order(c);
      await c.query(`update public.orders set delivery_on = $2 where id = $1`, [id, await day(c, 12)]);
      expect((await deliveries(c, id))[0]!.on_day).toBe(await day(c, 12));
      await c.query(`update public.task set on_day = $2 where order_id = $1 and title = 'Delivery'`, [
        id,
        await day(c, 14),
      ]);
      expect(await dueOn(c, id)).toBe(await day(c, 14));
      // The order's own rule holds: a confirmed order's day is not moved into the past.
      const past = await attempt(
        c,
        `update public.task set on_day = $2 where order_id = $1 and title = 'Delivery'`,
        [id, await day(c, -2)],
      );
      expect(past).toMatchObject({ ok: false, code: '23514' });
    });
  });

  it('moves with the due day once, the other steps by as many days', async () => {
    await signedIn(async (c) => {
      const id = await order(c);
      await c.query(`insert into public.task (order_id, title, on_day) values ($1, 'Fitting', $2)`, [
        id,
        await day(c, 8),
      ]);
      const moved = await one<{ n: number }>(c, `select public.move_due_day($1, $2, true) as n`, [
        id,
        await day(c, 13),
      ]);
      expect(moved).toEqual({ n: 1 });
      expect((await deliveries(c, id))[0]!.on_day).toBe(await day(c, 13));
      expect(
        await one(c, `select on_day::text as d from public.task where order_id = $1 and title = 'Fitting'`, [
          id,
        ]),
      ).toEqual({ d: await day(c, 11) });
    });
  });

  it('is ticked when the order is finished, and unticked when it is reopened, on its new day', async () => {
    await signedIn(async (c) => {
      const id = await order(c);
      await c.query(`update public.orders set status = 'delivered', delivered_on = $2 where id = $1`, [
        id,
        await day(c, 0),
      ]);
      expect((await deliveries(c, id))[0]!.done_on).toBe(await day(c, 0));
      await c.query(`update public.orders set status = 'active', delivery_on = $2 where id = $1`, [
        id,
        await day(c, 3),
      ]);
      expect(await deliveries(c, id)).toEqual([{ on_day: await day(c, 3), done_on: null, starts_at: null }]);
    });
  });

  it('cannot be removed or renamed, and "Delivery" added again is the same one, given its time', async () => {
    await signedIn(async (c) => {
      const id = await order(c);
      expect(
        await attempt(c, `delete from public.task where order_id = $1 and title = 'Delivery'`, [id]),
      ).toMatchObject({ ok: false, code: '23514' });
      expect(
        await attempt(
          c,
          `update public.task set title = 'Pick-up' where order_id = $1 and title = 'Delivery'`,
          [id],
        ),
      ).toMatchObject({ ok: false, code: '23514' });
      await c.query(
        `insert into public.task (order_id, title, on_day, starts_at) values ($1, 'Delivery', $2, '16:00')`,
        [id, await day(c, 10)],
      );
      expect(await deliveries(c, id)).toEqual([
        { on_day: await day(c, 10), done_on: null, starts_at: '16:00:00' },
      ]);
      // Its time can be changed; it can be part of nothing else: one day, the delivery day.
      expect(
        await attempt(
          c,
          `update public.task set until_day = on_day + 2 where order_id = $1 and title = 'Delivery'`,
          [id],
        ),
      ).toMatchObject({ ok: false, code: '23514' });
    });
  });

  it('does not stop a whole account from being removed (an order is never deleted alone, only cancelled)', async () => {
    await inTransaction(async (c) => {
      const her = await createUser(c, 'leaving@example.test');
      await actAs(c, her);
      await order(c);
      await actAsOwner(c);
      await c.query(`delete from auth.users where id = $1`, [her]);
      expect(await one(c, `select count(*)::int as n from public.task where owner_id = $1`, [her])).toEqual({
        n: 0,
      });
    });
  });
});

describe('her orders as they were before', () => {
  const BEFORE = '20261109090000';
  let scratch: Scratch;
  let db: Client;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    scratch = await scratchDatabase(inject('adminUrl'), 'dagmawit_delivery_step', BEFORE);
    db = await connect(scratch.url);
    const her = (
      await one<{ id: string }>(
        db,
        `insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), 'her@example.test', '{}') returning id`,
      )
    ).id;
    const client = (
      await one<{ id: string }>(
        db,
        `insert into public.client (owner_id, name) values ($1, 'Megan') returning id`,
        [her],
      )
    ).id;
    const make = async (name: string, clientId: string | null, status: 'active' | 'delivered') => {
      const id = (
        await one<{ id: string }>(
          db,
          `insert into public.orders (owner_id, client_id, title, delivery_on, status)
           values ($1, $2, $3, current_date + 9, 'draft') returning id`,
          [her, clientId, name],
        )
      ).id;
      await db.query(`update public.orders set status = 'active' where id = $1`, [id]);
      if (status === 'delivered')
        await db.query(
          `update public.orders set status = 'delivered', delivered_on = current_date where id = $1`,
          [id],
        );
      ids[name] = id;
      return id;
    };
    await make('No delivery step', client, 'active');
    const elsewhere = await make('Delivery elsewhere', client, 'active');
    await db.query(
      `insert into public.task (owner_id, order_id, title, on_day, starts_at, sort) values ($1, $2, 'Delivery', current_date + 4, '15:00', 30)`,
      [her, elsewhere],
    );
    await db.query(
      `insert into public.task (owner_id, order_id, title, on_day, sort) values ($1, $2, 'Sewing', current_date + 2, 50)`,
      [her, elsewhere],
    );
    await make('Finished', client, 'delivered');
    await make('An event', null, 'active');
    await migrate(db, { from: BEFORE, upTo: '20261110090000' });
  });

  afterAll(async () => {
    await db?.end();
    await scratch?.drop();
  });

  const delivery = (name: string) =>
    db
      .query(
        `select t.on_day = o.delivery_on as on_its_day, t.starts_at::text, t.sort from public.task t
         join public.orders o on o.id = t.order_id where t.order_id = $1 and t.title = 'Delivery'`,
        [ids[name]],
      )
      .then((r) => r.rows);

  it('each order in progress has its Delivery on its day, after its other steps; one already there keeps its time', async () => {
    expect(await delivery('No delivery step')).toEqual([{ on_its_day: true, starts_at: null, sort: 100000 }]);
    expect(await delivery('Delivery elsewhere')).toEqual([
      { on_its_day: true, starts_at: '15:00:00', sort: 100000 },
    ]);
  });

  it('a finished order and an event are left as they were', async () => {
    expect(await delivery('Finished')).toEqual([]);
    expect(await delivery('An event')).toEqual([]);
  });
});
