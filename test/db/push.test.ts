import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { actAs, attempt, createUser, inTransaction } from './helpers';

// Phone notifications (decision 0083): a phone's subscription, where news goes, and what is news.

const all = async (c: PoolClient, sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows;

async function workspace(c: PoolClient) {
  const her = await createUser(c, 'dagmawit@example.test', 'Dagmawit');
  const helper = await createUser(c, 'hanna@example.test', 'Hanna');
  const stranger = await createUser(c, 'stranger@example.test', 'Someone');
  await actAs(c, her);
  await c.query(`select public.add_member('hanna@example.test')`);
  return { her, helper, stranger };
}

const subscribe = (c: PoolClient, endpoint: string) =>
  c.query(`select public.save_push_subscription($1, 'key', 'secret')`, [endpoint]);

describe('phone notifications', () => {
  it('go to the other people of the workspace, never to oneself or to strangers', async () => {
    await inTransaction(async (c) => {
      const { her, helper, stranger } = await workspace(c);
      await subscribe(c, 'https://push.example/her');
      await actAs(c, helper);
      await subscribe(c, 'https://push.example/hanna');
      await actAs(c, stranger);
      await subscribe(c, 'https://push.example/stranger');

      await actAs(c, helper);
      expect(await all(c, `select endpoint from public.workspace_push_targets()`)).toEqual([
        { endpoint: 'https://push.example/her' },
      ]);
      await actAs(c, her);
      expect(await all(c, `select endpoint from public.workspace_push_targets()`)).toEqual([
        { endpoint: 'https://push.example/hanna' },
      ]);
      await actAs(c, stranger);
      expect(await all(c, `select endpoint from public.workspace_push_targets()`)).toEqual([]);
    });
  });

  it('are her news only once: what she changed in the last minutes, then nothing until she changes more', async () => {
    await inTransaction(async (c) => {
      const { helper } = await workspace(c);
      const client = (await all(c, `insert into public.client (name) values ('Megan') returning id`))[0]!.id;
      await actAs(c, helper);
      await c.query(
        `insert into public.orders (client_id, title, delivery_on) values ($1, 'Bridal gown', current_date + 30)`,
        [client],
      );
      expect((await all(c, `select action from public.claim_my_news()`)).map((r) => r.action)).toEqual([
        'order_created',
      ]);
      expect(await all(c, `select action from public.claim_my_news()`)).toEqual([]);
      await c.query(`update public.orders set delivery_on = current_date + 31`);
      expect((await all(c, `select action from public.claim_my_news()`)).map((r) => r.action)).toEqual([
        'delivery_changed',
      ]);
    });
  });

  it('are turned off by the phone, or dropped by the workspace when the phone is gone', async () => {
    await inTransaction(async (c) => {
      const { helper, stranger } = await workspace(c);
      await subscribe(c, 'https://push.example/her');
      expect(await all(c, `select public.has_push_subscription('https://push.example/her') as on`)).toEqual([
        { on: true },
      ]);
      // A stranger cannot drop her phone; someone of her workspace can (the push service said it is gone).
      await actAs(c, stranger);
      await c.query(`select public.drop_push_subscription('https://push.example/her')`);
      await actAs(c, helper);
      expect(await all(c, `select endpoint from public.workspace_push_targets()`)).toHaveLength(1);
      await c.query(`select public.drop_push_subscription('https://push.example/her')`);
      expect(await all(c, `select endpoint from public.workspace_push_targets()`)).toEqual([]);
    });
  });

  it('refuse an address that is not a push service’s', async () => {
    await inTransaction(async (c) => {
      await workspace(c);
      expect(
        await attempt(c, `select public.save_push_subscription('http://insecure.example', 'k', 's')`),
      ).toMatchObject({ ok: false, code: '23514' });
    });
  });
});
