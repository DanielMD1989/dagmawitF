import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { MONDAY, actAs, actAsAnon, actAsOwner, attempt, createUser, inTransaction } from './helpers';

/**
 * Stage 0 exit test: a second account cannot see, change or take over her rows.
 * Two designers, A and B. A has a profile, a working week and a holiday.
 */
async function twoDesigners(c: PoolClient) {
  const a = await createUser(c, 'a@example.test', 'Designer A');
  const b = await createUser(c, 'b@example.test', 'Designer B');
  await actAs(c, a);
  await c.query(`select public.replace_work_week($1::jsonb)`, [JSON.stringify([MONDAY])]);
  await c.query(
    `insert into public.calendar_exception (day, minutes_available, reason) values ('2026-11-13', 0, 'Holiday')`,
  );
  await c.query(`update public.profile set planning_ratio = 0.60 where owner_id = $1`, [a]);
  await actAsOwner(c);
  return { a, b };
}

const TABLES = ['profile', 'work_week', 'calendar_exception'] as const;

describe('row-level security: one designer cannot reach another', () => {
  it('gives every new user a profile automatically', async () => {
    await inTransaction(async (c) => {
      const { a, b } = await twoDesigners(c);
      const { rows } = await c.query(`select owner_id, name from public.profile order by name`);
      expect(rows).toEqual([
        { owner_id: a, name: 'Designer A' },
        { owner_id: b, name: 'Designer B' },
      ]);
    });
  });

  it('lets the owner read her own rows', async () => {
    await inTransaction(async (c) => {
      const { a } = await twoDesigners(c);
      await actAs(c, a);
      for (const t of TABLES) {
        const { rows } = await c.query(`select count(*)::int as n from public.${t}`);
        expect(rows[0]!.n, t).toBe(1);
      }
    });
  });

  it.each(TABLES)('hides %s rows from another signed-in user', async (table) => {
    await inTransaction(async (c) => {
      const { b } = await twoDesigners(c);
      await actAs(c, b);
      const { rows } = await c.query(`select owner_id from public.${table} where owner_id <> $1`, [b]);
      expect(rows).toEqual([]);
    });
  });

  it("lets B see only B's own profile", async () => {
    await inTransaction(async (c) => {
      const { b } = await twoDesigners(c);
      await actAs(c, b);
      const { rows } = await c.query(`select owner_id from public.profile`);
      expect(rows).toEqual([{ owner_id: b }]);
    });
  });

  it("ignores updates B aims at A's rows, and leaves them unchanged", async () => {
    await inTransaction(async (c) => {
      const { a, b } = await twoDesigners(c);
      await actAs(c, b);
      const results = [
        await attempt(c, `update public.profile set planning_ratio = 1.00 where owner_id = $1`, [a]),
        await attempt(c, `update public.work_week set end_time = '23:00' where owner_id = $1`, [a]),
        await attempt(c, `update public.calendar_exception set minutes_available = 600 where owner_id = $1`, [
          a,
        ]),
      ];
      for (const r of results) expect(r).toMatchObject({ ok: true, rowCount: 0 });

      await actAsOwner(c);
      const { rows } = await c.query(
        `select (select planning_ratio from public.profile where owner_id = $1)::float as ratio,
                (select end_time::text from public.work_week where owner_id = $1) as end_time,
                (select minutes_available from public.calendar_exception where owner_id = $1) as minutes`,
        [a],
      );
      expect(rows[0]).toEqual({ ratio: 0.6, end_time: '17:00:00', minutes: 0 });
    });
  });

  it("ignores deletes B aims at A's rows", async () => {
    await inTransaction(async (c) => {
      const { a, b } = await twoDesigners(c);
      await actAs(c, b);
      for (const t of TABLES) {
        const r = await attempt(c, `delete from public.${t} where owner_id = $1`, [a]);
        // Either the rows are invisible to B, or nobody may delete from the table at all (her profile).
        if (r.ok) expect(r, t).toMatchObject({ rowCount: 0 });
        else expect(r, t).toMatchObject({ code: '42501' });
      }
      await actAsOwner(c);
      for (const t of TABLES) {
        const { rows } = await c.query(`select count(*)::int as n from public.${t} where owner_id = $1`, [a]);
        expect(rows[0]!.n, t).toBe(1);
      }
    });
  });

  it('refuses a row that claims A as its owner', async () => {
    await inTransaction(async (c) => {
      const { a, b } = await twoDesigners(c);
      await actAs(c, b);
      const week = await attempt(
        c,
        `insert into public.work_week (owner_id, weekday, start_time, end_time) values ($1, 2, '09:00', '17:00')`,
        [a],
      );
      const holiday = await attempt(
        c,
        `insert into public.calendar_exception (owner_id, day, minutes_available) values ($1, '2026-12-25', 0)`,
        [a],
      );
      expect(week).toMatchObject({ ok: false, code: '42501' });
      expect(holiday).toMatchObject({ ok: false, code: '42501' });
    });
  });

  it('refuses to let a row be handed over to someone else', async () => {
    await inTransaction(async (c) => {
      const { a, b } = await twoDesigners(c);
      await actAs(c, a);
      const r = await attempt(c, `update public.work_week set owner_id = $1 where owner_id = $2`, [b, a]);
      expect(r).toMatchObject({ ok: false, code: '42501' });
    });
  });

  it('files a new row under the signed-in user without being told who they are', async () => {
    await inTransaction(async (c) => {
      const { a, b } = await twoDesigners(c);
      await actAs(c, b);
      await c.query(
        `insert into public.calendar_exception (day, minutes_available) values ('2026-11-13', 240)`,
      );
      const mine = await c.query(`select owner_id, minutes_available from public.calendar_exception`);
      expect(mine.rows).toEqual([{ owner_id: b, minutes_available: 240 }]);
      await actAs(c, a);
      const hers = await c.query(`select minutes_available from public.calendar_exception`);
      expect(hers.rows).toEqual([{ minutes_available: 0 }]);
    });
  });

  it.each(TABLES)('gives a visitor who is not signed in no access to %s', async (table) => {
    await inTransaction(async (c) => {
      await twoDesigners(c);
      await actAsAnon(c);
      const read = await attempt(c, `select * from public.${table}`);
      expect(read).toMatchObject({ ok: false, code: '42501' });
    });
  });

  it('does not let a visitor who is not signed in change her week', async () => {
    await inTransaction(async (c) => {
      await twoDesigners(c);
      await actAsAnon(c);
      const r = await attempt(c, `select public.replace_work_week('[]'::jsonb)`);
      expect(r).toMatchObject({ ok: false, code: '42501' });
    });
  });

  it("keeps replace_work_week inside the caller's own rows", async () => {
    await inTransaction(async (c) => {
      const { a, b } = await twoDesigners(c);
      await actAs(c, b);
      await c.query(`select public.replace_work_week($1::jsonb)`, [
        JSON.stringify([{ weekday: 3, start: '10:00', end: '16:00', breaks: [] }]),
      ]);
      await actAsOwner(c);
      const { rows } = await c.query(`select owner_id, weekday from public.work_week order by weekday`);
      expect(rows).toEqual([
        { owner_id: a, weekday: 1 },
        { owner_id: b, weekday: 3 },
      ]);
    });
  });
});
