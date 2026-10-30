import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { ORDER_STATUSES, canMove, type OrderStatus } from '../../src/domain/orders/status';
import { GARMENT_CASES } from '../fixtures/capture-cases';
import { actAs, actAsOwner, attempt, createUser, idOf, inTransaction } from './helpers';

const CHECK = '23514';
const UNIQUE = '23505';
const FOREIGN_KEY = '23503';
const NO_RIGHT = '42501';

async function signedIn<T>(fn: (c: PoolClient, userId: string) => Promise<T>) {
  return inTransaction(async (c) => {
    const id = await createUser(c, 'a@example.test');
    await actAs(c, id);
    return fn(c, id);
  });
}

/** Her today, as the database sees it. */
async function today(c: PoolClient): Promise<string> {
  const { rows } = await c.query<{ d: string }>(
    `select to_char(app.today_for((select auth.uid())), 'YYYY-MM-DD') as d`,
  );
  return rows[0]!.d;
}

async function inDays(c: PoolClient, n: number): Promise<string> {
  const { rows } = await c.query<{ d: string }>(
    `select to_char(app.today_for((select auth.uid())) + $1::int, 'YYYY-MM-DD') as d`,
    [n],
  );
  return rows[0]!.d;
}

async function addClient(c: PoolClient, name = 'Selam Tesfaye'): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `insert into public.client (name) values ($1) returning id`,
    [name],
  );
  return rows[0]!.id;
}

/** A draft order with one garment. */
async function addOrder(
  c: PoolClient,
  clientId?: string,
  over: { number?: number; deliveryOn?: string } = {},
) {
  const client = clientId ?? (await addClient(c));
  const delivery = over.deliveryOn ?? (await inDays(c, 30));
  const { rows } = await c.query<{ id: string }>(
    `insert into public.orders (client_id, delivery_on, number) values ($1, $2, $3) returning id`,
    [client, delivery, over.number ?? null],
  );
  const orderId = rows[0]!.id;
  await c.query(`insert into public.order_item (order_id, garment_type) values ($1, 'Bridal gown')`, [
    orderId,
  ]);
  return { orderId, clientId: client };
}

const setStatus = (c: PoolClient, id: string, sql: string, params: unknown[] = []) =>
  attempt(c, `update public.orders set ${sql} where id = $1 returning status`, [id, ...params]);

/** Walks a fresh order to a status along allowed moves. `prepare` runs first, while the order is still a draft. */
async function orderIn(c: PoolClient, status: OrderStatus, prepare?: (orderId: string) => Promise<void>) {
  const o = await addOrder(c);
  if (prepare) await prepare(o.orderId);
  const t = await today(c);
  const steps: Record<OrderStatus, string[]> = {
    draft: [],
    active: [`status = 'active'`],
    on_hold: [`status = 'active'`, `status = 'on_hold', hold_reason = 'Waiting for client'`],
    delivered: [`status = 'active'`, `status = 'delivered', delivered_on = '${t}'`],
    cancelled: [`status = 'cancelled', cancel_reason = 'Client changed her mind'`],
  };
  for (const step of steps[status]) {
    const r = await setStatus(c, o.orderId, step);
    if (!r.ok) throw new Error(`could not reach ${status}: ${r.message}`);
  }
  return o;
}

describe('the moves between statuses', () => {
  it('is the same table as the screen uses, over every pair of statuses', async () => {
    await signedIn(async (c) => {
      for (const from of ORDER_STATUSES) {
        for (const to of ORDER_STATUSES) {
          const { rows } = await c.query<{ ok: boolean }>(`select app.order_move_allowed($1, $2) as ok`, [
            from,
            to,
          ]);
          expect(rows[0]!.ok, `${from} to ${to}`).toBe(canMove(from, to));
        }
      }
    });
  });

  // The test of the table itself is above. This one proves the trigger really uses it, on live rows.
  const pairs = ORDER_STATUSES.flatMap((from) =>
    ORDER_STATUSES.filter((to) => to !== from).map((to) => [from, to] as const),
  );

  it.each(pairs)('%s to %s', async (from, to) => {
    await signedIn(async (c) => {
      const { orderId } = await orderIn(c, from);
      const t = await today(c);
      // Everything the target status needs is supplied, so only the move itself can be the problem.
      const sets: Record<OrderStatus, string> = {
        draft: `status = 'draft'`,
        active: `status = 'active', delivery_on = '${await inDays(c, 20)}'`,
        on_hold: `status = 'on_hold', hold_reason = 'Fabric not coming'`,
        delivered: `status = 'delivered', delivered_on = '${t}'`,
        cancelled: `status = 'cancelled'`,
      };
      const r = await setStatus(c, orderId, sets[to]);
      if (canMove(from, to))
        expect(r, `${from} to ${to}`).toMatchObject({ ok: true, rows: [{ status: to }] });
      else expect(r, `${from} to ${to}`).toMatchObject({ ok: false, code: CHECK });
    });
  });
});

describe('what each status needs', () => {
  it('starts every order as a draft and refuses to create one already confirmed', async () => {
    await signedIn(async (c) => {
      const client = await addClient(c);
      const r = await attempt(
        c,
        `insert into public.orders (client_id, delivery_on, status) values ($1, '2030-01-01', 'active')`,
        [client],
      );
      expect(r).toMatchObject({ ok: false, code: CHECK });
    });
  });

  it('confirms a job with no garment: an appointment has none (decision 0066)', async () => {
    await signedIn(async (c) => {
      const client = await addClient(c);
      const { rows } = await c.query(
        `insert into public.orders (client_id, delivery_on) values ($1, $2) returning id`,
        [client, await inDays(c, 30)],
      );
      expect(await setStatus(c, rows[0]!.id, `status = 'active'`)).toMatchObject({ ok: true });
    });
  });

  it('may be for nobody, an event such as a bazaar, but then needs a name (decision 0068)', async () => {
    await signedIn(async (c) => {
      const day = await inDays(c, 30);
      expect(await attempt(c, `insert into public.orders (delivery_on) values ($1)`, [day])).toMatchObject({
        ok: false,
        code: CHECK,
      });
      const { rows } = await c.query(
        `insert into public.orders (delivery_on, title) values ($1, 'Bazaar at the Hyatt') returning id`,
        [day],
      );
      expect(await setStatus(c, rows[0]!.id, `status = 'active'`)).toMatchObject({ ok: true });
      expect(await setStatus(c, rows[0]!.id, `title = ''`)).toMatchObject({ ok: false, code: CHECK });
      expect(await setStatus(c, rows[0]!.id, `title = ' Bazaar '`)).toMatchObject({ ok: false, code: CHECK });
    });
  });

  it('will not confirm an order whose handover day has passed, but will with a new one', async () => {
    await signedIn(async (c) => {
      const { orderId } = await addOrder(c, undefined, { deliveryOn: await inDays(c, -3) });
      expect(await setStatus(c, orderId, `status = 'active'`)).toMatchObject({ ok: false, code: CHECK });
      const r = await setStatus(c, orderId, `status = 'active', delivery_on = $2`, [await inDays(c, 10)]);
      expect(r.ok).toBe(true);
    });
  });

  it('allows confirming on the handover day itself', async () => {
    await signedIn(async (c) => {
      const { orderId } = await addOrder(c, undefined, { deliveryOn: await today(c) });
      expect((await setStatus(c, orderId, `status = 'active'`)).ok).toBe(true);
    });
  });

  it('needs a reason to put an order on hold, and keeps it only while on hold', async () => {
    await signedIn(async (c) => {
      const { orderId } = await orderIn(c, 'active');
      expect(await setStatus(c, orderId, `status = 'on_hold'`)).toMatchObject({ ok: false, code: CHECK });
      expect(await setStatus(c, orderId, `status = 'on_hold', hold_reason = '  '`)).toMatchObject({
        ok: false,
        code: CHECK,
      });
      expect((await setStatus(c, orderId, `status = 'on_hold', hold_reason = 'Client abroad'`)).ok).toBe(
        true,
      );
      expect((await setStatus(c, orderId, `status = 'active'`)).ok).toBe(true);
      const { rows } = await c.query(`select hold_reason from public.orders where id = $1`, [orderId]);
      expect(rows[0]!.hold_reason).toBe('');
    });
  });

  it('refuses a hold reason on an order that is not on hold', async () => {
    await signedIn(async (c) => {
      const { orderId } = await orderIn(c, 'active');
      expect(await setStatus(c, orderId, `hold_reason = 'Just in case'`)).toMatchObject({
        ok: false,
        code: CHECK,
      });
    });
  });

  it('needs the day it was delivered, and not a day in the future', async () => {
    await signedIn(async (c) => {
      const { orderId } = await orderIn(c, 'active');
      expect(await setStatus(c, orderId, `status = 'delivered'`)).toMatchObject({ ok: false, code: CHECK });
      expect(
        await setStatus(c, orderId, `status = 'delivered', delivered_on = $2`, [await inDays(c, 1)]),
      ).toMatchObject({ ok: false, code: CHECK });
      const r = await setStatus(c, orderId, `status = 'delivered', delivered_on = $2`, [await inDays(c, -2)]);
      expect(r.ok).toBe(true);
    });
  });

  it('keeps a cancel reason only while cancelled, and the reason is optional', async () => {
    await signedIn(async (c) => {
      const { orderId } = await orderIn(c, 'active');
      expect(await setStatus(c, orderId, `cancel_reason = 'x'`)).toMatchObject({ ok: false, code: CHECK });
      expect((await setStatus(c, orderId, `status = 'cancelled'`)).ok).toBe(true);
      const again = await orderIn(c, 'cancelled');
      const { rows } = await c.query(`select cancel_reason from public.orders where id = $1`, [
        again.orderId,
      ]);
      expect(rows[0]!.cancel_reason).toBe('Client changed her mind');
      expect((await setStatus(c, again.orderId, `status = 'draft'`)).ok).toBe(true);
      const cleared = await c.query(`select cancel_reason from public.orders where id = $1`, [again.orderId]);
      expect(cleared.rows[0]!.cancel_reason).toBe('');
    });
  });

  it('forgets the delivered day when an order is reopened, and wants a handover day that has not passed', async () => {
    await signedIn(async (c) => {
      const { orderId } = await addOrder(c, undefined, { deliveryOn: await inDays(c, 1) });
      await setStatus(c, orderId, `status = 'active'`);
      await setStatus(c, orderId, `status = 'delivered', delivered_on = $2, delivery_on = $3`, [
        await inDays(c, 0),
        await inDays(c, 0),
      ]);
      // Time moves on: the old handover day is now in the past. (The rules would not let anyone write
      // that today, so the clock is wound on by hand, with the rules switched off for this one update.)
      await actAsOwner(c);
      await c.query(`alter table public.orders disable trigger orders_before_update`);
      await c.query(
        `update public.orders set delivery_on = delivery_on - 5, delivered_on = delivered_on - 5 where id = $1`,
        [orderId],
      );
      await c.query(`alter table public.orders enable trigger orders_before_update`);
      await actAs(
        c,
        (await c.query(`select owner_id from public.orders where id = $1`, [orderId])).rows[0]!.owner_id,
      );
      expect(await setStatus(c, orderId, `status = 'active'`)).toMatchObject({ ok: false, code: CHECK });
      expect(
        (await setStatus(c, orderId, `status = 'active', delivery_on = $2`, [await inDays(c, 7)])).ok,
      ).toBe(true);
      const { rows } = await c.query(`select delivered_on from public.orders where id = $1`, [orderId]);
      expect(rows[0]!.delivered_on).toBeNull();
    });
  });

  it('will not move the handover day of an active order into the past, but a draft or paused one may', async () => {
    await signedIn(async (c) => {
      const past = await inDays(c, -4);
      const active = await orderIn(c, 'active');
      expect(await setStatus(c, active.orderId, `delivery_on = $2`, [past])).toMatchObject({
        ok: false,
        code: CHECK,
      });
      const draft = await orderIn(c, 'draft');
      expect((await setStatus(c, draft.orderId, `delivery_on = $2`, [past])).ok).toBe(true);
      const hold = await orderIn(c, 'on_hold');
      expect((await setStatus(c, hold.orderId, `delivery_on = $2`, [past])).ok).toBe(true);
    });
  });
});

describe('a delivered or cancelled order is a record', () => {
  it.each(['delivered', 'cancelled'] as const)('lets a %s order change its notes only', async (status) => {
    await signedIn(async (c) => {
      const { orderId } = await orderIn(c, status);
      expect((await setStatus(c, orderId, `notes = 'Collected by her sister'`)).ok).toBe(true);
      expect(await setStatus(c, orderId, `delivery_on = '2031-01-01'`)).toMatchObject({
        ok: false,
        code: CHECK,
      });
      expect(await setStatus(c, orderId, `title = 'Renamed'`)).toMatchObject({ ok: false, code: CHECK });
      expect(
        await setStatus(c, orderId, `client_id = $2`, [await addClient(c, 'Someone else')]),
      ).toMatchObject({
        ok: false,
        code: CHECK,
      });
    });
  });
});

describe('what hangs from a delivered or cancelled order is a record too', () => {
  const addStep = (c: PoolClient) => async (orderId: string) => {
    await c.query(`insert into public.task (order_id, title, on_day) values ($1, 'Buy lace', '2026-01-05')`, [
      orderId,
    ]);
  };

  it.each(['delivered', 'cancelled'] as const)(
    'keeps the garments of a %s order as they are',
    async (status) => {
      await signedIn(async (c) => {
        const { orderId } = await orderIn(c, status);
        expect(
          await attempt(c, `insert into public.order_item (order_id, garment_type) values ($1, 'Veil')`, [
            orderId,
          ]),
        ).toMatchObject({ ok: false, code: CHECK });
        expect(
          await attempt(c, `update public.order_item set brief = 'Longer' where order_id = $1`, [orderId]),
        ).toMatchObject({
          ok: false,
          code: CHECK,
        });
        expect(
          await attempt(c, `delete from public.order_item where order_id = $1`, [orderId]),
        ).toMatchObject({
          ok: false,
          code: CHECK,
        });
        const { rows } = await c.query(
          `select garment_type, brief from public.order_item where order_id = $1`,
          [orderId],
        );
        expect(rows).toEqual([{ garment_type: 'Bridal gown', brief: '' }]);
      });
    },
  );

  it.each(['delivered', 'cancelled'] as const)(
    'keeps the steps of a %s order as they are',
    async (status) => {
      await signedIn(async (c) => {
        const { orderId } = await orderIn(c, status, addStep(c));
        expect(
          await attempt(c, `insert into public.task (order_id, title) values ($1, 'Press')`, [orderId]),
        ).toMatchObject({ ok: false, code: CHECK });
        expect(
          await attempt(c, `update public.task set on_day = '2026-01-06' where order_id = $1`, [orderId]),
        ).toMatchObject({ ok: false, code: CHECK });
        expect(await attempt(c, `delete from public.task where order_id = $1`, [orderId])).toMatchObject({
          ok: false,
          code: CHECK,
        });
        const { rows } = await c.query(`select title, on_day::text from public.task where order_id = $1`, [
          orderId,
        ]);
        expect(rows).toEqual([{ title: 'Buy lace', on_day: '2026-01-05' }]);
      });
    },
  );

  it('can be changed again once the order is reopened', async () => {
    await signedIn(async (c) => {
      const { orderId } = await orderIn(c, 'delivered', addStep(c));
      expect(await setStatus(c, orderId, `status = 'active'`)).toMatchObject({ ok: true });
      expect(
        await attempt(c, `update public.order_item set brief = 'Longer' where order_id = $1`, [orderId]),
      ).toMatchObject({
        ok: true,
      });
      expect(
        await attempt(c, `update public.task set on_day = '2026-01-07' where order_id = $1`, [orderId]),
      ).toMatchObject({ ok: true });
    });
  });

  it('does not stop a whole account with a delivered order from being removed', async () => {
    await inTransaction(async (c) => {
      const id = await createUser(c, 'leaving@example.test');
      await actAs(c, id);
      await orderIn(c, 'delivered', addStep(c));
      await actAsOwner(c);
      await c.query(`delete from auth.users where id = $1`, [id]);
      for (const t of ['orders', 'order_item', 'task']) {
        const { rows } = await c.query(`select count(*)::int as n from public.${t}`);
        expect(rows[0]!.n, t).toBe(0);
      }
    });
  });
});

describe('order numbers', () => {
  it('continue from her highest number, for each designer on her own', async () => {
    await inTransaction(async (c) => {
      const a = await createUser(c, 'a@example.test');
      const b = await createUser(c, 'b@example.test');
      const numbers: Record<string, number[]> = { a: [], b: [] };
      for (const [who, id] of [
        ['a', a],
        ['b', b],
        ['a', a],
        ['a', a],
        ['b', b],
      ] as const) {
        await actAs(c, id);
        const { orderId } = await addOrder(c);
        const { rows } = await c.query(`select number from public.orders where id = $1`, [orderId]);
        numbers[who]!.push(rows[0]!.number);
      }
      expect(numbers).toEqual({ a: [1, 2, 3], b: [1, 2] });
    });
  });

  it('can start from a number she chooses, and carries on from there', async () => {
    await signedIn(async (c) => {
      const first = await addOrder(c, undefined, { number: 105 });
      const second = await addOrder(c);
      const { rows } = await c.query(`select id, number from public.orders order by number`);
      expect(rows).toEqual([
        { id: first.orderId, number: 105 },
        { id: second.orderId, number: 106 },
      ]);
    });
  });

  it('are never repeated', async () => {
    await signedIn(async (c) => {
      await addOrder(c, undefined, { number: 7 });
      const client = await addClient(c);
      const r = await attempt(
        c,
        `insert into public.orders (client_id, delivery_on, number) values ($1, '2030-01-01', 7)`,
        [client],
      );
      expect(r).toMatchObject({ ok: false, code: UNIQUE });
    });
  });

  it('never change', async () => {
    await signedIn(async (c) => {
      const { orderId } = await addOrder(c);
      expect(await setStatus(c, orderId, `number = 99`)).toMatchObject({ ok: false, code: NO_RIGHT });
    });
  });

  it('must be positive', async () => {
    await signedIn(async (c) => {
      const client = await addClient(c);
      const r = await attempt(
        c,
        `insert into public.orders (client_id, delivery_on, number) values ($1, '2030-01-01', 0)`,
        [client],
      );
      expect(r).toMatchObject({ ok: false, code: CHECK });
    });
  });
});

describe('her settings for jobs', () => {
  it('keep the unit for new measurements, within its choices', async () => {
    await signedIn(async (c) => {
      const { rows } = await c.query(`select measurement_unit as u from public.profile`);
      expect(rows[0]).toEqual({ u: 'cm' });
      expect(await attempt(c, `update public.profile set measurement_unit = 'ft'`)).toMatchObject({
        ok: false,
        code: CHECK,
      });
    });
  });
});

describe('deleting', () => {
  it('is not possible through the table, for any order', async () => {
    await signedIn(async (c) => {
      const { orderId } = await addOrder(c);
      expect(await attempt(c, `delete from public.orders where id = $1`, [orderId])).toMatchObject({
        ok: false,
        code: NO_RIGHT,
      });
    });
  });

  it.each(['draft', 'active', 'on_hold', 'delivered', 'cancelled'] as const)(
    'is done by its own function for a job that is %s, taking its garments, steps and history with it',
    async (status) => {
      await signedIn(async (c) => {
        const { orderId } = await orderIn(c, status, async (id) => {
          await c.query(`insert into public.task (order_id, title) values ($1, 'Buy fabric')`, [id]);
        });
        expect((await attempt(c, `select public.delete_job($1)`, [orderId])).ok).toBe(true);
        for (const t of ['orders', 'order_item', 'task']) {
          const { rows } = await c.query(`select count(*)::int as n from public.${t}`);
          expect(rows[0]!.n, t).toBe(0);
        }
        await actAsOwner(c);
        const { rows } = await c.query(
          `select count(*)::int as n from public.activity_log where order_id = $1`,
          [orderId],
        );
        expect(rows[0]!.n).toBe(0);
      });
    },
  );

  it("cannot be used on someone else's job, nor on one that is not there", async () => {
    await inTransaction(async (c) => {
      const a = await createUser(c, 'a@example.test');
      const b = await createUser(c, 'b@example.test');
      await actAs(c, a);
      const { orderId } = await addOrder(c);
      await actAs(c, b);
      for (const id of [orderId, '00000000-0000-0000-0000-000000000000']) {
        expect(await attempt(c, `select public.delete_job($1)`, [id])).toMatchObject({
          ok: false,
          code: 'P0002',
        });
      }
      await actAsOwner(c);
      const { rows } = await c.query(`select count(*)::int as n from public.orders`);
      expect(rows[0]!.n).toBe(1);
    });
  });

  it('is refused for a client who still has orders, and allowed once they are gone', async () => {
    await signedIn(async (c) => {
      const { orderId, clientId } = await addOrder(c);
      expect(await attempt(c, `delete from public.client where id = $1`, [clientId])).toMatchObject({
        ok: false,
        code: FOREIGN_KEY,
      });
      await c.query(`select public.delete_job($1)`, [orderId]);
      expect((await attempt(c, `delete from public.client where id = $1`, [clientId])).ok).toBe(true);
    });
  });
});

describe('garments', () => {
  it.each(GARMENT_CASES)('agrees with the screen on $label', async ({ garment, valid }) => {
    await signedIn(async (c) => {
      const { orderId } = await addOrder(c);
      const r = await attempt(
        c,
        `insert into public.order_item (order_id, garment_type, brief) values ($1, $2, $3)`,
        [orderId, garment.garmentType, garment.brief],
      );
      if (valid) expect(r.ok).toBe(true);
      else expect(r).toMatchObject({ ok: false, code: CHECK });
    });
  });

  it('cannot be moved to another order', async () => {
    await signedIn(async (c) => {
      const one = await addOrder(c);
      const two = await addOrder(c);
      expect(
        await attempt(c, `update public.order_item set order_id = $1 where order_id = $2`, [
          two.orderId,
          one.orderId,
        ]),
      ).toMatchObject({ ok: false, code: NO_RIGHT });
    });
  });

  it('may be made to the client’s own measurements, and no one else’s', async () => {
    await signedIn(async (c) => {
      const { orderId, clientId } = await addOrder(c);
      const other = await addClient(c, 'Other client');
      const mine = (
        await c.query(
          `insert into public.measurement_set (client_id, taken_on, unit, measures) values ($1, '2026-10-01', 'cm', '{"bust": 90}') returning id`,
          [clientId],
        )
      ).rows[0]!.id;
      const theirs = (
        await c.query(
          `insert into public.measurement_set (client_id, taken_on, unit, measures) values ($1, '2026-10-01', 'cm', '{"bust": 80}') returning id`,
          [other],
        )
      ).rows[0]!.id;
      const update = (set: string) =>
        attempt(c, `update public.order_item set measurement_set_id = $1 where order_id = $2`, [
          set,
          orderId,
        ]);
      expect((await update(mine)).ok).toBe(true);
      expect(await update(theirs)).toMatchObject({ ok: false, code: CHECK });
    });
  });

  it('keeps hold of the measurements it was made to: they cannot be deleted', async () => {
    await signedIn(async (c) => {
      const { orderId, clientId } = await addOrder(c);
      const set = (
        await c.query(
          `insert into public.measurement_set (client_id, taken_on, unit, measures) values ($1, '2026-10-01', 'cm', '{"bust": 90}') returning id`,
          [clientId],
        )
      ).rows[0]!.id;
      await c.query(`update public.order_item set measurement_set_id = $1 where order_id = $2`, [
        set,
        orderId,
      ]);
      expect(await attempt(c, `delete from public.measurement_set where id = $1`, [set])).toMatchObject({
        ok: false,
        code: FOREIGN_KEY,
      });
    });
  });

  it('lets go of the old measurements when the order changes client', async () => {
    await signedIn(async (c) => {
      const { orderId, clientId } = await addOrder(c);
      const set = (
        await c.query(
          `insert into public.measurement_set (client_id, taken_on, unit, measures) values ($1, '2026-10-01', 'cm', '{"bust": 90}') returning id`,
          [clientId],
        )
      ).rows[0]!.id;
      await c.query(`update public.order_item set measurement_set_id = $1 where order_id = $2`, [
        set,
        orderId,
      ]);
      const other = await addClient(c, 'Other client');
      expect((await setStatus(c, orderId, `client_id = $2`, [other])).ok).toBe(true);
      const { rows } = await c.query(`select measurement_set_id from public.order_item where order_id = $1`, [
        orderId,
      ]);
      expect(rows[0]!.measurement_set_id).toBeNull();
    });
  });

  it('can be removed, the job keeping its steps', async () => {
    await signedIn(async (c) => {
      const { orderId } = await orderIn(c, 'active');
      const garment = (await c.query(`select id from public.order_item where order_id = $1`, [orderId]))
        .rows[0]!.id;
      await c.query(`insert into public.task (order_id, order_item_id, title) values ($1, $2, 'Sewing')`, [
        orderId,
        garment,
      ]);
      expect((await attempt(c, `delete from public.order_item where order_id = $1`, [orderId])).ok).toBe(
        true,
      );
      const { rows } = await c.query(`select title, order_item_id from public.task where order_id = $1`, [
        orderId,
      ]);
      expect(rows).toEqual([{ title: 'Sewing', order_item_id: null }]);
    });
  });
});

describe('the functions the screens call', () => {
  type Step = {
    title: string;
    on_day?: string | null;
    until_day?: string | null;
    starts_at?: string | null;
    ends_at?: string | null;
  };
  const create = (c: PoolClient, over: Record<string, unknown> = {}) => {
    const a = {
      client: null as string | null,
      name: 'New Client',
      phone: '0911 11 22 33',
      number: null as number | null,
      due: '2030-01-01',
      notes: 'Wedding in January',
      title: 'Bridal gown',
      brief: 'Lace sleeves',
      steps: [
        { title: 'Buy fabric', on_day: '2029-12-01' },
        { title: 'Sewing', on_day: '2029-12-10', until_day: '2029-12-17' },
        { title: 'Fitting', on_day: '2029-12-20', starts_at: '10:30', ends_at: '11:30' },
      ] as Step[] | unknown,
      confirm: false,
      ...over,
    };
    return attempt(
      c,
      `select public.create_job($1, $2, $3, $4, $5, $6::date, $7, $8, $9::jsonb, $10) as id`,
      [
        a.client,
        a.name,
        a.phone,
        a.number,
        a.title,
        a.due,
        a.notes,
        a.brief,
        JSON.stringify(a.steps),
        a.confirm,
      ],
    );
  };
  const steps = async (c: PoolClient) =>
    (
      await c.query(
        `select title, sort, on_day::text, until_day::text, starts_at::text, ends_at::text,
                order_item_id is not null as for_garment
         from public.task order by sort`,
      )
    ).rows;

  it('create a job, its garment, its steps and a new client in one step', async () => {
    await signedIn(async (c) => {
      expect((await create(c)).ok).toBe(true);
      const { rows } = await c.query(
        `select o.number, o.title, o.status, o.notes, c.name, c.phone, i.garment_type, i.brief
         from public.orders o join public.client c on c.id = o.client_id join public.order_item i on i.order_id = o.id`,
      );
      expect(rows).toEqual([
        {
          number: 1,
          title: 'Bridal gown',
          status: 'draft',
          notes: 'Wedding in January',
          name: 'New Client',
          phone: '0911 11 22 33',
          garment_type: 'Bridal gown',
          brief: 'Lace sleeves',
        },
      ]);
      expect(await steps(c)).toEqual([
        {
          title: 'Buy fabric',
          sort: 10,
          on_day: '2029-12-01',
          until_day: null,
          starts_at: null,
          ends_at: null,
          for_garment: true,
        },
        {
          title: 'Sewing',
          sort: 20,
          on_day: '2029-12-10',
          until_day: '2029-12-17',
          starts_at: null,
          ends_at: null,
          for_garment: true,
        },
        {
          title: 'Fitting',
          sort: 30,
          on_day: '2029-12-20',
          until_day: null,
          starts_at: '10:30:00',
          ends_at: '11:30:00',
          for_garment: true,
        },
      ]);
    });
  });

  it('make an appointment with no garment: a job with no title', async () => {
    await signedIn(async (c) => {
      const r = await create(c, {
        title: '',
        brief: '',
        steps: [{ title: 'Appointment', on_day: '2030-01-01', starts_at: '14:00' }],
        confirm: true,
        due: await inDays(c, 3),
      });
      expect(r.ok).toBe(true);
      const { rows } = await c.query(
        `select title, status, (select count(*)::int from public.order_item) as garments from public.orders`,
      );
      expect(rows).toEqual([{ title: '', status: 'active', garments: 0 }]);
      expect((await steps(c)).map((s) => [s.title, s.for_garment])).toEqual([['Appointment', false]]);
    });
  });

  it('make an event for nobody, with no client and no garment', async () => {
    await signedIn(async (c) => {
      const r = await create(c, {
        name: null,
        phone: null,
        title: 'Bazaar at the Hyatt',
        steps: [{ title: 'Make 10 dresses', on_day: '2029-12-15', until_day: '2029-12-28' }],
      });
      expect(r.ok).toBe(true);
      const { rows } = await c.query(
        `select client_id, title, (select count(*)::int from public.client) as clients,
                (select count(*)::int from public.order_item) as garments from public.orders`,
      );
      expect(rows).toEqual([{ client_id: null, title: 'Bazaar at the Hyatt', clients: 0, garments: 0 }]);
      // With no name, an event is refused whole.
      const nameless = await create(c, { name: null, phone: null, title: '' });
      expect(nameless).toMatchObject({ ok: false, code: CHECK });
    });
  });

  it('use an existing client and attach her latest measurements', async () => {
    await signedIn(async (c) => {
      const clientId = await addClient(c);
      await c.query(
        `insert into public.measurement_set (client_id, taken_on, unit, measures) values ($1, '2026-09-01', 'cm', '{"bust": 90}')`,
        [clientId],
      );
      const second = (
        await c.query(
          `insert into public.measurement_set (client_id, taken_on, unit, measures) values ($1, '2026-10-01', 'cm', '{"bust": 91}') returning id`,
          [clientId],
        )
      ).rows[0]!.id;
      expect((await create(c, { client: clientId })).ok).toBe(true);
      const { rows } = await c.query(
        `select measurement_set_id, (select count(*)::int from public.client) as clients from public.order_item`,
      );
      expect(rows).toEqual([{ measurement_set_id: second, clients: 1 }]);
    });
  });

  it('confirm the job at once when asked', async () => {
    await signedIn(async (c) => {
      expect((await create(c, { confirm: true, due: await inDays(c, 20) })).ok).toBe(true);
      const { rows } = await c.query(`select status from public.orders`);
      expect(rows).toEqual([{ status: 'active' }]);
    });
  });

  it.each([
    ['a step with no title', [{ title: '' }]],
    ['a last day before the first', [{ title: 'Sewing', on_day: '2029-12-10', until_day: '2029-12-09' }]],
    ['a time with no day', [{ title: 'Fitting', starts_at: '10:00' }]],
    [
      'an end before the start',
      [{ title: 'Fitting', on_day: '2029-12-10', starts_at: '10:00', ends_at: '09:00' }],
    ],
    ['steps that are not a list', { title: 'Sewing' }],
    ['more than 100 steps', Array.from({ length: 101 }, (_, n) => ({ title: `Step ${n}` }))],
  ])('leave nothing behind when given %s', async (_, given) => {
    await signedIn(async (c) => {
      const r = await create(c, { steps: given });
      expect(r.ok).toBe(false);
      for (const t of ['client', 'orders', 'order_item', 'task']) {
        const { rows } = await c.query(`select count(*)::int as n from public.${t}`);
        expect(rows[0]!.n, t).toBe(0);
      }
    });
  });

  it('leave nothing behind when the confirmation fails', async () => {
    await signedIn(async (c) => {
      const r = await create(c, { confirm: true, due: await inDays(c, -5) });
      expect(r).toMatchObject({ ok: false, code: CHECK });
      const { rows } = await c.query(
        `select (select count(*)::int from public.orders) as orders, (select count(*)::int from public.client) as clients`,
      );
      expect(rows[0]).toEqual({ orders: 0, clients: 0 });
    });
  });

  it('move the due day, and the steps still to do with it when she asks', async () => {
    await signedIn(async (c) => {
      const id = idOf(await create(c));
      await c.query(`update public.task set done_on = $1 where title = 'Buy fabric'`, [await today(c)]);
      const moved = await attempt(c, `select public.move_due_day($1, '2030-01-08', true) as n`, [id]);
      expect(moved).toMatchObject({ ok: true, rows: [{ n: 2 }] });
      expect((await steps(c)).map((s) => [s.title, s.on_day, s.until_day])).toEqual([
        ['Buy fabric', '2029-12-01', null],
        ['Sewing', '2029-12-17', '2029-12-24'],
        ['Fitting', '2029-12-27', null],
      ]);
      const alone = await attempt(c, `select public.move_due_day($1, '2030-01-10', false) as n`, [id]);
      expect(alone).toMatchObject({ ok: true, rows: [{ n: 0 }] });
      const { rows } = await c.query(`select delivery_on::text as d from public.orders`);
      expect(rows[0]!.d).toBe('2030-01-10');
      expect((await steps(c))[2]!.on_day).toBe('2029-12-27');
    });
  });

  it('add a garment made to the latest measurements', async () => {
    await signedIn(async (c) => {
      const clientId = await addClient(c);
      const set = (
        await c.query(
          `insert into public.measurement_set (client_id, taken_on, unit, measures) values ($1, '2026-10-01', 'cm', '{"bust": 91}') returning id`,
          [clientId],
        )
      ).rows[0]!.id;
      const { orderId } = await addOrder(c, clientId);
      const r = await attempt(c, `select public.add_garment($1, 'Veil', 'Short') as id`, [orderId]);
      expect(r.ok).toBe(true);
      const { rows } = await c.query(
        `select garment_type, measurement_set_id from public.order_item where garment_type = 'Veil'`,
      );
      expect(rows).toEqual([{ garment_type: 'Veil', measurement_set_id: set }]);
    });
  });

  it('refuse to add a garment to, or move the day of, a job that is not hers or does not exist', async () => {
    await inTransaction(async (c) => {
      const a = await createUser(c, 'a@example.test');
      const b = await createUser(c, 'b@example.test');
      await actAs(c, a);
      const { orderId } = await addOrder(c);
      await actAs(c, b);
      const nobody = '00000000-0000-0000-0000-000000000000';
      for (const id of [orderId, nobody]) {
        expect(await attempt(c, `select public.add_garment($1, 'Veil', '')`, [id])).toMatchObject({
          ok: false,
          code: 'P0002',
        });
        expect(await attempt(c, `select public.move_due_day($1, '2030-02-01', true)`, [id])).toMatchObject({
          ok: false,
          code: 'P0002',
        });
      }
    });
  });

  it('cannot be called by someone who is not signed in', async () => {
    await inTransaction(async (c) => {
      await c.query(`reset role`);
      await c.query(`set local role anon`);
      for (const call of [
        `select public.create_job(null, 'X', '', null, 'Gown', '2030-01-01', '', '', '[]', false)`,
        `select public.move_due_day('00000000-0000-0000-0000-000000000000', '2030-01-01', true)`,
        `select public.add_garment('00000000-0000-0000-0000-000000000000', 'Veil', '')`,
        `select public.delete_job('00000000-0000-0000-0000-000000000000')`,
      ]) {
        expect(await attempt(c, call)).toMatchObject({ ok: false, code: NO_RIGHT });
      }
    });
  });
});

describe('another designer cannot reach orders', () => {
  async function twoDesigners(c: PoolClient) {
    const a = await createUser(c, 'a@example.test');
    const b = await createUser(c, 'b@example.test');
    await actAs(c, a);
    const o = await addOrder(c);
    const step = (
      await c.query(`insert into public.task (order_id, title) values ($1, 'Buy fabric') returning id`, [
        o.orderId,
      ])
    ).rows[0]!.id;
    return { a, b, ...o, step };
  }

  it.each(['orders', 'order_item', 'task'])('hides %s rows', async (table) => {
    await inTransaction(async (c) => {
      const { b } = await twoDesigners(c);
      await actAs(c, b);
      const { rows } = await c.query(`select count(*)::int as n from public.${table}`);
      expect(rows[0]!.n).toBe(0);
    });
  });

  it('leaves her order alone when someone else tries to change it', async () => {
    await inTransaction(async (c) => {
      const { b, orderId, step } = await twoDesigners(c);
      await actAs(c, b);
      expect(await setStatus(c, orderId, `notes = 'Hacked'`)).toMatchObject({ ok: true, rowCount: 0 });
      expect(
        await attempt(c, `update public.task set done_on = '2026-01-01' where id = $1`, [step]),
      ).toMatchObject({
        ok: true,
        rowCount: 0,
      });
      await actAsOwner(c);
      const { rows } = await c.query(`select o.notes, k.done_on from public.orders o, public.task k`);
      expect(rows).toEqual([{ notes: '', done_on: null }]);
    });
  });

  it("refuses to hang a job, garment or step on someone else's rows, saying nothing about whether they exist", async () => {
    await inTransaction(async (c) => {
      const { b, orderId, clientId } = await twoDesigners(c);
      await actAs(c, b);
      const nobody = '00000000-0000-0000-0000-000000000000';
      const forOrder = (client: string) =>
        attempt(c, `insert into public.orders (client_id, delivery_on) values ($1, '2030-01-01')`, [client]);
      const forGarment = (order: string) =>
        attempt(c, `insert into public.order_item (order_id, garment_type) values ($1, 'Gown')`, [order]);
      const forStep = (order: string) =>
        attempt(c, `insert into public.task (order_id, title) values ($1, 'X')`, [order]);

      for (const [make, real] of [
        [forOrder, clientId],
        [forGarment, orderId],
        [forStep, orderId],
      ] as const) {
        const r1 = await make(real);
        const r2 = await make(nobody);
        if (r1.ok || r2.ok) throw new Error('both should have been refused');
        expect(r1.code).toBe(FOREIGN_KEY);
        expect(r2.code).toBe(FOREIGN_KEY);
        expect(r1.message.replaceAll(real, 'ID')).toBe(r2.message.replaceAll(nobody, 'ID'));
      }
    });
  });

  it('cannot create an order for her client through the function either', async () => {
    await inTransaction(async (c) => {
      const { b, clientId } = await twoDesigners(c);
      await actAs(c, b);
      const r = await attempt(
        c,
        `select public.create_job($1, '', '', null, 'Gown', '2030-01-01', '', '', '[]', false)`,
        [clientId],
      );
      expect(r).toMatchObject({ ok: false, code: FOREIGN_KEY });
    });
  });
});
