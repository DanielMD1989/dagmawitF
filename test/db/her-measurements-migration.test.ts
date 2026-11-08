import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Client } from 'pg';
import { connect, migrate, scratchDatabase, type Scratch } from '../../scripts/drill/database';

// Her own measurements (decision 0102). This builds the database before the change with the starter list, as her
// workspace has it, and one other designer who has measured someone with a starter measurement that is not hers. The
// migration gives both her list in her order; a starter measurement nobody used is gone, one that was used is hidden,
// so the saved set still reads.

const BEFORE = '20261112090000';
let scratch: Scratch;
let db: Client;
let her: string;
let other: string;

const fields = async (owner: string) =>
  (
    await db.query<{ key: string; label: string; archived: boolean }>(
      `select key, label, archived from public.measurement_field where owner_id = $1 order by archived, sort`,
      [owner],
    )
  ).rows;

beforeAll(async () => {
  scratch = await scratchDatabase(inject('adminUrl'), 'dagmawit_build', BEFORE);
  db = await connect(scratch.url);
  const user = async (email: string) =>
    (
      await db.query<{ id: string }>(
        `insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), $1, '{}') returning id`,
        [email],
      )
    ).rows[0]!.id;
  her = await user('her@example.test');
  other = await user('other@example.test');
  const client = (
    await db.query<{ id: string }>(
      `insert into public.client (owner_id, name) values ($1, 'Megan') returning id`,
      [other],
    )
  ).rows[0]!.id;
  await db.query(
    `insert into public.measurement_set (owner_id, client_id, taken_on, unit, measures)
     values ($1, $2, current_date, 'cm', '{"neck": 34, "sleeve": 58}')`,
    [other, client],
  );
  await migrate(db, { from: BEFORE, upTo: '20261113090000' });
});

afterAll(async () => {
  await db?.end();
  await scratch?.drop();
});

const HERS = [
  'Bust',
  'Waist',
  'Hip',
  'Shoulder to bust',
  'Shoulder to waist',
  'Coat length',
  'Back shoulder',
  'Half shoulder',
  'Sleeve',
  'Armhole',
  'Trouser waist',
  'Skirt length',
  'Height',
];

describe('her measurements migration (decision 0102)', () => {
  it('gives her her list, in her order, and nothing else', async () => {
    const list = await fields(her);
    expect(list.map((f) => f.label)).toEqual(HERS);
    expect(list.every((f) => !f.archived)).toBe(true);
  });

  it('keeps the keys saved sets use: "sleeve" is still sleeve, now called Sleeve', async () => {
    expect((await fields(her)).find((f) => f.key === 'sleeve')?.label).toBe('Sleeve');
  });

  it('hides a starter measurement a saved set used, rather than losing it', async () => {
    const list = await fields(other);
    expect(list.filter((f) => !f.archived).map((f) => f.label)).toEqual(HERS);
    expect(list.filter((f) => f.archived)).toEqual([{ key: 'neck', label: 'Neck', archived: true }]);
  });
});
