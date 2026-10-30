import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { HISTORY_ACTIONS } from '../../src/domain/orders/history';
import { actAs, actAsAnon, actAsOwner, attempt, createUser, inTransaction } from './helpers';

const CHECK = '23514';
const FOREIGN_KEY = '23503';
const NO_RIGHT = '42501';

async function signedIn<T>(fn: (c: PoolClient, userId: string) => Promise<T>) {
  return inTransaction(async (c) => {
    const id = await createUser(c, 'a@example.test');
    await actAs(c, id);
    return fn(c, id);
  });
}

async function inDays(c: PoolClient, n: number): Promise<string> {
  const { rows } = await c.query<{ d: string }>(
    `select to_char(app.today_for((select auth.uid())) + $1::int, 'YYYY-MM-DD') as d`,
    [n],
  );
  return rows[0]!.d;
}

async function addClient(c: PoolClient, name = 'Selam Tesfaye'): Promise<string> {
  return (await c.query<{ id: string }>(`insert into public.client (name) values ($1) returning id`, [name]))
    .rows[0]!.id;
}

async function addOrder(c: PoolClient, clientId?: string, number: number | null = null) {
  const client = clientId ?? (await addClient(c));
  const { rows } = await c.query<{ id: string }>(
    `insert into public.orders (client_id, delivery_on, number) values ($1, $2, $3) returning id`,
    [client, await inDays(c, 30), number],
  );
  await c.query(`insert into public.order_item (order_id, garment_type) values ($1, 'Bridal gown')`, [
    rows[0]!.id,
  ]);
  return { orderId: rows[0]!.id, clientId: client };
}

/** What the history of one order says, oldest first, without the clock. */
async function history(c: PoolClient, orderId: string) {
  const { rows } = await c.query<{ action: string; details: Record<string, unknown> }>(
    `select action, details from public.activity_log where order_id = $1 order by seq`,
    [orderId],
  );
  return rows;
}

describe('history', () => {
  it('uses the same list of events as the screen', async () => {
    await signedIn(async (c) => {
      const { rows } = await c.query<{ a: string[] }>(`select app.history_actions() as a`);
      expect(rows[0]!.a).toEqual([...HISTORY_ACTIONS]);
    });
  });

  it('records an order from its first moment: made, given a garment, confirmed', async () => {
    await signedIn(async (c) => {
      const delivery = await inDays(c, 20);
      const { rows } = await c.query<{ id: string }>(
        `select public.create_job(null, 'Hana', '', 105, 'Evening dress', $1::date, '', '', '[]', true) as id`,
        [delivery],
      );
      expect(await history(c, rows[0]!.id)).toEqual([
        { action: 'order_created', details: { number: 105, delivery_on: delivery } },
        { action: 'garment_added', details: { garment_type: 'Evening dress' } },
        { action: 'status_changed', details: { from: 'draft', to: 'active' } },
      ]);
    });
  });

  it('records every change to the promise, with what it was and what it became', async () => {
    await signedIn(async (c) => {
      const { orderId } = await addOrder(c);
      const before = (await history(c, orderId)).length;
      const newDay = await inDays(c, 40);
      const old = (
        await c.query(`select to_char(delivery_on, 'YYYY-MM-DD') as d from public.orders where id = $1`, [
          orderId,
        ])
      ).rows[0]!.d;

      await c.query(`update public.orders set delivery_on = $2 where id = $1`, [orderId, newDay]);
      await c.query(`update public.orders set status = 'active' where id = $1`, [orderId]);
      await c.query(
        `update public.orders set status = 'on_hold', hold_reason = 'Client abroad' where id = $1`,
        [orderId],
      );
      await c.query(`update public.orders set status = 'active' where id = $1`, [orderId]);
      await c.query(`update public.orders set status = 'delivered', delivered_on = $2 where id = $1`, [
        orderId,
        await inDays(c, 0),
      ]);
      await c.query(`update public.orders set status = 'active' where id = $1`, [orderId]);
      await c.query(
        `update public.orders set status = 'cancelled', cancel_reason = 'Changed her mind' where id = $1`,
        [orderId],
      );

      const events = (await history(c, orderId)).slice(before);
      expect(events).toEqual([
        { action: 'delivery_changed', details: { from: old, to: newDay } },
        { action: 'status_changed', details: { from: 'draft', to: 'active' } },
        { action: 'status_changed', details: { from: 'active', to: 'on_hold', reason: 'Client abroad' } },
        { action: 'status_changed', details: { from: 'on_hold', to: 'active' } },
        {
          action: 'status_changed',
          details: { from: 'active', to: 'delivered', delivered_on: await inDays(c, 0) },
        },
        { action: 'status_changed', details: { from: 'delivered', to: 'active' } },
        {
          action: 'status_changed',
          details: { from: 'active', to: 'cancelled', reason: 'Changed her mind' },
        },
      ]);
    });
  });

  it('says nothing when an edit changes nothing the history is about', async () => {
    await signedIn(async (c) => {
      const { orderId } = await addOrder(c);
      const before = (await history(c, orderId)).length;
      await c.query(`update public.orders set notes = 'Client likes ivory' where id = $1`, [orderId]);
      await c.query(`update public.orders set title = title, delivery_on = delivery_on where id = $1`, [
        orderId,
      ]);
      expect((await history(c, orderId)).length).toBe(before);
    });
  });

  it('records a change of client by name, so it still reads if a client is deleted later', async () => {
    await signedIn(async (c) => {
      const { orderId } = await addOrder(c, await addClient(c, 'Hana'));
      const other = await addClient(c, 'Mimi');
      await c.query(`update public.orders set client_id = $2 where id = $1`, [orderId, other]);
      await c.query(`delete from public.client where name = 'Hana'`);
      const events = await history(c, orderId);
      expect(events.at(-1)).toEqual({ action: 'client_changed', details: { from: 'Hana', to: 'Mimi' } });
    });
  });

  it('records garments: added, changed, measured to a version, removed', async () => {
    await signedIn(async (c) => {
      const { orderId, clientId } = await addOrder(c);
      const before = (await history(c, orderId)).length;
      await c.query(
        `insert into public.measurement_set (client_id, taken_on, unit, measures) values ($1, '2026-10-01', 'cm', '{"bust": 90}')`,
        [clientId],
      );
      await c.query(
        `insert into public.measurement_set (client_id, taken_on, unit, measures) values ($1, '2026-10-20', 'cm', '{"bust": 91}')`,
        [clientId],
      );
      const veil = (await c.query(`select public.add_garment($1, 'Veil', 'Short') as id`, [orderId])).rows[0]!
        .id;
      await c.query(`update public.order_item set brief = 'Cathedral length' where id = $1`, [veil]);
      await c.query(`update public.order_item set garment_type = 'Long veil' where id = $1`, [veil]);
      const set1 = (await c.query(`select id from public.measurement_set where version = 1`)).rows[0]!.id;
      await c.query(`update public.order_item set measurement_set_id = $2 where id = $1`, [veil, set1]);
      await c.query(`delete from public.order_item where id = $1`, [veil]);

      expect((await history(c, orderId)).slice(before)).toEqual([
        { action: 'garment_added', details: { garment_type: 'Veil' } },
        { action: 'garment_changed', details: { garment_type: 'Veil', was: 'Veil' } },
        { action: 'garment_changed', details: { garment_type: 'Long veil', was: 'Veil' } },
        { action: 'garment_measurements', details: { garment_type: 'Long veil', from: 2, to: 1 } },
        { action: 'garment_removed', details: { garment_type: 'Long veil' } },
      ]);
    });
  });

  it('records new measurements against the client, not an order', async () => {
    await signedIn(async (c) => {
      const clientId = await addClient(c);
      await c.query(
        `insert into public.measurement_set (client_id, taken_on, unit, measures) values ($1, '2026-10-01', 'cm', '{"bust": 90}')`,
        [clientId],
      );
      const { rows } = await c.query(
        `select order_id, client_id, action, details from public.activity_log where client_id = $1`,
        [clientId],
      );
      expect(rows).toEqual([
        {
          order_id: null,
          client_id: clientId,
          action: 'measurements_recorded',
          details: { version: 1, taken_on: '2026-10-01' },
        },
      ]);
    });
  });

  it('can be read newest first by the screen, by the order it happened in', async () => {
    await signedIn(async (c) => {
      const { orderId } = await addOrder(c);
      for (let i = 0; i < 5; i++) {
        await c.query(`select public.add_garment($1, $2, '')`, [orderId, `Item ${i}`]);
      }
      const { rows } = await c.query(
        `select details ->> 'garment_type' as garment from public.activity_log
         where order_id = $1 and action = 'garment_added' and details ->> 'garment_type' like 'Item %' order by seq desc`,
        [orderId],
      );
      expect(rows.map((r) => r.garment)).toEqual(['Item 4', 'Item 3', 'Item 2', 'Item 1', 'Item 0']);
    });
  });

  describe('is a record nobody can rewrite', () => {
    it.each([
      [`insert into public.activity_log (order_id, action) values ($1, 'order_created')`],
      [`update public.activity_log set action = 'order_created' where order_id = $1`],
      [`delete from public.activity_log where order_id = $1`],
    ])('refuses: %s', async (sql) => {
      await signedIn(async (c) => {
        const { orderId } = await addOrder(c);
        expect(await attempt(c, sql, [orderId])).toMatchObject({ ok: false, code: NO_RIGHT });
      });
    });

    it('cannot be reached through the logging function either', async () => {
      await signedIn(async (c, id) => {
        const { orderId } = await addOrder(c);
        expect(
          await attempt(c, `select app.log_event($1, $2, null, 'order_created', '{}')`, [id, orderId]),
        ).toMatchObject({ ok: false, code: NO_RIGHT });
      });
    });

    it('accepts only known events, about exactly one thing', async () => {
      await inTransaction(async (c) => {
        const id = await createUser(c, 'a@example.test');
        await actAs(c, id);
        const { orderId, clientId } = await addOrder(c);
        await actAsOwner(c);
        const log = (order: string | null, client: string | null, action: string, details = '{}') =>
          attempt(c, `select app.log_event($1, $2, $3, $4, $5::jsonb)`, [id, order, client, action, details]);
        expect((await log(orderId, null, 'file_added')).ok).toBe(true);
        expect(await log(orderId, null, 'something_else')).toMatchObject({ ok: false, code: CHECK });
        expect(await log(null, null, 'file_added')).toMatchObject({ ok: false, code: CHECK });
        expect(await log(orderId, clientId, 'file_added')).toMatchObject({ ok: false, code: CHECK });
        expect(await log(orderId, null, 'file_added', '[1]')).toMatchObject({ ok: false, code: CHECK });
      });
    });
  });

  it('is hidden from another designer', async () => {
    await inTransaction(async (c) => {
      const a = await createUser(c, 'a@example.test');
      const b = await createUser(c, 'b@example.test');
      await actAs(c, a);
      await addOrder(c);
      await actAs(c, b);
      const { rows } = await c.query(`select count(*)::int as n from public.activity_log`);
      expect(rows[0]!.n).toBe(0);
    });
  });

  it('goes with a draft that is deleted, without any trouble from the removals that follow', async () => {
    await signedIn(async (c) => {
      const { orderId } = await addOrder(c);
      await c.query(`insert into public.task (order_id, title) values ($1, 'Buy fabric')`, [orderId]);
      await insertAttachment(c, orderId, { id: randomUUID() });
      expect((await attempt(c, `select public.delete_job($1)`, [orderId])).ok).toBe(true);
      const { rows } = await c.query(
        `select count(*)::int as n from public.activity_log where order_id = $1`,
        [orderId],
      );
      expect(rows[0]!.n).toBe(0);
    });
  });

  it('does not stop a whole account from being removed', async () => {
    await inTransaction(async (c) => {
      const id = await createUser(c, 'leaving@example.test');
      await actAs(c, id);
      const { orderId } = await addOrder(c);
      await c.query(`insert into public.task (order_id, title) values ($1, 'Buy fabric')`, [orderId]);
      await insertAttachment(c, orderId, { id: randomUUID() });
      await actAsOwner(c);
      await c.query(`delete from auth.users where id = $1`, [id]);
      for (const t of ['orders', 'order_item', 'task', 'attachment', 'activity_log', 'client']) {
        const { rows } = await c.query(`select count(*)::int as n from public.${t}`);
        expect(rows[0]!.n, t).toBe(0);
      }
    });
  });
});

/** Inserts an attachment whose path follows the rule, unless a test says otherwise. */
async function insertAttachment(
  c: PoolClient,
  orderId: string,
  over: { id?: string; kind?: string; path?: string; type?: string; size?: number; caption?: string } = {},
) {
  const id = over.id ?? randomUUID();
  const owner = (await c.query(`select (select auth.uid()) as id`)).rows[0]!.id as string;
  const path = over.path ?? `${owner}/${orderId}/${id}.jpg`;
  return attempt(
    c,
    `insert into public.attachment (id, order_id, kind, caption, storage_path, content_type, size_bytes)
     values ($1, $2, $3, $4, $5, $6, $7) returning version`,
    [
      id,
      orderId,
      over.kind ?? 'sketch',
      over.caption ?? '',
      path,
      over.type ?? 'image/jpeg',
      over.size ?? 120_000,
    ],
  );
}

describe('attachment', () => {
  it('stores a sketch and tells the history', async () => {
    await signedIn(async (c) => {
      const { orderId } = await addOrder(c);
      const before = (await history(c, orderId)).length;
      expect(await insertAttachment(c, orderId, { caption: 'First idea' })).toMatchObject({
        ok: true,
        rows: [{ version: 1 }],
      });
      expect((await history(c, orderId)).slice(before)).toEqual([
        { action: 'file_added', details: { kind: 'sketch', version: 1, caption: 'First idea' } },
      ]);
    });
  });

  it('counts versions for each order and kind on its own', async () => {
    await signedIn(async (c) => {
      const one = await addOrder(c);
      const two = await addOrder(c);
      const versions: number[] = [];
      for (const [order, kind] of [
        [one.orderId, 'sketch'],
        [one.orderId, 'sketch'],
        [one.orderId, 'fabric'],
        [two.orderId, 'sketch'],
        [one.orderId, 'sketch'],
      ] as const) {
        const r = await insertAttachment(c, order, { kind });
        if (!r.ok) throw new Error(r.message);
        versions.push(r.rows[0]!.version as number);
      }
      expect(versions).toEqual([1, 2, 1, 1, 3]);
    });
  });

  it('keeps every file inside its own folder, named after its own row', async () => {
    await signedIn(async (c, owner) => {
      const { orderId } = await addOrder(c);
      const other = await addOrder(c);
      const id = randomUUID();
      const bad: [string, string][] = [
        ['a path in someone else’s folder', `${randomUUID()}/${orderId}/${id}.jpg`],
        ['a path under another order', `${owner}/${other.orderId}/${id}.jpg`],
        ['a path named after another row', `${owner}/${orderId}/${randomUUID()}.jpg`],
        ['a path that climbs out of the folder', `${owner}/${orderId}/../${id}.jpg`],
        ['a path with the wrong ending', `${owner}/${orderId}/${id}.exe`],
        ['no folder at all', `${id}.jpg`],
      ];
      for (const [label, path] of bad) {
        expect(await insertAttachment(c, orderId, { id, path }), label).toMatchObject({
          ok: false,
          code: CHECK,
        });
      }
      for (const ext of ['jpg', 'png', 'webp']) {
        const fresh = randomUUID();
        expect(
          (await insertAttachment(c, orderId, { id: fresh, path: `${owner}/${orderId}/${fresh}.${ext}` })).ok,
          ext,
        ).toBe(true);
      }
    });
  });

  it.each([
    ['a picture format we do not keep', { type: 'image/gif' }],
    ['a document', { type: 'application/pdf' }],
    ['an empty file', { size: 0 }],
    ['a file over 5 MB', { size: 5_242_881 }],
    ['an unknown kind', { kind: 'receipt' }],
    ['a caption with spaces at the ends', { caption: ' hello ' }],
    ['a caption of 201 characters', { caption: 'c'.repeat(201) }],
  ])('refuses %s', async (_label, over) => {
    await signedIn(async (c) => {
      const { orderId } = await addOrder(c);
      expect(await insertAttachment(c, orderId, over)).toMatchObject({ ok: false, code: CHECK });
    });
  });

  it('accepts a file of exactly 5 MB', async () => {
    await signedIn(async (c) => {
      const { orderId } = await addOrder(c);
      expect((await insertAttachment(c, orderId, { size: 5_242_880 })).ok).toBe(true);
    });
  });

  it('allows at most 40 on an order', async () => {
    await signedIn(async (c) => {
      const { orderId } = await addOrder(c);
      for (let i = 0; i < 40; i++) expect((await insertAttachment(c, orderId)).ok).toBe(true);
      expect(await insertAttachment(c, orderId)).toMatchObject({ ok: false, code: CHECK });
      const other = await addOrder(c);
      expect((await insertAttachment(c, other.orderId)).ok).toBe(true);
    });
  });

  it('lets her change a caption and nothing else', async () => {
    await signedIn(async (c) => {
      const { orderId } = await addOrder(c);
      await insertAttachment(c, orderId);
      expect((await attempt(c, `update public.attachment set caption = 'Front view'`)).ok).toBe(true);
      for (const set of [
        `kind = 'fabric'`,
        `version = 9`,
        `size_bytes = 1`,
        `storage_path = 'x'`,
        `order_id = order_id`,
      ]) {
        expect(await attempt(c, `update public.attachment set ${set}`), set).toMatchObject({
          ok: false,
          code: NO_RIGHT,
        });
      }
    });
  });

  it('can be removed, and the history says so', async () => {
    await signedIn(async (c) => {
      const { orderId } = await addOrder(c);
      await insertAttachment(c, orderId, { caption: 'Draft' });
      await c.query(`delete from public.attachment`);
      expect((await history(c, orderId)).at(-1)).toEqual({
        action: 'file_removed',
        details: { kind: 'sketch', version: 1, caption: 'Draft' },
      });
    });
  });

  it.each(['delivered', 'cancelled'] as const)(
    'are kept as they are once the order is %s, and free again when it is reopened',
    async (status) => {
      await signedIn(async (c) => {
        const { orderId } = await addOrder(c);
        const kept = randomUUID();
        expect(await insertAttachment(c, orderId, { id: kept })).toMatchObject({ ok: true });
        const steps =
          status === 'delivered'
            ? [`status = 'active'`, `status = 'delivered', delivered_on = app.today_for((select auth.uid()))`]
            : [`status = 'cancelled'`];
        for (const step of steps) await c.query(`update public.orders set ${step} where id = $1`, [orderId]);

        expect(await insertAttachment(c, orderId)).toMatchObject({ ok: false, code: CHECK });
        expect(
          await attempt(c, `update public.attachment set caption = 'New' where id = $1`, [kept]),
        ).toMatchObject({
          ok: false,
          code: CHECK,
        });
        expect(await attempt(c, `delete from public.attachment where id = $1`, [kept])).toMatchObject({
          ok: false,
          code: CHECK,
        });

        await c.query(`update public.orders set status = $2 where id = $1`, [
          orderId,
          status === 'delivered' ? 'active' : 'draft',
        ]);
        expect(
          await attempt(c, `update public.attachment set caption = 'New' where id = $1`, [kept]),
        ).toMatchObject({
          ok: true,
        });
      });
    },
  );

  it("refuses to hang a file on someone else's order, and hides her files", async () => {
    await inTransaction(async (c) => {
      const a = await createUser(c, 'a@example.test');
      const b = await createUser(c, 'b@example.test');
      await actAs(c, a);
      const { orderId } = await addOrder(c);
      await insertAttachment(c, orderId);
      await actAs(c, b);
      expect((await c.query(`select count(*)::int as n from public.attachment`)).rows[0]!.n).toBe(0);
      const id = randomUUID();
      // Even with a path that is in B's own folder, the order is not B's.
      const r = await insertAttachment(c, orderId, { id, path: `${b}/${orderId}/${id}.jpg` });
      expect(r).toMatchObject({ ok: false, code: FOREIGN_KEY });
    });
  });
});

describe('private storage for order files', () => {
  const put = (c: PoolClient, name: string, bucket = 'order-files') =>
    attempt(c, `insert into storage.objects (bucket_id, name) values ($1, $2)`, [bucket, name]);
  /** Says this transaction deletes as the Storage API does (it removes the file too), past Supabase's guard. */
  const storageApiDeletes = (c: PoolClient) =>
    c.query(`select set_config('storage.allow_delete_query', 'true', true)`);

  it('refuses a delete in SQL alone, which would leave the file behind (Supabase’s own guard)', async () => {
    await signedIn(async (c, id) => {
      await put(c, `${id}/some-order/file.jpg`);
      expect(await attempt(c, `delete from storage.objects`)).toMatchObject({ ok: false, code: NO_RIGHT });
    });
  });

  it('is a private bucket for pictures of at most 5 MB', async () => {
    await signedIn(async (c) => {
      // The bucket's settings, as the database owner: signed-in users cannot read storage.buckets on Supabase.
      await actAsOwner(c);
      const { rows } = await c.query(
        `select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'order-files'`,
      );
      expect(rows).toEqual([
        {
          public: false,
          file_size_limit: '5242880',
          allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'],
        },
      ]);
    });
  });

  it('lets a designer add, read, change and remove files in her own folder', async () => {
    await signedIn(async (c, id) => {
      const name = `${id}/some-order/file.jpg`;
      expect((await put(c, name)).ok).toBe(true);
      expect((await c.query(`select count(*)::int as n from storage.objects`)).rows[0]!.n).toBe(1);
      expect(
        await attempt(c, `update storage.objects set name = $2 where name = $1`, [
          name,
          `${id}/some-order/renamed.jpg`,
        ]),
      ).toMatchObject({ ok: true, rowCount: 1 });
      // As the Storage API does when it removes a file: the policies decide, not the guard against SQL deletes.
      await storageApiDeletes(c);
      expect(await attempt(c, `delete from storage.objects where name like $1`, [`${id}/%`])).toMatchObject({
        ok: true,
        rowCount: 1,
      });
    });
  });

  it('keeps another designer out of her folder: cannot see, add to, move or remove', async () => {
    await inTransaction(async (c) => {
      const a = await createUser(c, 'a@example.test');
      const b = await createUser(c, 'b@example.test');
      await actAs(c, a);
      await put(c, `${a}/order/file.jpg`);
      await actAs(c, b);
      expect((await c.query(`select count(*)::int as n from storage.objects`)).rows[0]!.n).toBe(0);
      expect(await put(c, `${a}/order/planted.jpg`)).toMatchObject({ ok: false, code: NO_RIGHT });
      expect(
        await attempt(c, `update storage.objects set name = $1 where name = $2`, [
          `${b}/order/taken.jpg`,
          `${a}/order/file.jpg`,
        ]),
      ).toMatchObject({ ok: true, rowCount: 0 });
      await storageApiDeletes(c);
      expect(await attempt(c, `delete from storage.objects`)).toMatchObject({ ok: true, rowCount: 0 });
      await actAsOwner(c);
      expect((await c.query(`select count(*)::int as n from storage.objects`)).rows[0]!.n).toBe(1);
    });
  });

  it('refuses a file outside any designer folder, another bucket, or a folder that only looks like hers', async () => {
    await signedIn(async (c, id) => {
      await actAsOwner(c);
      await c.query(`insert into storage.buckets (id, name) values ('other', 'other')`);
      await actAs(c, id);
      expect(await put(c, 'file.jpg')).toMatchObject({ ok: false, code: NO_RIGHT });
      expect(await put(c, `${id}/order/file.jpg`, 'other')).toMatchObject({ ok: false, code: NO_RIGHT });
      expect(await put(c, `${id}x/order/file.jpg`)).toMatchObject({ ok: false, code: NO_RIGHT });
      expect(await put(c, `x/${id}/file.jpg`)).toMatchObject({ ok: false, code: NO_RIGHT });
    });
  });

  it('shows nothing to a visitor who is not signed in', async () => {
    await inTransaction(async (c) => {
      const a = await createUser(c, 'a@example.test');
      await actAs(c, a);
      await put(c, `${a}/order/file.jpg`);
      await actAsAnon(c);
      expect((await c.query(`select count(*)::int as n from storage.objects`)).rows[0]!.n).toBe(0);
      expect(await put(c, `${a}/order/planted.jpg`)).toMatchObject({ ok: false, code: NO_RIGHT });
    });
  });
});
