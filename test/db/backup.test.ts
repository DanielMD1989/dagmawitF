import { describe, expect, inject, it } from 'vitest';
import type { PoolClient } from 'pg';
import { differences, readExportFile, type ExportFile } from '../../src/backup/format';
import { migrations } from '../../scripts/drill/database';
import { runDrill } from '../../scripts/drill/drill';
import { fillPerson } from '../../scripts/drill/full-person';
import { actAs, actAsAnon, actAsOwner, attempt, createUser, inTransaction } from './helpers';

// Stage 6 in the database: the export and the restore. The contract is docs/harden.md.

const NO_RIGHT = '42501';
const BAD_INPUT = '22023';
const FOREIGN_KEY = '23503';

async function exportAs(c: PoolClient, id: string): Promise<ExportFile> {
  await actAs(c, id);
  const { rows } = await c.query(`select public.export_my_data() as d`);
  await actAsOwner(c);
  const read = readExportFile(rows[0]!.d);
  if (!read.ok) throw new Error(read.reason);
  return read.value;
}

/** A person with something in every table. */
async function person(c: PoolClient, email: string): Promise<string> {
  const id = await createUser(c, email, 'Dagmawit');
  await actAs(c, id);
  await fillPerson(c);
  await actAsOwner(c);
  return id;
}

/**
 * A real restore is a transaction of its own, after her data was committed. Here everything is one rolled-back
 * transaction, so the checks the database defers to the end of it are run first, as a commit would have.
 */
async function restore(c: PoolClient, owner: string, file: unknown) {
  await c.query('set constraints all immediate');
  return attempt(c, `select app.restore_owner($1, $2::jsonb)`, [owner, JSON.stringify(file)]);
}

const tablesInPublic = async (c: PoolClient) =>
  (
    await c.query<{ t: string }>(
      `select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1`,
    )
  ).rows.map((r) => r.t);

describe('the schema version', () => {
  it('is the name of the last migration, so an export says which schema it belongs to', async () => {
    await inTransaction(async (c) => {
      const { rows } = await c.query(`select app.schema_version() as v`);
      expect(rows[0]!.v).toBe(migrations().at(-1)!.version);
    });
  });
});

describe('the export', () => {
  it('holds every table, and in each table only her rows', async () => {
    await inTransaction(async (c) => {
      const a = await person(c, 'a@example.test');
      const b = await person(c, 'b@example.test');
      const file = await exportAs(c, a);
      expect(file.owner_id).toBe(a);
      expect(Object.keys(file.tables).sort()).toEqual(await tablesInPublic(c));
      for (const [table, rows] of Object.entries(file.tables)) {
        const { rows: count } = await c.query(
          `select count(*)::int as n from public.${table} where owner_id = $1`,
          [a],
        );
        expect(rows.length, table).toBe(count[0]!.n);
        expect(rows.length, `${table} is empty: the fixture should fill it`).toBeGreaterThan(0);
        expect(
          rows.every((r) => r.owner_id === a),
          table,
        ).toBe(true);
      }
      expect(JSON.stringify(file)).not.toContain(b);
    });
  });

  it('exports a table added later without being told about it', async () => {
    await inTransaction(async (c) => {
      const a = await createUser(c, 'a@example.test');
      await c.query(`create table public.later (owner_id uuid not null default auth.uid(), note text)`);
      await c.query(`select app.secure_owner_table('public.later')`);
      await actAs(c, a);
      await c.query(`insert into public.later (note) values ('new')`);
      const file = await exportAs(c, a);
      expect(file.tables.later).toEqual([{ owner_id: a, note: 'new' }]);
    });
  });

  it('reads every table from one moment: it is a stable function, run as her', async () => {
    await inTransaction(async (c) => {
      const { rows } = await c.query(
        `select provolatile, prosecdef from pg_proc where oid = 'public.export_my_data()'::regprocedure`,
      );
      expect(rows[0]).toEqual({ provolatile: 's', prosecdef: false });
    });
  });

  it('is the same file twice for the same data', async () => {
    await inTransaction(async (c) => {
      const a = await person(c, 'a@example.test');
      const one = await exportAs(c, a);
      const two = await exportAs(c, a);
      expect(JSON.stringify(two.tables)).toBe(JSON.stringify(one.tables));
    });
  });

  it('is refused to a visitor who is not signed in', async () => {
    await inTransaction(async (c) => {
      await actAsAnon(c);
      expect(await attempt(c, `select public.export_my_data()`)).toMatchObject({ ok: false, code: NO_RIGHT });
    });
  });
});

describe('the restore', () => {
  it('puts her data back as it was, after she changed and lost things', async () => {
    await inTransaction(async (c) => {
      const a = await person(c, 'a@example.test');
      const before = await exportAs(c, a);
      await actAs(c, a);
      await c.query(`update public.profile set name = 'Someone else'`);
      await c.query(`select public.delete_job(id) from public.orders where status = 'draft'`);
      await c.query(`insert into public.client (name) values ('Added after')`);
      await actAsOwner(c);
      expect(await restore(c, a, before)).toMatchObject({ ok: true });
      expect(differences(before, await exportAs(c, a))).toEqual([]);
    });
  });

  it('restores into another account, with her pictures moved to its folder, once the first is gone', async () => {
    await inTransaction(async (c) => {
      const a = await person(c, 'a@example.test');
      const before = await exportAs(c, a);
      await c.query(`delete from auth.users where id = $1`, [a]);
      const b = await createUser(c, 'b@example.test');
      expect(await restore(c, b, before)).toMatchObject({ ok: true });
      const after = await exportAs(c, b);
      expect(differences(before, after)).toEqual([]);
      expect(after.tables.attachment!.every((r) => String(r.storage_path).startsWith(`${b}/`))).toBe(true);
    });
  });

  it('leaves the other people in the database alone', async () => {
    await inTransaction(async (c) => {
      const a = await person(c, 'a@example.test');
      const b = await person(c, 'b@example.test');
      const theirs = await exportAs(c, b);
      expect(await restore(c, a, await exportAs(c, a))).toMatchObject({ ok: true });
      expect(differences(theirs, await exportAs(c, b))).toEqual([]);
    });
  });

  it('puts history and template versions back as they were, not re-made', async () => {
    await inTransaction(async (c) => {
      const a = await person(c, 'a@example.test');
      const before = await exportAs(c, a);
      expect(await restore(c, a, before)).toMatchObject({ ok: true });
      const { rows } = await c.query(
        `select (select count(*)::int from public.activity_log where owner_id = $1) as history,
                (select max(version) from public.template where owner_id = $1) as version`,
        [a],
      );
      expect(rows[0]).toEqual({
        history: before.tables.activity_log!.length,
        version: Math.max(...before.tables.template!.map((t) => Number(t.version))),
      });
    });
  });

  it('lets her carry on: the next history line comes after the restored ones', async () => {
    await inTransaction(async (c) => {
      const a = await person(c, 'a@example.test');
      const before = await exportAs(c, a);
      const highest = Math.max(...before.tables.activity_log!.map((r) => Number(r.seq)));
      await c.query(`delete from auth.users where id = $1`, [a]);
      // The counter is behind the file's lines, as in a new project.
      await c.query(`select setval(pg_get_serial_sequence('public.activity_log', 'seq'), 1)`);
      const b = await createUser(c, 'b@example.test');
      expect(await restore(c, b, before)).toMatchObject({ ok: true });
      await actAs(c, b);
      await c.query(`insert into public.client (name) values ('After')`);
      await c.query(
        `insert into public.orders (client_id, delivery_on) select id, current_date + 30 from public.client where name = 'After'`,
      );
      const { rows } = await c.query(`select max(seq)::int as n from public.activity_log`);
      expect(rows[0]!.n).toBeGreaterThan(highest);
    });
  });

  it('refuses a file that is not an export, or from another schema, and changes nothing', async () => {
    await inTransaction(async (c) => {
      const a = await person(c, 'a@example.test');
      const file = await exportAs(c, a);
      expect(await restore(c, a, { ...file, format: 'other' })).toMatchObject({
        ok: false,
        code: BAD_INPUT,
        message: 'this is not a DAGMAWIT export',
      });
      expect(await restore(c, a, { ...file, schema: '20261025090000' })).toMatchObject({
        ok: false,
        code: BAD_INPUT,
        message: expect.stringMatching(/^the file is from schema 20261025090000, the database is at \d{14}/),
      });
      expect(await restore(c, a, { ...file, owner_id: 'nobody' })).toMatchObject({
        ok: false,
        code: BAD_INPUT,
      });
      expect(await restore(c, '00000000-0000-4000-8000-000000000000', file)).toMatchObject({
        ok: false,
        code: FOREIGN_KEY,
      });
      expect(differences(file, await exportAs(c, a))).toEqual([]);
    });
  });

  it('refuses a file whose tables or columns are not this database’s', async () => {
    await inTransaction(async (c) => {
      const a = await person(c, 'a@example.test');
      const file = await exportAs(c, a);
      const fewer = Object.fromEntries(Object.entries(file.tables).filter(([t]) => t !== 'task'));
      expect(await restore(c, a, { ...file, tables: fewer })).toMatchObject({ ok: false, code: BAD_INPUT });

      const extraColumn = structuredClone(file);
      extraColumn.tables.client![0]!.nickname = 'Seli';
      expect(await restore(c, a, extraColumn)).toMatchObject({
        ok: false,
        code: BAD_INPUT,
        message: expect.stringContaining("in the file's client do not match"),
      });

      const lostColumn = structuredClone(file);
      delete lostColumn.tables.task![0]!.done_on;
      expect(await restore(c, a, lostColumn)).toMatchObject({ ok: false, code: BAD_INPUT });
    });
  });

  it('refuses a row that is not the file owner’s, or a picture outside her folder', async () => {
    await inTransaction(async (c) => {
      const a = await person(c, 'a@example.test');
      const file = await exportAs(c, a);
      const stranger = structuredClone(file);
      stranger.tables.client![0]!.owner_id = '00000000-0000-4000-8000-000000000000';
      expect(await restore(c, a, stranger)).toMatchObject({ ok: false, code: BAD_INPUT });

      const elsewhere = structuredClone(file);
      const p = elsewhere.tables.attachment![0]!;
      p.storage_path = String(p.storage_path).replace(a, '00000000-0000-4000-8000-000000000000');
      expect(await restore(c, a, elsewhere)).toMatchObject({
        ok: false,
        code: BAD_INPUT,
        message: "a picture in the file is stored outside its owner's folder",
      });
    });
  });

  it('lets the database refuse a row that points at nothing, and undoes everything', async () => {
    await inTransaction(async (c) => {
      const a = await person(c, 'a@example.test');
      const file = await exportAs(c, a);
      const broken = structuredClone(file);
      // A task of an order (row order is by content, so the first may be studio work, which has no garment).
      broken.tables.task!.find((t) => t.order_id !== null)!.order_item_id =
        '00000000-0000-4000-8000-000000000000';
      expect(await restore(c, a, broken)).toMatchObject({
        ok: false,
        code: FOREIGN_KEY,
        message: expect.stringMatching(
          /^insert or update on table "task" violates foreign key constraint "task_\w+"$/,
        ),
      });
      expect(differences(file, await exportAs(c, a))).toEqual([]);
    });
  });

  const triggers = async (c: PoolClient) =>
    (
      await c.query<{ t: string }>(
        `select c.relname || '.' || t.tgname || '=' || t.tgenabled::text as t
         from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and not t.tgisinternal order by 1`,
      )
    ).rows.map((r) => r.t);

  it('turns the app’s triggers back on, exactly as they were, before it returns', async () => {
    await inTransaction(async (c) => {
      const a = await person(c, 'a@example.test');
      const before = await triggers(c);
      expect(before.length).toBeGreaterThan(20);
      expect(before.every((t) => t.endsWith('=O'))).toBe(true);
      expect(await restore(c, a, await exportAs(c, a))).toMatchObject({ ok: true });
      expect(await triggers(c)).toEqual(before);
      // And they work: a change made after the restore is recorded in her history.
      await actAs(c, a);
      const lines = async () =>
        Number((await c.query(`select count(*) from public.activity_log`)).rows[0]!.count);
      const history = await lines();
      await c.query(
        `update public.orders set status = 'on_hold', hold_reason = 'After the restore'
         where status = 'active' and title = 'Evening dress'`,
      );
      expect(await lines()).toBe(history + 1);
      await actAsOwner(c);
    });
  });

  it('needs no superuser: it runs as an owner of the tables who is not one, as on Supabase', async () => {
    await inTransaction(async (c) => {
      const a = await person(c, 'a@example.test');
      const file = await exportAs(c, a);
      const { rows } = await c.query<{ superuser: boolean }>(
        `select rolsuper as superuser from pg_roles where rolname = current_user`,
      );
      if (rows[0]!.superuser) {
        // On plain PostgreSQL the tests run as a superuser. Make the tables belong to a role like Supabase's
        // `postgres`: it owns them and bypasses row-level security, and is not a superuser.
        await c.query(`create role restore_like_supabase nologin nosuperuser bypassrls`);
        await c.query(`grant usage on schema app, auth to restore_like_supabase`);
        await c.query(`grant select on auth.users to restore_like_supabase`);
        await c.query(
          `grant execute on function app.restore_owner(uuid, jsonb), app.schema_version() to restore_like_supabase`,
        );
        for (const t of await tablesInPublic(c))
          await c.query(`alter table public.${t} owner to restore_like_supabase`);
        await c.query(`set local role restore_like_supabase`);
      }
      expect(await restore(c, a, file)).toMatchObject({ ok: true });
      await actAsOwner(c);
      expect(differences(file, await exportAs(c, a))).toEqual([]);
    });
  });

  it('cannot be reached from the app', async () => {
    await inTransaction(async (c) => {
      const { rows } = await c.query(
        `select has_function_privilege('authenticated', 'app.restore_owner(uuid, jsonb)', 'execute') as user_can,
                has_function_privilege('anon', 'app.restore_owner(uuid, jsonb)', 'execute') as anon_can,
                has_function_privilege('service_role', 'app.restore_owner(uuid, jsonb)', 'execute') as service_can`,
      );
      expect(rows[0]).toEqual({ user_can: false, anon_can: false, service_can: false });
    });
  });
});

describe('the drill', () => {
  it('exports, restores as another person in a fresh database, and finds the two the same', async () => {
    // The drill makes its own databases next to the test database, on the same server.
    const problems = await runDrill(inject('adminUrl'));
    expect(problems).toEqual([]);
  }, 120_000);
});
