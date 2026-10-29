import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { actAs, actAsOwner, attempt, createUser, inTransaction } from './helpers';

// Stage 4 in the database: progress on a task, studio work, the two counters, and approval after progress.
// The contract is docs/my-day.md.

const CHECK = '23514';
const NO_RIGHT = '42501';

async function signedIn<T>(fn: (c: PoolClient, userId: string) => Promise<T>) {
  return inTransaction(async (c) => {
    const id = await createUser(c, 'a@example.test', 'Dagmawit');
    await actAs(c, id);
    return fn(c, id);
  });
}

const one = async <T = Record<string, unknown>>(c: PoolClient, sql: string, params: unknown[] = []) =>
  (await c.query(sql, params)).rows[0] as T;
const today = async (c: PoolClient) =>
  (await one<{ d: string }>(c, `select to_char(app.today_for((select auth.uid())), 'YYYY-MM-DD') as d`)).d;
const counters = async (c: PoolClient) => {
  const r = await one<{ p: string; g: string }>(
    c,
    `select plan_epoch as p, progress_epoch as g from public.profile`,
  );
  return { plan: Number(r.p), progress: Number(r.g) };
};

/** An active order with one garment and a work task of 2 hours, an appointment and a milestone. */
async function setUp(c: PoolClient) {
  const client = (
    await one<{ id: string }>(c, `insert into public.client (name) values ('Selam') returning id`)
  ).id;
  const order = (
    await one<{ id: string }>(
      c,
      `insert into public.orders (client_id, delivery_on) values ($1, app.today_for((select auth.uid())) + 30) returning id`,
      [client],
    )
  ).id;
  const item = (
    await one<{ id: string }>(
      c,
      `insert into public.order_item (order_id, garment_type) values ($1, 'Bridal gown') returning id`,
      [order],
    )
  ).id;
  await c.query(`update public.orders set status = 'active' where id = $1`, [order]);
  const add = async (title: string, kind: string, minutes: number | null) =>
    (
      await one<{ id: string }>(
        c,
        `insert into public.task (order_id, order_item_id, title, kind, minutes) values ($1, $2, $3, $4, $5) returning id`,
        [order, item, title, kind, minutes],
      )
    ).id;
  return {
    order,
    item,
    cut: await add('Cut', 'work', 120),
    fitting: await add('Fitting', 'fixed', 60),
    ready: await add('Ready', 'milestone', null),
  };
}

const task = (c: PoolClient, id: string) =>
  one<Record<string, unknown>>(
    c,
    `select status, done_on::text, actual_minutes, remaining_minutes, started_at is not null as started, hold_reason
     from public.task where id = $1`,
    [id],
  );

describe('progress on a task', () => {
  it('starts, keeps what is left, and is finished with the time it took', async () => {
    await signedIn(async (c) => {
      const t = await setUp(c);
      await c.query(`update public.task set status = 'in_progress', remaining_minutes = 45 where id = $1`, [
        t.cut,
      ]);
      expect(await task(c, t.cut)).toMatchObject({
        status: 'in_progress',
        remaining_minutes: 45,
        started: true,
      });
      await c.query(
        `update public.task set status = 'done', done_on = app.today_for(owner_id), actual_minutes = 150 where id = $1`,
        [t.cut],
      );
      // Leaving "in progress" forgets what was left; the estimate is untouched.
      expect(await task(c, t.cut)).toMatchObject({
        status: 'done',
        done_on: await today(c),
        actual_minutes: 150,
        remaining_minutes: null,
      });
      expect(
        (await one<{ m: number }>(c, `select minutes as m from public.task where id = $1`, [t.cut])).m,
      ).toBe(120);
    });
  });

  it('forgets the day and the time when a done task is opened again, and the start when it is reset', async () => {
    await signedIn(async (c) => {
      const t = await setUp(c);
      await c.query(
        `update public.task set status = 'done', done_on = app.today_for(owner_id), actual_minutes = 100 where id = $1`,
        [t.cut],
      );
      await c.query(`update public.task set status = 'in_progress' where id = $1`, [t.cut]);
      expect(await task(c, t.cut)).toMatchObject({
        status: 'in_progress',
        done_on: null,
        actual_minutes: null,
        started: true,
      });
      await c.query(`update public.task set status = 'not_started' where id = $1`, [t.cut]);
      expect(await task(c, t.cut)).toMatchObject({ status: 'not_started', started: false });
    });
  });

  it('refuses half-states and a day that has not come', async () => {
    await signedIn(async (c) => {
      const t = await setUp(c);
      const tries: [string, string, unknown[]][] = [
        [
          'done with no day',
          `update public.task set status = 'done', actual_minutes = 10 where id = $1`,
          [t.cut],
        ],
        [
          'work done with no time',
          `update public.task set status = 'done', done_on = app.today_for(owner_id) where id = $1`,
          [t.cut],
        ],
        [
          'a milestone with a time',
          `update public.task set status = 'done', done_on = app.today_for(owner_id), actual_minutes = 5 where id = $1`,
          [t.ready],
        ],
        [
          'what is left on a task not started',
          `update public.task set remaining_minutes = 10 where id = $1`,
          [t.cut],
        ],
        [
          'finished tomorrow',
          `update public.task set status = 'done', done_on = app.today_for(owner_id) + 1, actual_minutes = 10 where id = $1`,
          [t.cut],
        ],
        ['an unknown status', `update public.task set status = 'paused' where id = $1`, [t.cut]],
        ['a hold with spaces around', `update public.task set hold_reason = ' away ' where id = $1`, [t.cut]],
      ];
      for (const [what, sql, params] of tries)
        expect(await attempt(c, sql, params), what).toMatchObject({ ok: false, code: CHECK });
      // A milestone is done with no time.
      expect(
        await attempt(
          c,
          `update public.task set status = 'done', done_on = app.today_for(owner_id) where id = $1`,
          [t.ready],
        ),
      ).toMatchObject({ ok: true });
    });
  });

  it('does not let her write when it was started', async () => {
    await signedIn(async (c) => {
      const t = await setUp(c);
      expect(
        await attempt(c, `update public.task set started_at = now() where id = $1`, [t.cut]),
      ).toMatchObject({
        ok: false,
        code: NO_RIGHT,
      });
    });
  });

  it('is frozen with the order once it is delivered', async () => {
    await signedIn(async (c) => {
      const t = await setUp(c);
      await c.query(
        `update public.orders set status = 'delivered', delivered_on = app.today_for(owner_id) where id = $1`,
        [t.order],
      );
      expect(
        await attempt(c, `update public.task set status = 'in_progress' where id = $1`, [t.cut]),
      ).toMatchObject({
        ok: false,
        code: CHECK,
      });
    });
  });
});

describe('studio work', () => {
  it('may have no order, but never a garment without its order', async () => {
    await signedIn(async (c) => {
      const t = await setUp(c);
      expect(
        await attempt(
          c,
          `insert into public.task (title, kind, minutes) values ('Sharpen the shears', 'work', 20)`,
        ),
      ).toMatchObject({ ok: true });
      expect(
        await attempt(
          c,
          `insert into public.task (order_item_id, title, kind, minutes) values ($1, 'X', 'work', 20)`,
          [t.item],
        ),
      ).toMatchObject({ ok: false, code: CHECK });
      expect(
        await attempt(
          c,
          `insert into public.task (order_id, title, kind, minutes) values ($1, 'X', 'work', 20)`,
          [t.order],
        ),
      ).toMatchObject({ ok: false, code: CHECK });
    });
  });

  it('is invisible to another designer', async () => {
    await inTransaction(async (c) => {
      const a = await createUser(c, 'a@example.test');
      const b = await createUser(c, 'b@example.test');
      await actAs(c, a);
      await c.query(`insert into public.task (title, kind, minutes) values ('Walk-in hem', 'work', 30)`);
      await actAs(c, b);
      expect((await c.query(`select 1 from public.task`)).rowCount).toBe(0);
      expect(await attempt(c, `update public.task set status = 'done'`)).toMatchObject({
        ok: true,
        rowCount: 0,
      });
    });
  });
});

describe('the two counters', () => {
  it('counts progress apart from the shape of the plan', async () => {
    await signedIn(async (c) => {
      const t = await setUp(c);
      const progress: [string, string][] = [
        ['started', `update public.task set status = 'in_progress' where id = $1`],
        ['what is left', `update public.task set remaining_minutes = 30 where id = $1`],
        [
          'done',
          `update public.task set status = 'done', done_on = app.today_for(owner_id), actual_minutes = 90 where id = $1`,
        ],
        ['reopened', `update public.task set status = 'not_started' where id = $1`],
      ];
      for (const [what, sql] of progress) {
        const before = await counters(c);
        await c.query(sql, [t.cut]);
        const after = await counters(c);
        expect(after.progress, what).toBeGreaterThan(before.progress);
        expect(after.plan, what).toBe(before.plan);
      }
      const shape: [string, string][] = [
        ['held', `update public.task set hold_reason = 'Client away' where id = $1`],
        ['released', `update public.task set hold_reason = '' where id = $1`],
        ['estimate', `update public.task set minutes = 130 where id = $1`],
      ];
      for (const [what, sql] of shape) {
        const before = await counters(c);
        await c.query(sql, [t.cut]);
        const after = await counters(c);
        expect(after.plan, what).toBeGreaterThan(before.plan);
        expect(after.progress, what).toBe(before.progress);
      }
    });
  });

  it('cannot be set by her', async () => {
    await signedIn(async (c) => {
      expect(await attempt(c, `update public.profile set progress_epoch = 0`)).toMatchObject({
        ok: false,
        code: NO_RIGHT,
      });
    });
  });
});

describe('a proposal and progress', () => {
  const propose = async (c: PoolClient, task: string, over: { progress?: number } = {}) => {
    const n = await counters(c);
    const day = await today(c);
    return attempt(c, `select public.save_proposal($1, $2, $3, $4, $5) as n`, [
      n.plan,
      over.progress ?? n.progress,
      day,
      JSON.stringify({ orders: [], tasks: [], warnings: [] }),
      JSON.stringify([{ task_id: task, day, minutes: 60, rank: 1, at_time: null }]),
    ]);
  };

  it('stores the progress counter with the proposal, and refuses one made on older progress', async () => {
    await signedIn(async (c) => {
      const t = await setUp(c);
      expect(await propose(c, t.cut)).toMatchObject({ ok: true, rows: [{ n: 1 }] });
      const n = await counters(c);
      expect(
        await one(c, `select progress_epoch::int as p from public.plan_version where number = 1`),
      ).toEqual({
        p: n.progress,
      });
      expect(await propose(c, t.cut, { progress: n.progress - 1 })).toMatchObject({ ok: false, code: CHECK });
    });
  });

  it('cannot be approved once work was marked after it was made', async () => {
    await signedIn(async (c) => {
      const t = await setUp(c);
      await propose(c, t.cut);
      await c.query(`update public.task set status = 'in_progress' where id = $1`, [t.cut]);
      const r = await attempt(c, `select public.approve_plan(1)`);
      expect(r).toMatchObject({ ok: false, code: CHECK });
      expect(r.ok ? '' : r.message).toContain('work was marked');
      await propose(c, t.cut);
      expect(await attempt(c, `select public.approve_plan(2)`)).toMatchObject({ ok: true });
    });
  });
});

describe('history', () => {
  it('records a task done, with the time it took against the estimate, and holds', async () => {
    await signedIn(async (c) => {
      const t = await setUp(c);
      await c.query(
        `update public.task set status = 'done', done_on = app.today_for(owner_id), actual_minutes = 150 where id = $1`,
        [t.cut],
      );
      await c.query(`update public.task set hold_reason = 'Client away' where id = $1`, [t.fitting]);
      await c.query(`update public.task set hold_reason = '' where id = $1`, [t.fitting]);
      // Studio work has no history to write to.
      await c.query(
        `insert into public.task (title, kind, minutes, status) values ('Shears', 'work', 20, 'not_started')`,
      );
      await c.query(`update public.task set status = 'in_progress' where order_id is null`);
      const day = await today(c);
      await actAsOwner(c);
      const { rows } = await c.query(
        `select action, details from public.activity_log where order_id = $1 and action like 'task_%' order by seq`,
        [t.order],
      );
      expect(rows).toEqual([
        { action: 'task_done', details: { title: 'Cut', done_on: day, actual: 150, estimate: 120 } },
        { action: 'task_hold', details: { title: 'Fitting', reason: 'Client away' } },
        { action: 'task_hold', details: { title: 'Fitting', reason: null } },
      ]);
    });
  });
});

describe('a piece of work pinned to a day', () => {
  it('is only her own work, changes the plan, and is frozen with a closed order', async () => {
    await signedIn(async (c) => {
      const t = await setUp(c);
      const before = await counters(c);
      expect(
        await attempt(c, `update public.task set pinned_on = app.today_for(owner_id) + 2 where id = $1`, [
          t.cut,
        ]),
      ).toMatchObject({ ok: true });
      expect((await counters(c)).plan).toBeGreaterThan(before.plan);
      for (const id of [t.fitting, t.ready])
        expect(
          await attempt(c, `update public.task set pinned_on = app.today_for(owner_id) + 2 where id = $1`, [
            id,
          ]),
        ).toMatchObject({ ok: false, code: CHECK });
      await c.query(`update public.orders set status = 'cancelled' where id = $1`, [t.order]);
      expect(
        await attempt(c, `update public.task set pinned_on = null where id = $1`, [t.cut]),
      ).toMatchObject({
        ok: false,
        code: CHECK,
      });
    });
  });
});
