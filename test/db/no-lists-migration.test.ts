import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Client } from 'pg';
import { connect, migrate, scratchDatabase, type Scratch } from '../../scripts/drill/database';

// Removing the lists of steps (decision 0075) runs on her real data: her two lists, one of them changed by her, and
// jobs whose steps came from a list. This builds the database before it, fills it, migrates, and checks that only the
// lists go.

const BEFORE = '20261102090000';
let scratch: Scratch;
let db: Client;
let her: string;
let job: string;

const one = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
  (await db.query(sql, params)).rows[0] as T;

beforeAll(async () => {
  scratch = await scratchDatabase(inject('adminUrl'), 'dagmawit_build', BEFORE);
  db = await connect(scratch.url);
  her = (
    await one<{ id: string }>(
      `insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), 'her@example.test', '{}') returning id`,
    )
  ).id;
  // Her lists, as a new account got them; she renamed a step of one.
  await db.query(
    `update public.template_task set title = 'Buy silk' where title = 'Buy fabric' and owner_id = $1`,
    [her],
  );
  const client = (
    await one<{ id: string }>(
      `insert into public.client (owner_id, name) values ($1, 'Megan') returning id`,
      [her],
    )
  ).id;
  job = (
    await one<{ id: string }>(
      `insert into public.orders (owner_id, client_id, title, delivery_on, status)
       values ($1, $2, 'Bridal gown', current_date + 30, 'draft') returning id`,
      [her, client],
    )
  ).id;
  // The steps of her Bridal gown list, added to the job as the app did, with days she gave some of them.
  await db.query(
    `insert into public.task (owner_id, order_id, sort, title, on_day)
     select $1, $2, tt.sort, tt.title, case when tt.sort <= 30 then current_date + tt.sort / 10 end
     from public.template_task tt join public.template t on t.id = tt.template_id
     where t.owner_id = $1 and t.name = 'Bridal gown'`,
    [her, job],
  );
  await db.query(`update public.orders set status = 'active' where id = $1`, [job]);
  await migrate(db, { from: BEFORE, upTo: '20261103090000' });
});

afterAll(async () => {
  await db?.end();
  await scratch?.drop();
});

describe('removing the lists of steps', () => {
  it('removes the lists and what kept them', async () => {
    const left = await one<{ tables: string[] | null; functions: string[] | null }>(
      `select (select array_agg(c.relname::text) from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relname like 'template%') as tables,
              (select array_agg(p.proname::text) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname in ('public', 'app') and p.proname like '%template%') as functions`,
    );
    expect(left).toEqual({ tables: null, functions: null });
  });

  it('keeps every job and every step, with their days', async () => {
    const steps = await db.query(
      `select title, on_day is not null as dated from public.task where order_id = $1 order by sort`,
      [job],
    );
    expect(steps.rows.map((r) => r.title)).toEqual([
      'Appointment',
      'Sketch',
      'Buy fabric and lace',
      'Cutting',
      'Sewing',
      'First fitting',
      'Lace work',
      'Second fitting',
      'Finishing and pressing',
      'Final fitting',
      'Delivery',
    ]);
    expect(steps.rows.filter((r) => r.dated)).toHaveLength(3);
    expect(await one(`select status, title from public.orders where id = $1`, [job])).toEqual({
      status: 'active',
      title: 'Bridal gown',
    });
  });

  it('still sets up a new account: her profile, measurements list and working week, and no lists', async () => {
    const someone = (
      await one<{ id: string }>(
        `insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), 'new@example.test', '{"name":"Hana"}') returning id`,
      )
    ).id;
    expect(
      await one(
        `select (select name from public.profile where owner_id = $1) as name,
                (select count(*)::int from public.measurement_field where owner_id = $1) > 0 as fields,
                (select count(*)::int from public.work_week where owner_id = $1) as days`,
        [someone],
      ),
    ).toEqual({ name: 'Hana', fields: true, days: 6 });
  });

  it('exports at the new schema', async () => {
    expect(await one(`select app.schema_version() as v`)).toEqual({ v: '20261103090000' });
  });
});
