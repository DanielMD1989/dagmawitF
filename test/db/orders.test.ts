import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { ORDER_STATUSES, canMove, type OrderStatus } from '../../src/domain/orders/status';
import { BUFFER_CASES, GARMENT_CASES, PREREQUISITE_CASES } from '../fixtures/capture-cases';
import { actAs, actAsOwner, attempt, createUser, inTransaction } from './helpers';

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

  it('will not confirm an order with no garment', async () => {
    await signedIn(async (c) => {
      const client = await addClient(c);
      const { rows } = await c.query(
        `insert into public.orders (client_id, delivery_on) values ($1, $2) returning id`,
        [client, await inDays(c, 30)],
      );
      expect(await setStatus(c, rows[0]!.id, `status = 'active'`)).toMatchObject({ ok: false, code: CHECK });
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
      expect(await setStatus(c, orderId, `buffer_days = 9`)).toMatchObject({ ok: false, code: CHECK });
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
  const addPrerequisite = (c: PoolClient) => async (orderId: string) => {
    await c.query(`insert into public.prerequisite (order_id, kind, label) values ($1, 'material', 'Lace')`, [
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
    'keeps the preparation of a %s order as it is',
    async (status) => {
      await signedIn(async (c) => {
        const { orderId } = await orderIn(c, status, addPrerequisite(c));
        expect(
          await attempt(
            c,
            `insert into public.prerequisite (order_id, kind, label) values ($1, 'approval', 'Design')`,
            [orderId],
          ),
        ).toMatchObject({ ok: false, code: CHECK });
        expect(
          await attempt(c, `update public.prerequisite set state = 'received' where order_id = $1`, [
            orderId,
          ]),
        ).toMatchObject({ ok: false, code: CHECK });
        expect(
          await attempt(c, `delete from public.prerequisite where order_id = $1`, [orderId]),
        ).toMatchObject({
          ok: false,
          code: CHECK,
        });
        const { rows } = await c.query(`select label, state from public.prerequisite where order_id = $1`, [
          orderId,
        ]);
        expect(rows).toEqual([{ label: 'Lace', state: 'needed' }]);
      });
    },
  );

  it('can be changed again once the order is reopened', async () => {
    await signedIn(async (c) => {
      const { orderId } = await orderIn(c, 'delivered', addPrerequisite(c));
      expect(await setStatus(c, orderId, `status = 'active'`)).toMatchObject({ ok: true });
      expect(
        await attempt(c, `update public.order_item set brief = 'Longer' where order_id = $1`, [orderId]),
      ).toMatchObject({
        ok: true,
      });
      expect(
        await attempt(c, `update public.prerequisite set state = 'received' where order_id = $1`, [orderId]),
      ).toMatchObject({ ok: true });
    });
  });

  it('does not stop a whole account with a delivered order from being removed', async () => {
    await inTransaction(async (c) => {
      const id = await createUser(c, 'leaving@example.test');
      await actAs(c, id);
      await orderIn(c, 'delivered', addPrerequisite(c));
      await actAsOwner(c);
      await c.query(`delete from auth.users where id = $1`, [id]);
      for (const t of ['orders', 'order_item', 'prerequisite']) {
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

describe('buffer days', () => {
  it.each(BUFFER_CASES)('agrees with the screen on $days days', async ({ days, valid }) => {
    await signedIn(async (c) => {
      const client = await addClient(c);
      const r = await attempt(
        c,
        `insert into public.orders (client_id, delivery_on, buffer_days) values ($1, '2030-01-01', $2)`,
        [client, days],
      );
      if (valid) expect(r.ok).toBe(true);
      else expect(r).toMatchObject({ ok: false, code: CHECK });
    });
  });

  it('has a default in her profile, within the same limits', async () => {
    await signedIn(async (c) => {
      const { rows } = await c.query(
        `select default_buffer_days as d, measurement_unit as u from public.profile`,
      );
      expect(rows[0]).toEqual({ d: 2, u: 'cm' });
      expect(await attempt(c, `update public.profile set default_buffer_days = 31`)).toMatchObject({
        ok: false,
        code: CHECK,
      });
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

  it('is done for a draft by its own function, taking its garments and preparation with it', async () => {
    await signedIn(async (c) => {
      const { orderId } = await addOrder(c);
      await c.query(
        `insert into public.prerequisite (order_id, kind, label) values ($1, 'material', 'Fabric')`,
        [orderId],
      );
      expect((await attempt(c, `select public.delete_draft_order($1)`, [orderId])).ok).toBe(true);
      for (const t of ['orders', 'order_item', 'prerequisite']) {
        const { rows } = await c.query(`select count(*)::int as n from public.${t}`);
        expect(rows[0]!.n, t).toBe(0);
      }
    });
  });

  it.each(['active', 'on_hold', 'delivered', 'cancelled'] as const)(
    'refuses an order that is %s',
    async (status) => {
      await signedIn(async (c) => {
        const { orderId } = await orderIn(c, status);
        expect(await attempt(c, `select public.delete_draft_order($1)`, [orderId])).toMatchObject({
          ok: false,
          code: CHECK,
        });
        const { rows } = await c.query(`select count(*)::int as n from public.orders`);
        expect(rows[0]!.n).toBe(1);
      });
    },
  );

  it("cannot be used on someone else's draft", async () => {
    await inTransaction(async (c) => {
      const a = await createUser(c, 'a@example.test');
      const b = await createUser(c, 'b@example.test');
      await actAs(c, a);
      const { orderId } = await addOrder(c);
      await actAs(c, b);
      expect(await attempt(c, `select public.delete_draft_order($1)`, [orderId])).toMatchObject({
        ok: false,
        code: CHECK,
      });
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
      await c.query(`select public.delete_draft_order($1)`, [orderId]);
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

  describe('a confirmed order always has one', () => {
    it('refuses to remove the last garment of an active order', async () => {
      await signedIn(async (c) => {
        const { orderId } = await orderIn(c, 'active');
        await c.query(`delete from public.order_item where order_id = $1`, [orderId]);
        expect(await attempt(c, `set constraints all immediate`)).toMatchObject({ ok: false, code: CHECK });
      });
    });

    it('refuses the same for an order on hold', async () => {
      await signedIn(async (c) => {
        const { orderId } = await orderIn(c, 'on_hold');
        await c.query(`delete from public.order_item where order_id = $1`, [orderId]);
        expect(await attempt(c, `set constraints all immediate`)).toMatchObject({ ok: false, code: CHECK });
      });
    });

    it('allows removing one of two, or swapping one for another in the same step', async () => {
      await signedIn(async (c) => {
        const { orderId } = await orderIn(c, 'active');
        await c.query(`insert into public.order_item (order_id, garment_type) values ($1, 'Veil')`, [
          orderId,
        ]);
        await c.query(`delete from public.order_item where order_id = $1 and garment_type = 'Veil'`, [
          orderId,
        ]);
        expect((await attempt(c, `set constraints all immediate`)).ok).toBe(true);

        // Back to waiting until the end of the transaction, as it does for every request.
        await c.query(`set constraints all deferred`);
        await c.query(`delete from public.order_item where order_id = $1`, [orderId]);
        await c.query(`insert into public.order_item (order_id, garment_type) values ($1, 'Evening dress')`, [
          orderId,
        ]);
        expect((await attempt(c, `set constraints all immediate`)).ok).toBe(true);
      });
    });

    it('does not apply to a draft', async () => {
      await signedIn(async (c) => {
        const { orderId } = await orderIn(c, 'draft');
        await c.query(`delete from public.order_item where order_id = $1`, [orderId]);
        expect((await attempt(c, `set constraints all immediate`)).ok).toBe(true);
      });
    });

    it('does not stop a whole account from being removed', async () => {
      await inTransaction(async (c) => {
        const id = await createUser(c, 'leaving@example.test');
        await actAs(c, id);
        await orderIn(c, 'active');
        await actAsOwner(c);
        await c.query(`delete from auth.users where id = $1`, [id]);
        expect((await attempt(c, `set constraints all immediate`)).ok).toBe(true);
        const { rows } = await c.query(`select count(*)::int as n from public.orders`);
        expect(rows[0]!.n).toBe(0);
      });
    });
  });
});

describe('prerequisite', () => {
  it.each(PREREQUISITE_CASES)('agrees with the screen on $label', async ({ prerequisite: p, valid }) => {
    await signedIn(async (c) => {
      const { orderId } = await addOrder(c);
      const r = await attempt(
        c,
        `insert into public.prerequisite (order_id, kind, label, state, expected_on, blocking, note)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [orderId, p.kind, p.label, p.state, p.expectedOn, p.blocking, p.note],
      );
      if (valid) expect(r.ok).toBe(true);
      else expect(r).toMatchObject({ ok: false, code: CHECK });
    });
  });

  it('refuses a kind or a state it does not know', async () => {
    await signedIn(async (c) => {
      const { orderId } = await addOrder(c);
      const insert = (kind: string, state: string) =>
        attempt(
          c,
          `insert into public.prerequisite (order_id, kind, label, state) values ($1, $2, 'X', $3)`,
          [orderId, kind, state],
        );
      expect(await insert('fabric', 'needed')).toMatchObject({ ok: false, code: CHECK });
      expect(await insert('material', 'arrived')).toMatchObject({ ok: false, code: CHECK });
    });
  });

  it('is blocking and needed unless she says otherwise', async () => {
    await signedIn(async (c) => {
      const { orderId } = await addOrder(c);
      const { rows } = await c.query(
        `insert into public.prerequisite (order_id, kind, label) values ($1, 'material', 'Fabric') returning state, blocking, expected_on`,
        [orderId],
      );
      expect(rows[0]).toEqual({ state: 'needed', blocking: true, expected_on: null });
    });
  });

  it('can change state and date, but never move to another order', async () => {
    await signedIn(async (c) => {
      const one = await addOrder(c);
      const two = await addOrder(c);
      const id = (
        await c.query(
          `insert into public.prerequisite (order_id, kind, label) values ($1, 'material', 'Lace') returning id`,
          [one.orderId],
        )
      ).rows[0]!.id;
      expect(
        (
          await attempt(
            c,
            `update public.prerequisite set state = 'ordered', expected_on = '2026-11-04' where id = $1`,
            [id],
          )
        ).ok,
      ).toBe(true);
      expect(
        await attempt(c, `update public.prerequisite set order_id = $2 where id = $1`, [id, two.orderId]),
      ).toMatchObject({
        ok: false,
        code: NO_RIGHT,
      });
    });
  });
});

describe('the functions the screens call', () => {
  const create = (c: PoolClient, over: Record<string, unknown> = {}) => {
    const a = {
      client: null as string | null,
      name: 'New Client',
      phone: '0911 11 22 33',
      number: null as number | null,
      delivery: '2030-01-01',
      buffer: 3,
      notes: 'Wedding in January',
      garment: 'Bridal gown',
      brief: 'Lace sleeves',
      confirm: false,
      ...over,
    };
    return attempt(c, `select public.create_order($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10) as id`, [
      a.client,
      a.name,
      a.phone,
      a.number,
      a.delivery,
      a.buffer,
      a.notes,
      a.garment,
      a.brief,
      a.confirm,
    ]);
  };

  it('create an order, its first garment and a new client in one step', async () => {
    await signedIn(async (c) => {
      const r = await create(c);
      expect(r.ok).toBe(true);
      const { rows } = await c.query(
        `select o.number, o.status, o.buffer_days, o.notes, c.name, c.phone, i.garment_type, i.brief
         from public.orders o join public.client c on c.id = o.client_id join public.order_item i on i.order_id = o.id`,
      );
      expect(rows).toEqual([
        {
          number: 1,
          status: 'draft',
          buffer_days: 3,
          notes: 'Wedding in January',
          name: 'New Client',
          phone: '0911 11 22 33',
          garment_type: 'Bridal gown',
          brief: 'Lace sleeves',
        },
      ]);
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
      const r = await create(c, { client: clientId });
      expect(r.ok).toBe(true);
      const { rows } = await c.query(
        `select measurement_set_id, (select count(*)::int from public.client) as clients from public.order_item`,
      );
      expect(rows).toEqual([{ measurement_set_id: second, clients: 1 }]);
    });
  });

  it('confirm the order at once when asked', async () => {
    await signedIn(async (c) => {
      const r = await create(c, { confirm: true, delivery: await inDays(c, 20) });
      expect(r.ok).toBe(true);
      const { rows } = await c.query(`select status from public.orders`);
      expect(rows).toEqual([{ status: 'active' }]);
    });
  });

  it('use her default buffer when none is given', async () => {
    await signedIn(async (c) => {
      await c.query(`update public.profile set default_buffer_days = 4`);
      await create(c, { buffer: null });
      const { rows } = await c.query(`select buffer_days from public.orders`);
      expect(rows).toEqual([{ buffer_days: 4 }]);
    });
  });

  it('leave nothing behind when a later step fails', async () => {
    await signedIn(async (c) => {
      const r = await create(c, { garment: '' });
      expect(r).toMatchObject({ ok: false, code: CHECK });
      for (const t of ['client', 'orders', 'order_item']) {
        const { rows } = await c.query(`select count(*)::int as n from public.${t}`);
        expect(rows[0]!.n, t).toBe(0);
      }
    });
  });

  it('leave nothing behind when the confirmation fails', async () => {
    await signedIn(async (c) => {
      const r = await create(c, { confirm: true, delivery: await inDays(c, -5) });
      expect(r).toMatchObject({ ok: false, code: CHECK });
      const { rows } = await c.query(
        `select (select count(*)::int from public.orders) as orders, (select count(*)::int from public.client) as clients`,
      );
      expect(rows[0]).toEqual({ orders: 0, clients: 0 });
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

  it('refuse to add a garment to an order that is not hers or does not exist', async () => {
    await inTransaction(async (c) => {
      const a = await createUser(c, 'a@example.test');
      const b = await createUser(c, 'b@example.test');
      await actAs(c, a);
      const { orderId } = await addOrder(c);
      await actAs(c, b);
      const theirs = await attempt(c, `select public.add_garment($1, 'Veil', '')`, [orderId]);
      const nothing = await attempt(
        c,
        `select public.add_garment('00000000-0000-0000-0000-000000000000', 'Veil', '')`,
      );
      expect(theirs).toMatchObject({ ok: false, code: 'P0002' });
      expect(nothing).toMatchObject({ ok: false, code: 'P0002' });
    });
  });

  it('cannot be called by someone who is not signed in', async () => {
    await inTransaction(async (c) => {
      await c.query(`reset role`);
      await c.query(`set local role anon`);
      for (const call of [
        `select public.create_order(null, 'X', '', null, '2030-01-01', 2, '', 'Gown', '', false)`,
        `select public.add_garment('00000000-0000-0000-0000-000000000000', 'Veil', '')`,
        `select public.delete_draft_order('00000000-0000-0000-0000-000000000000')`,
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
    const prereq = (
      await c.query(
        `insert into public.prerequisite (order_id, kind, label) values ($1, 'material', 'Fabric') returning id`,
        [o.orderId],
      )
    ).rows[0]!.id;
    return { a, b, ...o, prereq };
  }

  it.each(['orders', 'order_item', 'prerequisite'])('hides %s rows', async (table) => {
    await inTransaction(async (c) => {
      const { b } = await twoDesigners(c);
      await actAs(c, b);
      const { rows } = await c.query(`select count(*)::int as n from public.${table}`);
      expect(rows[0]!.n).toBe(0);
    });
  });

  it('leaves her order alone when someone else tries to change it', async () => {
    await inTransaction(async (c) => {
      const { b, orderId, prereq } = await twoDesigners(c);
      await actAs(c, b);
      expect(await setStatus(c, orderId, `notes = 'Hacked'`)).toMatchObject({ ok: true, rowCount: 0 });
      expect(
        await attempt(c, `update public.prerequisite set state = 'received' where id = $1`, [prereq]),
      ).toMatchObject({
        ok: true,
        rowCount: 0,
      });
      await actAsOwner(c);
      const { rows } = await c.query(`select o.notes, p.state from public.orders o, public.prerequisite p`);
      expect(rows).toEqual([{ notes: '', state: 'needed' }]);
    });
  });

  it("refuses to hang an order, garment or preparation on someone else's rows, saying nothing about whether they exist", async () => {
    await inTransaction(async (c) => {
      const { b, orderId, clientId } = await twoDesigners(c);
      await actAs(c, b);
      const nobody = '00000000-0000-0000-0000-000000000000';
      const forOrder = (client: string) =>
        attempt(c, `insert into public.orders (client_id, delivery_on) values ($1, '2030-01-01')`, [client]);
      const forGarment = (order: string) =>
        attempt(c, `insert into public.order_item (order_id, garment_type) values ($1, 'Gown')`, [order]);
      const forPrereq = (order: string) =>
        attempt(c, `insert into public.prerequisite (order_id, kind, label) values ($1, 'other', 'X')`, [
          order,
        ]);

      for (const [make, real] of [
        [forOrder, clientId],
        [forGarment, orderId],
        [forPrereq, orderId],
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
        `select public.create_order($1, '', '', null, '2030-01-01', 2, '', 'Gown', '', false)`,
        [clientId],
      );
      expect(r).toMatchObject({ ok: false, code: FOREIGN_KEY });
    });
  });
});
