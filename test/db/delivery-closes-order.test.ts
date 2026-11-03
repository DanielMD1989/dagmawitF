import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Client, PoolClient } from 'pg';
import { connect, migrate, scratchDatabase, type Scratch } from '../../scripts/drill/database';
import { actAs, attempt, createUser, inTransaction } from './helpers';

// Ticking an order's Delivery step done finishes the order (decision 0089).

const one = async <T = Record<string, unknown>>(
  c: PoolClient | Client,
  sql: string,
  params: unknown[] = [],
) => (await c.query(sql, params)).rows[0] as T;

/** An order in a status, with a Delivery step on her today and a Sewing step not done. */
async function order(c: PoolClient, status: 'draft' | 'active' | 'on_hold' = 'active') {
  const client = (
    await one<{ id: string }>(c, `insert into public.client (name) values ('Selam') returning id`)
  ).id;
  const id = (
    await one<{ id: string }>(
      c,
      `insert into public.orders (client_id, delivery_on) values ($1, app.today_for((select auth.uid())) + 3)
       returning id`,
      [client],
    )
  ).id;
  if (status !== 'draft') await c.query(`update public.orders set status = 'active' where id = $1`, [id]);
  if (status === 'on_hold')
    await c.query(`update public.orders set status = 'on_hold', hold_reason = 'Abroad' where id = $1`, [id]);
  for (const title of ['Sewing', 'Delivery'])
    await c.query(
      `insert into public.task (order_id, title, on_day) values ($1, $2, app.today_for((select auth.uid())))`,
      [id, title],
    );
  return id;
}

const tick = (c: PoolClient, id: string, done: boolean) =>
  c.query(
    `update public.task set done_on = ${done ? 'app.today_for((select auth.uid()))' : 'null'}
     where order_id = $1 and title = 'Delivery'`,
    [id],
  );

const state = (c: PoolClient, id: string) =>
  one<{ status: string; finished_today: boolean | null }>(
    c,
    `select status, delivered_on = app.today_for((select auth.uid())) as finished_today from public.orders where id = $1`,
    [id],
  );

async function signedIn<T>(fn: (c: PoolClient) => Promise<T>) {
  return inTransaction(async (c) => {
    await actAs(c, await createUser(c, 'a@example.test', 'Dagmawit'));
    return fn(c);
  });
}

describe('ticking the Delivery step', () => {
  it('finishes an active order that day, other steps or not, and says so on its history', async () => {
    await signedIn(async (c) => {
      const id = await order(c);
      await tick(c, id, true);
      expect(await state(c, id)).toEqual({ status: 'delivered', finished_today: true });
      expect(
        await one(
          c,
          `select array_agg(action order by seq) as a from (
             select action, seq from public.activity_log where order_id = $1 order by seq desc limit 2) l`,
          [id],
        ),
      ).toEqual({ a: ['task_done', 'status_changed'] });
    });
  });

  it('leaves a draft or paused order as it is, and another step done changes nothing', async () => {
    await signedIn(async (c) => {
      const draft = await order(c, 'draft');
      const paused = await order(c, 'on_hold');
      await tick(c, draft, true);
      await tick(c, paused, true);
      expect((await state(c, draft)).status).toBe('draft');
      expect((await state(c, paused)).status).toBe('on_hold');
      const active = await order(c);
      await c.query(
        `update public.task set done_on = app.today_for((select auth.uid())) where order_id = $1 and title = 'Sewing'`,
        [active],
      );
      expect((await state(c, active)).status).toBe('active');
    });
  });

  it('cannot be unticked while the order is finished: she reopens the order first', async () => {
    await signedIn(async (c) => {
      const id = await order(c);
      await tick(c, id, true);
      const untick = await attempt(
        c,
        `update public.task set done_on = null where order_id = $1 and title = 'Delivery'`,
        [id],
      );
      expect(untick).toMatchObject({ ok: false });
      expect((await state(c, id)).status).toBe('delivered');
    });
  });
});

describe('orders handed over before the change', () => {
  const BEFORE = '20261107090000';
  let scratch: Scratch;
  let db: Client;
  let handed: string;
  let open: string;

  beforeAll(async () => {
    scratch = await scratchDatabase(inject('adminUrl'), 'dagmawit_delivery', BEFORE);
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
    const make = async (done: boolean) => {
      const id = (
        await one<{ id: string }>(
          db,
          `insert into public.orders (owner_id, client_id, title, delivery_on, status)
           values ($1, $2, 'Dress', current_date + 5, 'draft') returning id`,
          [her, client],
        )
      ).id;
      await db.query(`update public.orders set status = 'active' where id = $1`, [id]);
      await db.query(
        `insert into public.task (owner_id, order_id, title, on_day, done_on) values ($1, $2, 'Delivery', current_date - 3, $3)`,
        [her, id, done ? new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10) : null],
      );
      return id;
    };
    handed = await make(true);
    open = await make(false);
    await migrate(db, { from: BEFORE, upTo: '20261108090000' });
  });

  afterAll(async () => {
    await db?.end();
    await scratch?.drop();
  });

  it('are finished on the day their Delivery was ticked; the others stay active', async () => {
    expect(
      await one(
        db,
        `select status, delivered_on = (select done_on from public.task where order_id = $1) as on_that_day
         from public.orders where id = $1`,
        [handed],
      ),
    ).toEqual({ status: 'delivered', on_that_day: true });
    expect(await one(db, `select status from public.orders where id = $1`, [open])).toEqual({
      status: 'active',
    });
  });
});
