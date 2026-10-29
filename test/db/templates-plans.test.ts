import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { actAs, actAsOwner, attempt, createUser, inTransaction } from './helpers';

// Stage 3 in the database: templates, an order's tasks, applying a template, the planning epoch, and plans.
// The contract is docs/planning.md.

const CHECK = '23514';
const UNIQUE = '23505';
const FOREIGN_KEY = '23503';
const NO_RIGHT = '42501';
const NOT_FOUND = 'P0002';

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
const inDays = async (c: PoolClient, n: number) =>
  (
    await one<{ d: string }>(
      c,
      `select to_char(app.today_for((select auth.uid())) + $1::int, 'YYYY-MM-DD') as d`,
      [n],
    )
  ).d;

const epoch = async (c: PoolClient) =>
  Number((await one<{ e: string }>(c, `select plan_epoch as e from public.profile`)).e);

const progress = async (c: PoolClient) =>
  Number((await one<{ e: string }>(c, `select progress_epoch as e from public.profile`)).e);

const templateId = async (c: PoolClient, name: string) =>
  (await one<{ id: string }>(c, `select id from public.template where name = $1`, [name])).id;

/** A draft order with one garment, and its ids. */
async function addOrder(c: PoolClient, garment = 'Bridal gown') {
  const client = (
    await one<{ id: string }>(c, `insert into public.client (name) values ('Selam') returning id`)
  ).id;
  const order = (
    await one<{ id: string }>(
      c,
      `insert into public.orders (client_id, delivery_on) values ($1, $2) returning id`,
      [client, await inDays(c, 40)],
    )
  ).id;
  const item = (
    await one<{ id: string }>(
      c,
      `insert into public.order_item (order_id, garment_type) values ($1, $2) returning id`,
      [order, garment],
    )
  ).id;
  return { client, order, item };
}

async function addTask(
  c: PoolClient,
  order: string,
  item: string,
  title: string,
  kind = 'work',
  minutes: number | null = 60,
) {
  return (
    await one<{ id: string }>(
      c,
      `insert into public.task (order_id, order_item_id, title, kind, minutes, days)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [
        order,
        item,
        title,
        kind,
        kind === 'work' || kind === 'fixed' ? minutes : null,
        kind === 'wait' ? 1 : null,
      ],
    )
  ).id;
}

const confirm = (c: PoolClient, order: string) =>
  c.query(`update public.orders set status = 'active' where id = $1`, [order]);

// ---------------------------------------------------------------------------------------------
describe('her library', () => {
  it('starts with three templates, whole: tasks, links and what they wait for', async () => {
    await signedIn(async (c) => {
      const { rows } = await c.query(
        `select t.name, t.version,
           (select count(*)::int from public.template_task k where k.template_id = t.id) as tasks,
           (select count(*)::int from public.template_edge e where e.template_id = t.id) as links,
           (select count(*)::int from public.template_prerequisite p where p.template_id = t.id) as items,
           (select count(*)::int from public.template_requires r where r.template_id = t.id) as needs
         from public.template t order by t.name`,
      );
      expect(rows).toEqual([
        { name: 'Bridal gown', version: 1, tasks: 13, links: 13, items: 6, needs: 6 },
        { name: 'Evening dress', version: 1, tasks: 9, links: 8, items: 5, needs: 5 },
        { name: 'Suit alteration', version: 1, tasks: 5, links: 4, items: 1, needs: 1 },
      ]);
    });
  });

  it('keeps one designer’s templates from another', async () => {
    await inTransaction(async (c) => {
      const a = await createUser(c, 'a@example.test');
      const b = await createUser(c, 'b@example.test');
      await actAs(c, a);
      const mine = await templateId(c, 'Bridal gown');
      await actAs(c, b);
      expect((await c.query(`select * from public.template where id = $1`, [mine])).rowCount).toBe(0);
      const attach = await attempt(
        c,
        `insert into public.template_task (template_id, title, kind, minutes) values ($1, 'Sneak', 'work', 10)`,
        [mine],
      );
      expect(attach).toMatchObject({ ok: false, code: FOREIGN_KEY });
    });
  });

  it('refuses two templates with the same name, in any capitals', async () => {
    await signedIn(async (c) => {
      const r = await attempt(
        c,
        `insert into public.template (name, garment_type) values ('BRIDAL GOWN', 'x')`,
      );
      expect(r).toMatchObject({ ok: false, code: UNIQUE });
    });
  });

  it('holds each kind of task to what it needs', async () => {
    await signedIn(async (c) => {
      const t = await templateId(c, 'Bridal gown');
      const bad = [
        [`'work', null, null`, 'work with no minutes'],
        [`'work', 60, 1`, 'work with days'],
        [`'wait', 60, null`, 'a wait with minutes and no days'],
        [`'fixed', null, null`, 'an appointment with no length'],
        [`'milestone', 10, null`, 'a milestone with minutes'],
        [`'work', 6001, null`, 'more than 100 hours'],
        [`'wait', null, 61`, 'a wait of more than 60 days'],
        [`'sewing', 60, null`, 'an unknown kind'],
      ];
      for (const [values, what] of bad) {
        const r = await attempt(
          c,
          `insert into public.template_task (template_id, title, kind, minutes, days) values ($1, 'T', ${values})`,
          [t],
        );
        expect(r, what).toMatchObject({ ok: false, code: CHECK });
      }
    });
  });

  it('links only tasks of the same template, never a task to itself, never in a loop', async () => {
    await signedIn(async (c) => {
      const gown = await templateId(c, 'Bridal gown');
      const dress = await templateId(c, 'Evening dress');
      const task = async (t: string, title: string) =>
        (
          await one<{ id: string }>(
            c,
            `select id from public.template_task where template_id = $1 and title = $2`,
            [t, title],
          )
        ).id;
      const pattern = await task(gown, 'Draft the pattern');
      const ready = await task(gown, 'Ready for handover');
      const dressCut = await task(dress, 'Cut fabric and lining');

      const across = await attempt(
        c,
        `insert into public.template_edge (template_id, from_task, to_task) values ($1, $2, $3)`,
        [gown, pattern, dressCut],
      );
      expect(across).toMatchObject({ ok: false, code: FOREIGN_KEY });
      const self = await attempt(
        c,
        `insert into public.template_edge (template_id, from_task, to_task) values ($1, $2, $2)`,
        [gown, pattern],
      );
      expect(self).toMatchObject({ ok: false, code: CHECK });
      const loop = await attempt(
        c,
        `insert into public.template_edge (template_id, from_task, to_task) values ($1, $2, $3)`,
        [gown, ready, pattern],
      );
      expect(loop).toMatchObject({ ok: false, code: CHECK });
      expect(loop.ok ? '' : loop.message).toContain('loop');
    });
  });

  it('counts a new version for every change to it or its parts, and only then', async () => {
    await signedIn(async (c) => {
      const t = await templateId(c, 'Suit alteration');
      const version = async () =>
        (await one<{ v: number }>(c, `select version as v from public.template where id = $1`, [t])).v;
      expect(await version()).toBe(1);
      await c.query(`update public.template set notes = notes where id = $1`, [t]);
      expect(await version(), 'a change to nothing').toBe(1);
      await c.query(`update public.template set name = 'Suit alteration (men)' where id = $1`, [t]);
      expect(await version()).toBe(2);
      await c.query(
        `update public.template_task set minutes = 40 where template_id = $1 and kind = 'fixed'`,
        [t],
      );
      expect(await version()).toBe(3);
      const added = await one<{ id: string }>(
        c,
        `insert into public.template_task (template_id, title, kind, minutes) values ($1, 'Sew on buttons', 'work', 20) returning id`,
        [t],
      );
      expect(await version()).toBe(4);
      await c.query(`delete from public.template_task where id = $1`, [added.id]);
      expect(await version()).toBe(5);
      await c.query(`update public.template_prerequisite set blocking = false where template_id = $1`, [t]);
      expect(await version()).toBe(6);
    });
  });

  it('does not let her write the version herself', async () => {
    await signedIn(async (c) => {
      const t = await templateId(c, 'Bridal gown');
      expect(await attempt(c, `update public.template set version = 9 where id = $1`, [t])).toMatchObject({
        ok: false,
        code: NO_RIGHT,
      });
    });
  });
});

// ---------------------------------------------------------------------------------------------
describe('applying a template to a garment', () => {
  it('copies the tasks, the links and what each waits for, and records the template', async () => {
    await signedIn(async (c) => {
      const { order, item } = await addOrder(c);
      const t = await templateId(c, 'Bridal gown');
      const n = await one<{ n: number }>(c, `select public.apply_template($1, $2) as n`, [item, t]);
      expect(n.n).toBe(13);

      const counts = await one(
        c,
        `select (select count(*)::int from public.task where order_id = $1) as tasks,
                (select count(*)::int from public.task_edge where order_id = $1) as links,
                (select count(*)::int from public.task_requires where order_id = $1) as needs,
                (select count(*)::int from public.prerequisite where order_id = $1) as items`,
        [order],
      );
      expect(counts).toEqual({ tasks: 13, links: 13, needs: 6, items: 6 });

      // The order of the template, and the right links.
      const titles = (
        await c.query(`select title from public.task where order_id = $1 order by sort`, [order])
      ).rows.map((r) => r.title);
      expect(titles[0]).toBe('Confirm design and neckline with the client');
      expect(titles.at(-1)).toBe('Ready for handover');
      const lace = await one<{ label: string }>(
        c,
        `select p.label from public.task_requires r
           join public.task k on k.id = r.task_id join public.prerequisite p on p.id = r.prerequisite_id
         where k.title = 'Apply the lace'`,
      );
      expect(lace.label).toBe('Lace');

      const garment = await one(
        c,
        `select template_id, template_version from public.order_item where id = $1`,
        [item],
      );
      expect(garment).toEqual({ template_id: t, template_version: 1 });
      await actAsOwner(c);
      const logged = await one<{ details: unknown }>(
        c,
        `select details from public.activity_log where order_id = $1 and action = 'template_applied'`,
        [order],
      );
      expect(logged.details).toEqual({
        garment_type: 'Bridal gown',
        template: 'Bridal gown',
        version: 1,
        tasks: 13,
      });
    });
  });

  it('links what the order already waits for instead of listing it twice', async () => {
    await signedIn(async (c) => {
      const { order, item } = await addOrder(c);
      // Added in Stage 2 by hand, in other capitals, already ordered.
      await c.query(
        `insert into public.prerequisite (order_id, kind, label, state) values ($1, 'material', 'LACE', 'ordered')`,
        [order],
      );
      await c.query(`select public.apply_template($1, $2)`, [item, await templateId(c, 'Bridal gown')]);
      const { rows } = await c.query(
        `select label, state from public.prerequisite where order_id = $1 and lower(label) = 'lace'`,
        [order],
      );
      expect(rows).toEqual([{ label: 'LACE', state: 'ordered' }]);
    });
  });

  it('refuses a garment that already has tasks', async () => {
    await signedIn(async (c) => {
      const { item } = await addOrder(c);
      const t = await templateId(c, 'Evening dress');
      await c.query(`select public.apply_template($1, $2)`, [item, t]);
      const again = await attempt(c, `select public.apply_template($1, $2)`, [item, t]);
      expect(again).toMatchObject({ ok: false, code: CHECK });
      expect(again.ok ? '' : again.message).toContain('already has tasks');
    });
  });

  it('gives each garment of an order its own tasks', async () => {
    await signedIn(async (c) => {
      const { order, item } = await addOrder(c);
      const second = await one<{ id: string }>(
        c,
        `insert into public.order_item (order_id, garment_type) values ($1, 'Evening dress') returning id`,
        [order],
      );
      await c.query(`select public.apply_template($1, $2)`, [item, await templateId(c, 'Bridal gown')]);
      await c.query(`select public.apply_template($1, $2)`, [
        second.id,
        await templateId(c, 'Evening dress'),
      ]);
      const { rows } = await c.query(
        `select order_item_id, count(*)::int as n from public.task where order_id = $1 group by 1 order by 2`,
        [order],
      );
      expect(rows).toEqual([
        { order_item_id: second.id, n: 9 },
        { order_item_id: item, n: 13 },
      ]);
      // Shared items are not repeated: both need "Main fabric".
      const fabric = await one<{ n: number }>(
        c,
        `select count(*)::int as n from public.prerequisite where order_id = $1 and label = 'Main fabric'`,
        [order],
      );
      expect(fabric.n).toBe(1);
    });
  });

  it('is not changed by a later edit to the template, nor by deleting it', async () => {
    await signedIn(async (c) => {
      const { order, item } = await addOrder(c);
      const t = await templateId(c, 'Suit alteration');
      await c.query(`select public.apply_template($1, $2)`, [item, t]);
      await c.query(
        `update public.template_task set minutes = 999 where template_id = $1 and kind = 'work'`,
        [t],
      );
      const { rows } = await c.query(
        `select distinct minutes from public.task where order_id = $1 and kind = 'work' order by 1`,
        [order],
      );
      expect(rows.map((r) => r.minutes)).toEqual([45, 60, 150]);
      await c.query(`delete from public.template where id = $1`, [t]);
      expect(
        await one(c, `select template_id, template_version from public.order_item where id = $1`, [item]),
      ).toEqual({
        template_id: null,
        template_version: 1,
      });
    });
  });

  it('works only on her own garments and templates', async () => {
    await inTransaction(async (c) => {
      const a = await createUser(c, 'a@example.test');
      const b = await createUser(c, 'b@example.test');
      await actAs(c, a);
      const { item } = await addOrder(c);
      const aTemplate = await templateId(c, 'Bridal gown');
      await actAs(c, b);
      const bTemplate = await templateId(c, 'Bridal gown');
      expect(await attempt(c, `select public.apply_template($1, $2)`, [item, bTemplate])).toMatchObject({
        ok: false,
        code: NOT_FOUND,
      });
      const { item: bItem } = await addOrder(c);
      expect(await attempt(c, `select public.apply_template($1, $2)`, [bItem, aTemplate])).toMatchObject({
        ok: false,
        code: NOT_FOUND,
      });
    });
  });

  it('refuses a delivered or cancelled order, and she cannot record a template by hand', async () => {
    await signedIn(async (c) => {
      const { order, item } = await addOrder(c);
      await c.query(`update public.orders set status = 'cancelled' where id = $1`, [order]);
      expect(
        await attempt(c, `select public.apply_template($1, $2)`, [item, await templateId(c, 'Bridal gown')]),
      ).toMatchObject({
        ok: false,
        code: CHECK,
      });
      expect(
        await attempt(c, `update public.order_item set template_version = 3 where id = $1`, [item]),
      ).toMatchObject({ ok: false, code: NO_RIGHT });
    });
  });
});

// ---------------------------------------------------------------------------------------------
describe('an order’s tasks', () => {
  it('holds each kind to what it needs, and an appointment’s day and time come together', async () => {
    await signedIn(async (c) => {
      const { order, item } = await addOrder(c);
      const insert = (cols: string, values: string) =>
        attempt(
          c,
          `insert into public.task (order_id, order_item_id, title, ${cols}) values ($1, $2, 'T', ${values})`,
          [order, item],
        );
      expect(
        await insert(`kind, minutes, fixed_on`, `'fixed', 60, '2030-01-01'`),
        'day with no time',
      ).toMatchObject({
        ok: false,
        code: CHECK,
      });
      expect(
        await insert(`kind, minutes, fixed_on, fixed_time`, `'work', 60, '2030-01-01', '10:00'`),
        'work with a day',
      ).toMatchObject({ ok: false, code: CHECK });
      expect(await insert(`kind, minutes`, `'fixed', 60`), 'appointment with no day yet').toMatchObject({
        ok: true,
      });
      expect(
        await insert(`kind, minutes, fixed_on, fixed_time`, `'fixed', 60, '2030-01-01', '10:30'`),
        'appointment with its day',
      ).toMatchObject({ ok: true });
      expect(await insert(`kind`, `'milestone'`)).toMatchObject({ ok: true });
      expect(await insert(`kind, minutes`, `'work', 0`)).toMatchObject({ ok: false, code: CHECK });
    });
  });

  it('belongs to a garment of its own order', async () => {
    await signedIn(async (c) => {
      const first = await addOrder(c);
      const second = await addOrder(c);
      const r = await attempt(
        c,
        `insert into public.task (order_id, order_item_id, title, kind, minutes) values ($1, $2, 'T', 'work', 10)`,
        [first.order, second.item],
      );
      expect(r).toMatchObject({ ok: false, code: FOREIGN_KEY });
    });
  });

  it('links and waits only inside its own order, and refuses a loop', async () => {
    await signedIn(async (c) => {
      const a = await addOrder(c);
      const b = await addOrder(c);
      const cut = await addTask(c, a.order, a.item, 'Cut');
      const sew = await addTask(c, a.order, a.item, 'Sew');
      const press = await addTask(c, a.order, a.item, 'Press');
      const other = await addTask(c, b.order, b.item, 'Other');
      const link = (order: string, from: string, to: string) =>
        attempt(c, `insert into public.task_edge (order_id, from_task, to_task) values ($1, $2, $3)`, [
          order,
          from,
          to,
        ]);
      expect(await link(a.order, cut, sew)).toMatchObject({ ok: true });
      expect(await link(a.order, sew, press)).toMatchObject({ ok: true });
      expect(await link(a.order, press, cut), 'a loop').toMatchObject({ ok: false, code: CHECK });
      expect(await link(a.order, cut, other), 'across orders').toMatchObject({
        ok: false,
        code: FOREIGN_KEY,
      });
      expect(await link(b.order, cut, other), 'across orders, claimed for the other').toMatchObject({
        ok: false,
        code: FOREIGN_KEY,
      });
      const lace = await one<{ id: string }>(
        c,
        `insert into public.prerequisite (order_id, kind, label) values ($1, 'material', 'Lace') returning id`,
        [b.order],
      );
      expect(
        await attempt(
          c,
          `insert into public.task_requires (order_id, task_id, prerequisite_id) values ($1, $2, $3)`,
          [a.order, cut, lace.id],
        ),
        'waiting for another order’s lace',
      ).toMatchObject({ ok: false, code: FOREIGN_KEY });
    });
  });

  it('is frozen with its links and needs when the order is delivered or cancelled', async () => {
    await signedIn(async (c) => {
      const { order, item } = await addOrder(c);
      await c.query(`select public.apply_template($1, $2)`, [item, await templateId(c, 'Suit alteration')]);
      await c.query(`update public.orders set status = 'cancelled' where id = $1`, [order]);
      const changes = [
        `update public.task set minutes = 10 where order_id = $1 and kind = 'work'`,
        `delete from public.task where order_id = $1`,
        `update public.task_edge set lag_days = 1 where order_id = $1`,
        `delete from public.task_edge where order_id = $1`,
        `delete from public.task_requires where order_id = $1`,
      ];
      for (const sql of changes)
        expect(await attempt(c, sql, [order]), sql).toMatchObject({ ok: false, code: CHECK });
    });
  });

  it('is invisible to another designer', async () => {
    await inTransaction(async (c) => {
      const a = await createUser(c, 'a@example.test');
      const b = await createUser(c, 'b@example.test');
      await actAs(c, a);
      const { order, item } = await addOrder(c);
      await c.query(`select public.apply_template($1, $2)`, [item, await templateId(c, 'Bridal gown')]);
      await actAs(c, b);
      for (const t of ['task', 'task_edge', 'task_requires']) {
        expect((await c.query(`select 1 from public.${t} where order_id = $1`, [order])).rowCount, t).toBe(0);
        expect(await attempt(c, `delete from public.${t} where order_id = $1`, [order]), t).toMatchObject({
          ok: true,
          rowCount: 0,
        });
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------
describe('the planning epoch', () => {
  it('rises whenever a fact the engine reads changes', async () => {
    await signedIn(async (c) => {
      const { order, item } = await addOrder(c);
      const changes: [string, string, unknown[]][] = [];
      const task = await addTask(c, order, item, 'Cut');
      const sew = await addTask(c, order, item, 'Sew');
      const lace = (
        await one<{ id: string }>(
          c,
          `insert into public.prerequisite (order_id, kind, label) values ($1, 'material', 'Lace') returning id`,
          [order],
        )
      ).id;
      changes.push(
        [
          'a task is added',
          `insert into public.task (order_id, order_item_id, title, kind) values ($1, $2, 'M', 'milestone')`,
          [order, item],
        ],
        ['a task is renamed', `update public.task set title = 'Cut out' where id = $1`, [task]],
        ['an estimate changes', `update public.task set minutes = 90 where id = $1`, [task]],
        [
          'a link is added',
          `insert into public.task_edge (order_id, from_task, to_task) values ($1, $2, $3)`,
          [order, task, sew],
        ],
        ['a rest changes', `update public.task_edge set lag_days = 1 where from_task = $1`, [task]],
        [
          'a need is added',
          `insert into public.task_requires (order_id, task_id, prerequisite_id) values ($1, $2, $3)`,
          [order, task, lace],
        ],
        ['a need is removed', `delete from public.task_requires where task_id = $1`, [task]],
        ['a link is removed', `delete from public.task_edge where from_task = $1`, [task]],
        ['an item is ordered', `update public.prerequisite set state = 'ordered' where id = $1`, [lace]],
        [
          'an item gets a date',
          `update public.prerequisite set expected_on = '2030-01-01' where id = $1`,
          [lace],
        ],
        ['an item stops blocking', `update public.prerequisite set blocking = false where id = $1`, [lace]],
        ['an item is renamed', `update public.prerequisite set label = 'French lace' where id = $1`, [lace]],
        [
          'an item is added',
          `insert into public.prerequisite (order_id, kind, label) values ($1, 'other', 'Shoes')`,
          [order],
        ],
        ['an item is removed', `delete from public.prerequisite where id = $1`, [lace]],
        ['the order is confirmed', `update public.orders set status = 'active' where id = $1`, [order]],
        [
          'the handover moves',
          `update public.orders set delivery_on = delivery_on + 1 where id = $1`,
          [order],
        ],
        ['the buffer changes', `update public.orders set buffer_days = 4 where id = $1`, [order]],
        ['a task is removed', `delete from public.task where id = $1`, [task]],
        [
          'her week changes',
          `insert into public.work_week (weekday, start_time, end_time) values (2, '09:00', '17:00')`,
          [],
        ],
        ['a working day changes', `update public.work_week set end_time = '16:00' where weekday = 2`, []],
        [
          'a day off is added',
          `insert into public.calendar_exception (day, minutes_available) values ('2030-01-02', 0)`,
          [],
        ],
        ['a day off is removed', `delete from public.calendar_exception where day = '2030-01-02'`, []],
        ['her planning ratio changes', `update public.profile set planning_ratio = 0.6`, []],
        ['her time zone changes', `update public.profile set timezone = 'Europe/London'`, []],
        [
          'an order is created',
          `insert into public.orders (client_id, delivery_on) select client_id, delivery_on from public.orders where id = $1`,
          [order],
        ],
      );
      for (const [what, sql, params] of changes) {
        const before = await epoch(c);
        await c.query(sql, params);
        expect(await epoch(c), what).toBeGreaterThan(before);
      }
    });
  });

  it('stays still for what the engine does not read', async () => {
    await signedIn(async (c) => {
      const { order, item, client } = await addOrder(c);
      const lace = (
        await one<{ id: string }>(
          c,
          `insert into public.prerequisite (order_id, kind, label) values ($1, 'material', 'Lace') returning id`,
          [order],
        )
      ).id;
      const quiet: [string, string, unknown[]][] = [
        ['order notes', `update public.orders set notes = 'Pays in two parts' where id = $1`, [order]],
        ['a garment brief', `update public.order_item set brief = 'Ivory' where id = $1`, [item]],
        ['an item note', `update public.prerequisite set note = 'From the market' where id = $1`, [lace]],
        ['a client', `update public.client set phone = '0911 22 33 44' where id = $1`, [client]],
        ['her name', `update public.profile set name = 'Dagi'`, []],
        ['a template', `update public.template set notes = 'mine' where name = 'Bridal gown'`, []],
      ];
      for (const [what, sql, params] of quiet) {
        const before = await epoch(c);
        await c.query(sql, params);
        expect(await epoch(c), what).toBe(before);
      }
    });
  });

  it('cannot be set by her', async () => {
    await signedIn(async (c) => {
      expect(await attempt(c, `update public.profile set plan_epoch = 0`)).toMatchObject({
        ok: false,
        code: NO_RIGHT,
      });
    });
  });
});

// ---------------------------------------------------------------------------------------------
describe('plans', () => {
  /** An active order with one planned task, and a proposal for it. */
  async function proposalFor(c: PoolClient) {
    const { order, item } = await addOrder(c);
    const task = await addTask(c, order, item, 'Cut', 'work', 120);
    await confirm(c, order);
    return { order, task, propose: () => propose(c, task, order) };
  }

  async function propose(
    c: PoolClient,
    task: string,
    order: string,
    over: { epoch?: number; day?: string } = {},
  ) {
    const day = over.day ?? (await today(c));
    return attempt(c, `select public.save_proposal($1, $2, $3, $4, $5) as n`, [
      over.epoch ?? (await epoch(c)),
      await progress(c),
      day,
      JSON.stringify({ orders: [{ id: order, state: 'on_track', readyOn: day }], tasks: [], warnings: [] }),
      JSON.stringify([{ task_id: task, day, minutes: 120, rank: 1, at_time: null }]),
    ]);
  }

  const statuses = async (c: PoolClient) =>
    (await c.query(`select number, status, base_number from public.plan_version order by number`)).rows;

  it('stores a proposal with its slots, numbered from 1', async () => {
    await signedIn(async (c) => {
      const p = await proposalFor(c);
      expect(await p.propose()).toMatchObject({ ok: true, rows: [{ n: 1 }] });
      expect(await p.propose()).toMatchObject({ ok: true, rows: [{ n: 2 }] });
      expect(await statuses(c)).toEqual([
        { number: 1, status: 'proposed', base_number: null },
        { number: 2, status: 'proposed', base_number: null },
      ]);
      const slots = await one<{ n: number }>(c, `select count(*)::int as n from public.plan_slot`);
      expect(slots.n).toBe(2);
    });
  });

  it('refuses to store a proposal made on facts that changed, or for another day', async () => {
    await signedIn(async (c) => {
      const p = await proposalFor(c);
      const stale = await propose(c, p.task, p.order, { epoch: (await epoch(c)) - 1 });
      expect(stale).toMatchObject({ ok: false, code: CHECK });
      const yesterday = await propose(c, p.task, p.order, { day: await inDays(c, -1) });
      expect(yesterday).toMatchObject({ ok: false, code: CHECK });
    });
  });

  it('cannot be written, changed or removed by hand', async () => {
    await signedIn(async (c) => {
      const p = await proposalFor(c);
      await p.propose();
      const tries = [
        `insert into public.plan_version (number, epoch, made_for, result) values (9, 0, current_date, '{}')`,
        `update public.plan_version set status = 'approved'`,
        `delete from public.plan_version`,
        `update public.plan_slot set minutes = 1`,
        `delete from public.plan_slot`,
      ];
      for (const sql of tries)
        expect(await attempt(c, sql), sql).toMatchObject({ ok: false, code: NO_RIGHT });
    });
  });

  it('approves one plan, replaces the one before and every other open proposal', async () => {
    await signedIn(async (c) => {
      const p = await proposalFor(c);
      await p.propose();
      await p.propose();
      expect(await attempt(c, `select public.approve_plan(1)`)).toMatchObject({ ok: true });
      expect(await statuses(c)).toEqual([
        { number: 1, status: 'approved', base_number: null },
        { number: 2, status: 'superseded', base_number: null },
      ]);
      await p.propose();
      expect(await attempt(c, `select public.approve_plan(3)`)).toMatchObject({ ok: true });
      expect(await statuses(c)).toEqual([
        { number: 1, status: 'superseded', base_number: null },
        { number: 2, status: 'superseded', base_number: null },
        { number: 3, status: 'approved', base_number: 1 },
      ]);
    });
  });

  it('refuses each kind of stale proposal, with a sentence she can act on', async () => {
    await signedIn(async (c, id) => {
      const p = await proposalFor(c);
      await p.propose(); // 1
      await c.query(`update public.task set minutes = 150 where id = $1`, [p.task]);
      const changed = await attempt(c, `select public.approve_plan(1)`);
      expect(changed).toMatchObject({ ok: false, code: CHECK });
      expect(changed.ok ? '' : changed.message).toContain('something has changed');

      await p.propose(); // 2
      await actAsOwner(c);
      await c.query(
        `update public.plan_version set made_for = made_for - 1 where number = 2 and owner_id = $1`,
        [id],
      );
      await actAs(c, id);
      const old = await attempt(c, `select public.approve_plan(2)`);
      expect(old.ok ? '' : old.message).toContain('earlier day');

      await p.propose(); // 3
      await p.propose(); // 4
      expect(await attempt(c, `select public.approve_plan(3)`)).toMatchObject({ ok: true });
      const replaced = await attempt(c, `select public.approve_plan(4)`);
      expect(replaced.ok ? '' : replaced.message).toContain('already superseded');

      // Even if a proposal were open while another plan was approved after it was made.
      await actAsOwner(c);
      await c.query(
        `update public.plan_version set status = 'proposed', decided_at = null where number = 4 and owner_id = $1`,
        [id],
      );
      await actAs(c, id);
      const base = await attempt(c, `select public.approve_plan(4)`);
      expect(base.ok ? '' : base.message).toContain('another plan was approved');
      expect(await attempt(c, `select public.approve_plan(99)`)).toMatchObject({
        ok: false,
        code: NOT_FOUND,
      });
    });
  });

  it('rejects only an open proposal, and a rejected one cannot be approved', async () => {
    await signedIn(async (c) => {
      const p = await proposalFor(c);
      await p.propose();
      expect(await attempt(c, `select public.reject_plan(1)`)).toMatchObject({ ok: true });
      expect(await attempt(c, `select public.reject_plan(1)`)).toMatchObject({ ok: false, code: CHECK });
      expect(await attempt(c, `select public.approve_plan(1)`)).toMatchObject({ ok: false, code: CHECK });
    });
  });

  it('never has two approved plans, even for the database owner', async () => {
    await signedIn(async (c, id) => {
      const p = await proposalFor(c);
      await p.propose();
      await p.propose();
      await c.query(`select public.approve_plan(1)`);
      await actAsOwner(c);
      const r = await attempt(
        c,
        `update public.plan_version set status = 'approved' where number = 2 and owner_id = $1`,
        [id],
      );
      expect(r).toMatchObject({ ok: false, code: UNIQUE });
    });
  });

  it('writes each order’s state and ready day into its history when approved', async () => {
    await signedIn(async (c) => {
      const p = await proposalFor(c);
      await p.propose();
      await c.query(`select public.approve_plan(1)`);
      const day = await today(c);
      await actAsOwner(c);
      const row = await one<{ details: unknown }>(
        c,
        `select details from public.activity_log where order_id = $1 and action = 'plan_approved'`,
        [p.order],
      );
      expect(row.details).toEqual({ number: 1, state: 'on_track', ready_on: day });
    });
  });

  it('keeps one designer’s plans from another', async () => {
    await inTransaction(async (c) => {
      const a = await createUser(c, 'a@example.test');
      const b = await createUser(c, 'b@example.test');
      await actAs(c, a);
      const p = await proposalFor(c);
      await p.propose();
      await actAs(c, b);
      expect((await c.query(`select 1 from public.plan_version`)).rowCount).toBe(0);
      expect((await c.query(`select 1 from public.plan_slot`)).rowCount).toBe(0);
      expect(await attempt(c, `select public.approve_plan(1)`)).toMatchObject({ ok: false, code: NOT_FOUND });
      expect(await attempt(c, `select public.reject_plan(1)`)).toMatchObject({ ok: false, code: CHECK });
      // B cannot put A's task into a plan of B's.
      const own = await proposalFor(c);
      const sneaky = await propose(c, p.task, own.order);
      expect(sneaky).toMatchObject({ ok: false, code: FOREIGN_KEY });
    });
  });
});
