import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { WORK_DAY_CASES } from '../fixtures/work-day-cases';
import { actAs, actAsOwner, attempt, createUser, inTransaction } from './helpers';

const CHECK = '23514';
const UNIQUE = '23505';
const NOT_NULL = '23502';

async function signedIn<T>(fn: (c: PoolClient, userId: string) => Promise<T>) {
  return inTransaction(async (c) => {
    const id = await createUser(c, 'a@example.test');
    await actAs(c, id);
    // A new account starts with Monday to Saturday (decision 0066); these tests write days of their own.
    await c.query(`delete from public.work_week`);
    return fn(c, id);
  });
}

const insertDay = (c: PoolClient, weekday: number, start: string, end: string, breaks = '[]') =>
  attempt(
    c,
    `insert into public.work_week (weekday, start_time, end_time, breaks) values ($1, $2, $3, $4::jsonb)`,
    [weekday, start, end, breaks],
  );

describe('work_week', () => {
  // The same cases the screen's own rules are tested with, so the two cannot drift apart.
  it.each(WORK_DAY_CASES)('agrees with the screen on $label', async ({ day, valid }) => {
    await signedIn(async (c) => {
      const r = await insertDay(c, day.weekday, day.start, day.end, JSON.stringify(day.breaks));
      if (valid) expect(r.ok).toBe(true);
      else expect(r).toMatchObject({ ok: false, code: CHECK });
    });
  });

  it('allows only one row per weekday', async () => {
    await signedIn(async (c) => {
      expect((await insertDay(c, 2, '09:00', '17:00')).ok).toBe(true);
      expect(await insertDay(c, 2, '10:00', '15:00')).toMatchObject({ ok: false, code: UNIQUE });
    });
  });

  it('rejects breaks that are not a list', async () => {
    await signedIn(async (c) => {
      expect(await insertDay(c, 4, '08:00', '17:00', '{"start":"12:00","end":"13:00"}')).toMatchObject({
        ok: false,
        code: CHECK,
      });
      expect(await insertDay(c, 4, '08:00', '17:00', '[{"start":"12:00"}]')).toMatchObject({
        ok: false,
        code: CHECK,
      });
    });
  });
});

describe('calendar_exception', () => {
  const insert = (c: PoolClient, day: string, minutes: number, reason = '') =>
    attempt(c, `insert into public.calendar_exception (day, minutes_available, reason) values ($1, $2, $3)`, [
      day,
      minutes,
      reason,
    ]);

  it('accepts a closed day and a half day', async () => {
    await signedIn(async (c) => {
      expect((await insert(c, '2026-09-11', 0, 'New Year')).ok).toBe(true);
      expect((await insert(c, '2026-09-12', 240, 'Half day')).ok).toBe(true);
    });
  });

  it.each([-1, 1441])('rejects %i minutes', async (minutes) => {
    await signedIn(async (c) => {
      expect(await insert(c, '2026-09-11', minutes)).toMatchObject({ ok: false, code: CHECK });
    });
  });

  it('allows one exception per date', async () => {
    await signedIn(async (c) => {
      expect((await insert(c, '2026-09-11', 0)).ok).toBe(true);
      expect(await insert(c, '2026-09-11', 120)).toMatchObject({ ok: false, code: UNIQUE });
    });
  });

  it('rejects an overlong reason', async () => {
    await signedIn(async (c) => {
      expect(await insert(c, '2026-09-11', 0, 'x'.repeat(201))).toMatchObject({ ok: false, code: CHECK });
    });
  });

  it('refuses an insert when nobody is signed in as the owner (no owner to file it under)', async () => {
    await inTransaction(async (c) => {
      // Signed in as a role with no user id in the claims.
      await c.query(`set local role authenticated`);
      await c.query(`select set_config('request.jwt.claims', '', true)`);
      const r = await insert(c, '2026-09-11', 0);
      expect(r).toMatchObject({ ok: false });
      expect((r as { code: string }).code).toMatch(new RegExp(`^(${NOT_NULL}|42501)$`));
    });
  });
});

describe('profile', () => {
  it('starts with the agreed defaults', async () => {
    await signedIn(async (c, id) => {
      const { rows } = await c.query(
        `select timezone, measurement_unit from public.profile where owner_id = $1`,
        [id],
      );
      expect(rows[0]).toEqual({ timezone: 'Africa/Addis_Ababa', measurement_unit: 'cm' });
    });
  });

  it('has no language, calendar or planning settings any more (decisions 0061 and 0066)', async () => {
    await signedIn(async (c) => {
      const { rows } = await c.query(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'profile'
           and column_name in ('locale', 'calendar', 'planning_ratio', 'default_buffer_days', 'plan_epoch',
                               'progress_epoch')`,
      );
      expect(rows).toEqual([]);
    });
  });

  it('rejects an unknown time zone and accepts a real one', async () => {
    await signedIn(async (c, id) => {
      const bad = await attempt(
        c,
        `update public.profile set timezone = 'Mars/Olympus_Mons' where owner_id = $1`,
        [id],
      );
      expect(bad).toMatchObject({ ok: false, code: CHECK });
      const good = await attempt(
        c,
        `update public.profile set timezone = 'Europe/London' where owner_id = $1`,
        [id],
      );
      expect(good.ok).toBe(true);
    });
  });

  it('moves updated_at forward on every change', async () => {
    await signedIn(async (c, id) => {
      // now() is fixed inside a transaction, so push created_at into the past first (as the database owner:
      // she has no right to rewrite it).
      await actAsOwner(c);
      await c.query(`update public.profile set created_at = now() - interval '1 day' where owner_id = $1`, [
        id,
      ]);
      await actAs(c, id);
      await c.query(`update public.profile set name = 'Dagmawit' where owner_id = $1`, [id]);
      const { rows } = await c.query(
        `select updated_at > created_at as moved from public.profile where owner_id = $1`,
        [id],
      );
      expect(rows[0]!.moved).toBe(true);
    });
  });
});
