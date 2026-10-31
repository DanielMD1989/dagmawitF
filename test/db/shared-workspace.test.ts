import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { actAs, attempt, createUser, inTransaction } from './helpers';

// A shared workspace (decision 0081): a member works in her workspace with her rights; strangers see nothing.

const one = async <T = Record<string, unknown>>(c: PoolClient, sql: string, params: unknown[] = []) =>
  (await c.query(sql, params)).rows[0] as T;
const all = async (c: PoolClient, sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows;

/** Her (the owner), a second account she adds, and a stranger. */
async function people(c: PoolClient) {
  const her = await createUser(c, 'dagmawit@example.test', 'Dagmawit');
  const helper = await createUser(c, 'Hanna@Example.test', 'Hanna');
  const stranger = await createUser(c, 'stranger@example.test', 'Someone');
  return { her, helper, stranger };
}

async function herJob(c: PoolClient) {
  const client = (await one<{ id: string }>(c, `insert into public.client (name) values ('Megan') returning id`)).id;
  const order = (
    await one<{ id: string }>(
      c,
      `insert into public.orders (client_id, title, delivery_on) values ($1, 'Bridal gown', current_date + 30) returning id`,
      [client],
    )
  ).id;
  await c.query(`update public.orders set status = 'active' where id = $1`, [order]);
  return { client, order };
}

describe('a shared workspace', () => {
  it('lets the account she adds see and change her clients, jobs and steps, and her see what it adds', async () => {
    await inTransaction(async (c) => {
      const { her, helper } = await people(c);
      await actAs(c, her);
      const { order } = await herJob(c);
      // Added by email, in any capitals.
      expect(await one(c, `select public.add_member('hanna@example.test') as id`)).toEqual({ id: helper });

      await actAs(c, helper);
      expect(await all(c, `select title from public.orders`)).toEqual([{ title: 'Bridal gown' }]);
      await c.query(`insert into public.task (order_id, title, on_day) values ($1, 'Cutting', current_date)`, [order]);
      await c.query(`update public.orders set delivery_on = current_date + 31 where id = $1`, [order]);

      await actAs(c, her);
      // What the helper added is hers: in her workspace.
      expect(await one(c, `select owner_id from public.task where title = 'Cutting'`)).toEqual({ owner_id: her });
      expect(await all(c, `select title from public.task`)).toEqual([{ title: 'Cutting' }]);
    });
  });

  it('keeps who made each change on the job’s history', async () => {
    await inTransaction(async (c) => {
      const { her, helper } = await people(c);
      await actAs(c, her);
      const { order } = await herJob(c);
      await c.query(`select public.add_member('hanna@example.test')`);
      await actAs(c, helper);
      await c.query(`update public.orders set delivery_on = current_date + 40 where id = $1`, [order]);
      const lines = await all(
        c,
        `select action, actor_id from public.activity_log where order_id = $1 order by seq`,
        [order],
      );
      expect(lines.at(0)).toMatchObject({ action: 'order_created', actor_id: her });
      expect(lines.at(-1)).toMatchObject({ action: 'delivery_changed', actor_id: helper });
    });
  });

  it('shows nothing of hers to anyone else', async () => {
    await inTransaction(async (c) => {
      const { her, stranger } = await people(c);
      await actAs(c, her);
      const { order } = await herJob(c);
      await c.query(`select public.add_member('hanna@example.test')`);
      await actAs(c, stranger);
      expect(await all(c, `select id from public.orders`)).toEqual([]);
      expect(await all(c, `select id from public.client`)).toEqual([]);
      expect(await attempt(c, `update public.orders set notes = 'x' where id = $1`, [order])).toMatchObject({
        ok: true,
        rowCount: 0,
      });
      expect(await all(c, `select name from public.profile where owner_id = $1`, [her])).toEqual([]);
    });
  });

  it('lists its people with their names; each may read, not change, the other’s profile', async () => {
    await inTransaction(async (c) => {
      const { her, helper } = await people(c);
      await actAs(c, her);
      await c.query(`select public.add_member('hanna@example.test')`);
      const listed = await all(c, `select name, email, is_owner, is_me from public.workspace_people()`);
      expect(listed).toEqual([
        { name: 'Dagmawit', email: 'dagmawit@example.test', is_owner: true, is_me: true },
        { name: 'Hanna', email: 'Hanna@Example.test', is_owner: false, is_me: false },
      ]);
      await actAs(c, helper);
      expect(await one(c, `select name from public.profile where owner_id = $1`, [her])).toEqual({
        name: 'Dagmawit',
      });
      expect(
        await attempt(c, `update public.profile set name = 'X' where owner_id = $1`, [her]),
      ).toMatchObject({ ok: true, rowCount: 0 });
    });
  });

  it('is added to only by its owner, once, and not to oneself or to an unknown email', async () => {
    await inTransaction(async (c) => {
      const { her, helper, stranger } = await people(c);
      await actAs(c, her);
      expect(await attempt(c, `select public.add_member('nobody@example.test')`)).toMatchObject({
        ok: false,
        code: 'P0002',
      });
      expect(await attempt(c, `select public.add_member('dagmawit@example.test')`)).toMatchObject({
        ok: false,
        code: '22023',
      });
      await c.query(`select public.add_member('hanna@example.test')`);
      expect(await attempt(c, `select public.add_member('hanna@example.test')`)).toMatchObject({
        ok: false,
        code: '23505',
      });
      await actAs(c, helper);
      expect(await attempt(c, `select public.add_member('stranger@example.test')`)).toMatchObject({
        ok: false,
        code: '42501',
      });
      // Someone who has people of their own cannot join another workspace.
      await actAs(c, stranger);
      expect(await attempt(c, `select public.add_member('dagmawit@example.test')`)).toMatchObject({
        ok: false,
        code: '22023',
      });
    });
  });

  it('ends when she removes the account: it sees only its own again', async () => {
    await inTransaction(async (c) => {
      const { her, helper } = await people(c);
      await actAs(c, her);
      await herJob(c);
      await c.query(`select public.add_member('hanna@example.test')`);
      await c.query(`select public.remove_member($1)`, [helper]);
      await actAs(c, helper);
      expect(await all(c, `select id from public.orders`)).toEqual([]);
      expect(await one(c, `select public.my_workspace() as w`)).toEqual({ w: helper });
    });
  });

  it('is downloaded whole by its owner only', async () => {
    await inTransaction(async (c) => {
      const { her, helper } = await people(c);
      await actAs(c, her);
      await herJob(c);
      await c.query(`select public.add_member('hanna@example.test')`);
      const file = await one<{ f: { owner_id: string; tables: Record<string, unknown[]> } }>(
        c,
        `select public.export_my_data() as f`,
      );
      expect(file.f.owner_id).toBe(her);
      expect(file.f.tables.orders).toHaveLength(1);
      await actAs(c, helper);
      expect(await attempt(c, `select public.export_my_data()`)).toMatchObject({ ok: false, code: '42501' });
    });
  });

  it('moves her unfinished steps to today for either of them', async () => {
    await inTransaction(async (c) => {
      const { her, helper } = await people(c);
      await actAs(c, her);
      const { order } = await herJob(c);
      await c.query(
        `insert into public.task (order_id, title, on_day) values ($1, 'Cutting', app.today_for($2) - 1)`,
        [order, her],
      );
      await c.query(`select public.add_member('hanna@example.test')`);
      await actAs(c, helper);
      expect(await one(c, `select public.carry_over() as n`)).toEqual({ n: 1 });
    });
  });
});
