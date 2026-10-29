import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { CLIENT_CASES, MEASURES_CASES } from '../fixtures/capture-cases';
import { actAs, actAsAnon, actAsOwner, attempt, createUser, inTransaction } from './helpers';

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

async function addClient(c: PoolClient, name = 'Selam Tesfaye'): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `insert into public.client (name) values ($1) returning id`,
    [name],
  );
  return rows[0]!.id;
}

const addSet = (c: PoolClient, clientId: string, measures: unknown = { bust: 92 }, unit = 'cm') =>
  attempt(
    c,
    `insert into public.measurement_set (client_id, taken_on, unit, measures)
     values ($1, '2026-10-20', $2, $3::jsonb) returning id, version`,
    [clientId, unit, JSON.stringify(measures)],
  );

describe('client', () => {
  it.each(CLIENT_CASES)('agrees with the screen on $label', async ({ client, valid }) => {
    await signedIn(async (c) => {
      const r = await attempt(c, `insert into public.client (name, phone, notes) values ($1, $2, $3)`, [
        client.name,
        client.phone,
        client.notes,
      ]);
      if (valid) expect(r.ok).toBe(true);
      else expect(r).toMatchObject({ ok: false, code: CHECK });
    });
  });

  it('refuses a name with spaces at either end, so what is stored is what is shown', async () => {
    await signedIn(async (c) => {
      expect(await attempt(c, `insert into public.client (name) values (' Selam')`)).toMatchObject({
        ok: false,
        code: CHECK,
      });
    });
  });

  it('allows two clients with the same name', async () => {
    await signedIn(async (c) => {
      await addClient(c, 'Hana');
      await addClient(c, 'Hana');
      const { rows } = await c.query(`select count(*)::int as n from public.client`);
      expect(rows[0]!.n).toBe(2);
    });
  });
});

describe('measurement_field: her own list', () => {
  it('starts every new designer with a starter list', async () => {
    await signedIn(async (c) => {
      const { rows } = await c.query(`select key from public.measurement_field order by sort`);
      expect(rows.map((r) => r.key)).toEqual([
        'bust',
        'underbust',
        'waist',
        'hip',
        'shoulder',
        'back_length',
        'sleeve',
        'armhole',
        'neck',
        'dress_length',
        'skirt_length',
        'inseam',
      ]);
    });
  });

  it('can be seeded again without making duplicates', async () => {
    await inTransaction(async (c) => {
      const id = await createUser(c, 'a@example.test');
      await c.query(`select app.seed_measurement_fields($1)`, [id]);
      const { rows } = await c.query(`select count(*)::int as n from public.measurement_field`);
      expect(rows[0]!.n).toBe(12);
    });
  });

  it('lets her rename, reorder and hide a field', async () => {
    await signedIn(async (c) => {
      const r = await attempt(
        c,
        `update public.measurement_field set label = 'Chest', sort = 5, archived = true where key = 'bust'`,
      );
      expect(r).toMatchObject({ ok: true, rowCount: 1 });
    });
  });

  describe('reorder_measurement_fields', () => {
    const order = async (c: PoolClient) =>
      (
        await c.query<{ key: string }>(
          `select key from public.measurement_field where not archived order by sort, label`,
        )
      ).rows.map((r) => r.key);
    const ids = async (c: PoolClient, keys: string[]) =>
      (
        await c.query<{ id: string; key: string }>(
          `select id, key from public.measurement_field where key = any($1)`,
          [keys],
        )
      ).rows
        .sort((a, b) => keys.indexOf(a.key) - keys.indexOf(b.key))
        .map((r) => r.id);

    it('puts the fields in the order given, first first', async () => {
      await signedIn(async (c) => {
        const all = (
          await c.query<{ id: string; key: string }>(
            `select id, key from public.measurement_field order by sort`,
          )
        ).rows;
        const reversed = [...all].reverse();
        expect(
          (await attempt(c, `select public.reorder_measurement_fields($1)`, [reversed.map((r) => r.id)])).ok,
        ).toBe(true);
        expect(await order(c)).toEqual(reversed.map((r) => r.key));
      });
    });

    it('changes nothing at all when one entry is not her visible field', async () => {
      await signedIn(async (c) => {
        await c.query(`update public.measurement_field set archived = true where key = 'neck'`);
        const before = await order(c);
        const [first, second] = await ids(c, ['bust', 'waist']);
        const [hidden] = await ids(c, ['neck']);
        for (const bad of [randomUUID(), hidden!]) {
          const r = await attempt(c, `select public.reorder_measurement_fields($1)`, [[second, first, bad]]);
          expect(r).toMatchObject({ ok: false, code: CHECK });
        }
        const duplicate = await attempt(c, `select public.reorder_measurement_fields($1)`, [
          [second, second],
        ]);
        expect(duplicate).toMatchObject({ ok: false, code: CHECK });
        expect(await order(c)).toEqual(before);
      });
    });

    it("cannot reorder someone else's fields, and does not say whether they exist", async () => {
      await inTransaction(async (c) => {
        const other = await createUser(c, 'other@example.test');
        await actAs(c, other);
        const [theirs] = await ids(c, ['bust']);
        const me = await createUser(c, 'me@example.test');
        await actAs(c, me);
        const r = await attempt(c, `select public.reorder_measurement_fields($1)`, [[theirs]]);
        expect(r).toMatchObject({ ok: false, code: CHECK });
        await actAsOwner(c);
        const { rows } = await c.query(`select sort from public.measurement_field where id = $1`, [theirs]);
        expect(rows[0]!.sort).toBe(10);
      });
    });

    it('cannot be called by someone who is not signed in', async () => {
      await inTransaction(async (c) => {
        await actAsAnon(c);
        expect(await attempt(c, `select public.reorder_measurement_fields($1)`, [[]])).toMatchObject({
          ok: false,
          code: NO_RIGHT,
        });
      });
    });
  });

  it('never lets the key change, because saved measurements refer to it', async () => {
    await signedIn(async (c) => {
      expect(
        await attempt(c, `update public.measurement_field set key = 'chest' where key = 'bust'`),
      ).toMatchObject({
        ok: false,
        code: NO_RIGHT,
      });
    });
  });

  it('never lets a field be deleted', async () => {
    await signedIn(async (c) => {
      expect(await attempt(c, `delete from public.measurement_field where key = 'bust'`)).toMatchObject({
        ok: false,
        code: NO_RIGHT,
      });
    });
  });

  it('refuses two visible fields with the same label, in any capitals', async () => {
    await signedIn(async (c) => {
      expect(
        await attempt(c, `insert into public.measurement_field (key, label) values ('chest', 'BUST')`),
      ).toMatchObject({ ok: false, code: UNIQUE });
    });
  });

  it('lets a hidden field give up its label to a new one', async () => {
    await signedIn(async (c) => {
      await c.query(`update public.measurement_field set archived = true where key = 'bust'`);
      const r = await attempt(
        c,
        `insert into public.measurement_field (key, label) values ('chest', 'Bust')`,
      );
      expect(r.ok).toBe(true);
    });
  });

  it.each([
    ['a key that starts with a digit', '2bust'],
    ['a key with capitals', 'Bust2'],
    ['an empty key', ''],
  ])('refuses %s', async (_label, key) => {
    await signedIn(async (c) => {
      expect(
        await attempt(c, `insert into public.measurement_field (key, label) values ($1, 'X')`, [key]),
      ).toMatchObject({ ok: false, code: CHECK });
    });
  });
});

describe('measurement_set: versions that are never edited', () => {
  // The shape of the measurements is judged by the same cases the screen uses.
  it.each(MEASURES_CASES)('agrees with the screen on $label', async ({ measures, valid }) => {
    await signedIn(async (c) => {
      const id = await addClient(c);
      // Make every well-formed key one of her fields, so only the shape is being judged.
      if (measures && typeof measures === 'object' && !Array.isArray(measures)) {
        for (const key of Object.keys(measures)) {
          if (/^[a-z][a-z0-9_]{0,39}$/.test(key)) {
            await c.query(
              `insert into public.measurement_field (key, label) values ($1, $1) on conflict do nothing`,
              [key],
            );
          }
        }
      }
      const r = await addSet(c, id, measures);
      if (valid) expect(r.ok).toBe(true);
      else expect(r).toMatchObject({ ok: false, code: CHECK });
    });
  });

  it('numbers the versions 1, 2, 3 for each client on its own', async () => {
    await signedIn(async (c) => {
      const one = await addClient(c, 'One');
      const two = await addClient(c, 'Two');
      const versions: number[] = [];
      for (const id of [one, one, two, one, two]) {
        const r = await addSet(c, id);
        if (!r.ok) throw new Error(r.message);
        versions.push(r.rows[0]!.version as number);
      }
      expect(versions).toEqual([1, 2, 1, 3, 2]);
    });
  });

  it('ignores a version number she supplies', async () => {
    await signedIn(async (c) => {
      const id = await addClient(c);
      const r = await attempt(
        c,
        `insert into public.measurement_set (client_id, version, taken_on, unit, measures)
         values ($1, 7, '2026-10-20', 'cm', '{"bust": 92}') returning version`,
        [id],
      );
      expect(r).toMatchObject({ ok: true, rows: [{ version: 1 }] });
    });
  });

  it('refuses a measurement that is not in her list', async () => {
    await signedIn(async (c) => {
      const id = await addClient(c);
      expect(await addSet(c, id, { bust: 92, wingspan: 180 })).toMatchObject({ ok: false, code: CHECK });
    });
  });

  it('refuses a unit other than cm or in', async () => {
    await signedIn(async (c) => {
      const id = await addClient(c);
      expect(await addSet(c, id, { bust: 92 }, 'ft')).toMatchObject({ ok: false, code: CHECK });
    });
  });

  it('can never be changed afterwards', async () => {
    await signedIn(async (c) => {
      const id = await addClient(c);
      await addSet(c, id);
      expect(await attempt(c, `update public.measurement_set set measures = '{"bust": 99}'`)).toMatchObject({
        ok: false,
        code: NO_RIGHT,
      });
      expect(await attempt(c, `update public.measurement_set set taken_on = '2026-01-01'`)).toMatchObject({
        ok: false,
        code: NO_RIGHT,
      });
    });
  });

  it('goes with its client when the client is deleted', async () => {
    await signedIn(async (c) => {
      const id = await addClient(c);
      await addSet(c, id);
      await c.query(`delete from public.client where id = $1`, [id]);
      const { rows } = await c.query(`select count(*)::int as n from public.measurement_set`);
      expect(rows[0]!.n).toBe(0);
    });
  });
});

describe('another designer cannot reach clients or measurements', () => {
  async function twoDesigners(c: PoolClient) {
    const a = await createUser(c, 'a@example.test');
    const b = await createUser(c, 'b@example.test');
    await actAs(c, a);
    const clientId = await addClient(c);
    const set = await addSet(c, clientId);
    if (!set.ok) throw new Error(set.message);
    return { a, b, clientId, setId: set.rows[0]!.id as string };
  }

  it('hides her clients, versions and fields', async () => {
    await inTransaction(async (c) => {
      const { b } = await twoDesigners(c);
      await actAs(c, b);
      for (const t of ['client', 'measurement_set']) {
        const { rows } = await c.query(`select count(*)::int as n from public.${t}`);
        expect(rows[0]!.n, t).toBe(0);
      }
      const { rows } = await c.query(`select count(*)::int as n from public.measurement_field`);
      expect(rows[0]!.n).toBe(12);
    });
  });

  it('leaves her client unchanged when another designer tries to rename or delete it', async () => {
    await inTransaction(async (c) => {
      const { b, clientId } = await twoDesigners(c);
      await actAs(c, b);
      expect(
        await attempt(c, `update public.client set name = 'Hacked' where id = $1`, [clientId]),
      ).toMatchObject({
        ok: true,
        rowCount: 0,
      });
      expect(await attempt(c, `delete from public.client where id = $1`, [clientId])).toMatchObject({
        ok: true,
        rowCount: 0,
      });
      await actAsOwner(c);
      const { rows } = await c.query(`select name from public.client`);
      expect(rows).toEqual([{ name: 'Selam Tesfaye' }]);
    });
  });

  it("refuses to hang a version on someone else's client, and does not say whether the client exists", async () => {
    await inTransaction(async (c) => {
      const { b, clientId } = await twoDesigners(c);
      await actAs(c, b);
      const nobody = '00000000-0000-0000-0000-000000000000';
      const real = await addSet(c, clientId);
      const invented = await addSet(c, nobody);
      if (real.ok || invented.ok) throw new Error('both should have been refused');
      expect(real.code).toBe(FOREIGN_KEY);
      expect(invented.code).toBe(FOREIGN_KEY);
      // The refusal is word for word the same, whether or not the client exists.
      expect(real.message.replaceAll(clientId, 'ID')).toBe(invented.message.replaceAll(nobody, 'ID'));
    });
  });

  it("refuses to insert a row that claims to be someone else's", async () => {
    await inTransaction(async (c) => {
      const { a, b } = await twoDesigners(c);
      await actAs(c, b);
      expect(
        await attempt(c, `insert into public.client (owner_id, name) values ($1, 'Planted')`, [a]),
      ).toMatchObject({
        ok: false,
        code: NO_RIGHT,
      });
    });
  });
});
