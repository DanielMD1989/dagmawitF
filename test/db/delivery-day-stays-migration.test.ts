import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Client } from 'pg';
import { connect, migrate, scratchDatabase, type Scratch } from '../../scripts/drill/database';

// The Delivery stays on her promised day (decision 0101). Before, unfinished steps moving to today took a late order's
// Delivery with them, and its day became the order's. This builds the database before the fix, lets the old rule move
// a paused order's Delivery, and checks that the migration puts it, and the order's day, back; a Delivery she moved
// herself stays where she put it; on an active order it stays, since an active order is never given a passed day.

const BEFORE = '20261111090000';
let scratch: Scratch;
let db: Client;
let her: string;
let moved: string;
let hers: string;
let active: string;

const one = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
  (await db.query(sql, params)).rows[0] as T;
const dayOf = async (order: string) =>
  one<{ order_day: string; step_day: string; moved_from: string | null }>(
    `select o.delivery_on::text as order_day, t.on_day::text as step_day, t.moved_from::text as moved_from
     from public.orders o join public.task t on t.order_id = o.id and t.title = 'Delivery' where o.id = $1`,
    [order],
  );

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
  const order = async (title: string) => {
    const id = (
      await one<{ id: string }>(
        `insert into public.orders (owner_id, client_id, title, delivery_on, status)
         values ($1, $2, $3, current_date + 5, 'draft') returning id`,
        [her, client, title],
      )
    ).id;
    await db.query(`update public.orders set status = 'active' where id = $1`, [id]);
    return id;
  };
  moved = await order('Green complete');
  hers = await order('Suit');
  active = await order('Dress');
  // Due yesterday: time passed (an active order is never given a passed day, so the rules are set aside to write it).
  await db.query(`set session_replication_role = replica`);
  await db.query(`update public.orders set delivery_on = current_date - 1 where id = any($1)`, [
    [moved, active],
  ]);
  await db.query(
    `update public.task set on_day = current_date - 1 where order_id = any($1) and title = 'Delivery'`,
    [[moved, active]],
  );
  await db.query(`set session_replication_role = origin`);
  // The old rule, as the app ran it: her late Delivery moved to today, the order's day with it. Then one was paused.
  await db.query(`set role authenticated`);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: her, role: 'authenticated' }),
  ]);
  await db.query(`select public.carry_over()`);
  await db.query(`update public.orders set status = 'on_hold' where id = $1`, [moved]);
  await db.query(`reset role`);
  // One she moved herself: changing a step clears where it was moved from.
  await db.query(
    `update public.task set on_day = current_date + 3, moved_from = null where order_id = $1 and title = 'Delivery'`,
    [hers],
  );
  await migrate(db, { from: BEFORE, upTo: '20261112090000' });
});

afterAll(async () => {
  await db?.end();
  await scratch?.drop();
});

describe('the delivery day stays migration (decision 0101)', () => {
  it('puts a Delivery moved by the old rule back on its day, and the order’s day with it', async () => {
    const yesterday = (await one<{ d: string }>(`select (current_date - 1)::text as d`)).d;
    expect(await dayOf(moved)).toEqual({ order_day: yesterday, step_day: yesterday, moved_from: null });
  });

  it('leaves an active order’s moved Delivery where it is: its day is never set to one that has passed', async () => {
    const today = (await one<{ d: string }>(`select current_date::text as d`)).d;
    const yesterday = (await one<{ d: string }>(`select (current_date - 1)::text as d`)).d;
    expect(await dayOf(active)).toEqual({ order_day: today, step_day: today, moved_from: yesterday });
  });

  it('leaves a Delivery she moved herself where she put it', async () => {
    const later = (await one<{ d: string }>(`select (current_date + 3)::text as d`)).d;
    expect(await dayOf(hers)).toEqual({ order_day: later, step_day: later, moved_from: null });
  });
});
