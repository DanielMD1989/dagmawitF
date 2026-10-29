import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { inTransaction } from './helpers';

/**
 * Lists every table in `public` that is not fully protected. Future stages add tables;
 * this is the check that stops one of them from shipping without owner-only access.
 */
async function unsecuredTables(c: PoolClient): Promise<string[]> {
  const { rows } = await c.query<{ name: string; problems: string[] }>(`
    select c.relname as name,
           array_remove(array[
             case when not c.relrowsecurity then 'row-level security is off' end,
             case when not c.relforcerowsecurity then 'row-level security is not forced' end,
             case when not exists (
               select 1 from pg_attribute a
               where a.attrelid = c.oid and a.attname = 'owner_id' and a.attnotnull and a.atttypid = 'uuid'::regtype
             ) then 'no owner_id uuid not null' end,
             case when (
               select count(*) from pg_policies p
               where p.schemaname = 'public' and p.tablename = c.relname
                 and p.roles = '{authenticated}'
                 and p.cmd in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
             ) <> 4 then 'does not have exactly the four owner policies' end,
             case when exists (
               select 1 from pg_policies p
               where p.schemaname = 'public' and p.tablename = c.relname and p.roles <> '{authenticated}'
             ) then 'has a policy for another role' end,
             case when has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger')
               then 'the anonymous role has access' end,
             case when has_table_privilege('authenticated', c.oid, 'truncate,references,trigger')
               then 'signed-in users can truncate or reference it' end
           ], null) as problems
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  `);
  return rows.filter((r) => r.problems.length > 0).map((r) => `${r.name}: ${r.problems.join('; ')}`);
}

describe('every table that holds her data is secured', () => {
  it('has no unprotected table in the public schema', async () => {
    await inTransaction(async (c) => {
      expect(await unsecuredTables(c)).toEqual([]);
    });
  });

  it('actually catches a table that was forgotten', async () => {
    await inTransaction(async (c) => {
      await c.query(`create table public.forgotten (owner_id uuid not null default auth.uid(), note text)`);
      const found = await unsecuredTables(c);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatch(/^forgotten: row-level security is off/);
    });
  });

  it('is fixed by securing it the one agreed way', async () => {
    await inTransaction(async (c) => {
      await c.query(`create table public.fine (owner_id uuid not null default auth.uid(), note text)`);
      await c.query(`select app.secure_owner_table('public.fine')`);
      expect(await unsecuredTables(c)).toEqual([]);
    });
  });

  it('refuses to secure a table that has no owner', async () => {
    await inTransaction(async (c) => {
      await c.query(`create table public.orphan (note text)`);
      await expect(c.query(`select app.secure_owner_table('public.orphan')`)).rejects.toThrow(/no owner_id/);
    });
  });

  it('keeps the helper schema out of reach of the public API role', async () => {
    await inTransaction(async (c) => {
      const { rows } = await c.query(
        `select has_function_privilege('anon', 'app.secure_owner_table(regclass)', 'execute') as anon_can,
                has_function_privilege('authenticated', 'app.secure_owner_table(regclass)', 'execute') as user_can`,
      );
      expect(rows[0]).toEqual({ anon_can: false, user_can: false });
    });
  });
});
