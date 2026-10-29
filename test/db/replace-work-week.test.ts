import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { MONDAY, actAs, attempt, createUser, inTransaction } from './helpers';

const TUESDAY = { weekday: 2, start: '09:00', end: '15:00', breaks: [] };
const call = (c: PoolClient, days: unknown) =>
  attempt(c, `select public.replace_work_week($1::jsonb)`, [JSON.stringify(days)]);
const week = async (c: PoolClient) =>
  (
    await c.query(
      `select weekday, start_time::text as start, end_time::text as "end", breaks from public.work_week order by weekday`,
    )
  ).rows;

describe('replace_work_week', () => {
  it('replaces the whole week', async () => {
    await inTransaction(async (c) => {
      await actAs(c, await createUser(c, 'a@example.test'));
      expect((await call(c, [MONDAY, TUESDAY])).ok).toBe(true);
      expect(await week(c)).toEqual([
        { weekday: 1, start: '08:30:00', end: '17:00:00', breaks: MONDAY.breaks },
        { weekday: 2, start: '09:00:00', end: '15:00:00', breaks: [] },
      ]);
      expect((await call(c, [TUESDAY])).ok).toBe(true);
      expect((await week(c)).map((d) => d.weekday)).toEqual([2]);
    });
  });

  it('clears the week when given an empty list', async () => {
    await inTransaction(async (c) => {
      await actAs(c, await createUser(c, 'a@example.test'));
      await call(c, [MONDAY]);
      expect((await call(c, [])).ok).toBe(true);
      expect(await week(c)).toEqual([]);
    });
  });

  it('keeps the old week completely intact when any new day is invalid', async () => {
    await inTransaction(async (c) => {
      await actAs(c, await createUser(c, 'a@example.test'));
      await call(c, [MONDAY, TUESDAY]);
      const before = await week(c);

      const badEnd = await call(c, [MONDAY, { weekday: 3, start: '17:00', end: '09:00', breaks: [] }]);
      const badTime = await call(c, [{ weekday: 3, start: '25:00', end: '26:00', breaks: [] }]);
      const duplicate = await call(c, [MONDAY, MONDAY]);

      expect(badEnd).toMatchObject({ ok: false, code: '23514' });
      expect(badTime.ok).toBe(false);
      expect(duplicate).toMatchObject({ ok: false, code: '23505' });
      expect(await week(c)).toEqual(before);
    });
  });

  it('rejects anything that is not a list', async () => {
    await inTransaction(async (c) => {
      await actAs(c, await createUser(c, 'a@example.test'));
      expect(await call(c, { weekday: 1 })).toMatchObject({ ok: false, code: '22023' });
    });
  });
});
