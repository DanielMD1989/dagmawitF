import { describe, expect, it } from 'vitest';
import { addDays } from '../dates';
import { say } from './explain';
import { plan } from './plan';
import { fixed, flatCalendar, follows, milestone, wait, work } from './fixtures/build';
import type { OrderFacts, Plan, PlanInput, Task } from './types';

// Monday 26 October 2026 is day 0. d(1) is Tuesday, d(5) Saturday, d(7) the next Monday.
const MON = '2026-10-26';
const d = (n: number) => addDays(MON, n);

/** A week of Monday to Friday with 300 minutes a day, then a weekend with none. */
const WEEKS = [300, 300, 300, 300, 300, 0, 0];

function input(tasks: Task[], extra: Partial<PlanInput> = {}): PlanInput {
  return {
    today: MON,
    calendar: flatCalendar(MON, WEEKS, 70),
    tasks,
    options: { minSlotMinutes: 30 },
    ...extra,
  };
}

function run(i: PlanInput): Plan {
  const result = plan(i);
  if (!result.ok) throw new Error(`refused: ${result.errors.map((e) => e.message).join(' | ')}`);
  return result.plan;
}

const slotsOf = (p: Plan, id: string) =>
  p.slots.filter((s) => s.taskId === id).map((s) => `${s.day}:${s.minutes}`);
const task = (p: Plan, id: string) => {
  const t = p.tasks.find((x) => x.id === id);
  if (!t) throw new Error(`no task ${id}`);
  return t;
};
const order = (p: Plan, id: string) => {
  const o = p.orders.find((x) => x.id === id);
  if (!o) throw new Error(`no order ${id}`);
  return o;
};
const codes = (p: Plan) => p.warnings.map((w) => w.code);

const ORDER = (id: string, deliveryOn: string, bufferDays = 0): OrderFacts => ({
  id,
  label: `Order ${id}`,
  deliveryOn,
  bufferDays,
});

describe('capacity and placement', () => {
  it('splits a long task across days, a day at a time', () => {
    const p = run(input([work('a', null, 'Long job', 700)]));
    expect(slotsOf(p, 'a')).toEqual([`${d(0)}:300`, `${d(1)}:300`, `${d(2)}:100`]);
    expect(task(p, 'a')).toMatchObject({ start: d(0), finish: d(2), placement: 'planned' });
  });

  it('front-loads: the earliest days with time are used first', () => {
    const p = run(input([work('a', null, 'A', 200), work('b', null, 'B', 200)]));
    expect(slotsOf(p, 'a')).toEqual([`${d(0)}:200`]);
    expect(slotsOf(p, 'b')).toEqual([`${d(0)}:100`, `${d(1)}:100`]);
  });

  it('never puts planned work on a closed day', () => {
    const p = run(input([work('a', null, 'Friday start', 400, { notBefore: d(4) })]));
    expect(slotsOf(p, 'a')).toEqual([`${d(4)}:300`, `${d(7)}:100`]); // Friday, then Monday: the weekend is skipped
  });

  it('does not start before today, even if not-before is earlier', () => {
    const p = run(input([work('a', null, 'A', 100, { notBefore: addDays(MON, -5) })]));
    expect(task(p, 'a').start).toBe(d(0));
  });

  it('respects a not-before day', () => {
    const p = run(input([work('a', null, 'A', 100, { notBefore: d(2) })]));
    expect(slotsOf(p, 'a')).toEqual([`${d(2)}:100`]);
  });

  it('skips a day whose leftover is too small to be worth sewing', () => {
    // Monday: A takes 280, 20 minutes are left. B needs 100, and a 20 minute piece is below the 30 minute floor.
    const p = run(
      input([work('a', null, 'A', 280, { priority: 0 }), work('b', null, 'B', 100, { priority: 1 })]),
    );
    expect(slotsOf(p, 'b')).toEqual([`${d(1)}:100`]);
  });

  it('uses the small leftover when the floor allows it', () => {
    const i = input([work('a', null, 'A', 280, { priority: 0 }), work('b', null, 'B', 100, { priority: 1 })]);
    const p = run({ ...i, options: { minSlotMinutes: 1 } });
    expect(slotsOf(p, 'b')).toEqual([`${d(0)}:20`, `${d(1)}:80`]);
  });

  it('lets the last piece of a task be any size', () => {
    const p = run(input([work('a', null, 'A', 310)]));
    expect(slotsOf(p, 'a')).toEqual([`${d(0)}:300`, `${d(1)}:10`]);
  });

  it('fits a short task entirely in a small gap', () => {
    const p = run(
      input([work('a', null, 'A', 290, { priority: 0 }), work('b', null, 'B', 10, { priority: 1 })]),
    );
    expect(slotsOf(p, 'b')).toEqual([`${d(0)}:10`]);
  });
});

describe('links, lags and waits', () => {
  it('lets a follower share the day when the lag is 0, listing the first task first', () => {
    const p = run(
      input([work('b', null, 'Second', 100), work('a', null, 'First', 100)], { edges: [follows('a', 'b')] }),
    );
    expect(slotsOf(p, 'a')).toEqual([`${d(0)}:100`]);
    expect(slotsOf(p, 'b')).toEqual([`${d(0)}:100`]);
    const ranks = Object.fromEntries(p.slots.map((s) => [s.taskId, s.rank]));
    expect(ranks).toEqual({ a: 1, b: 2 });
  });

  it('keeps a follower days away when the lag asks for rest', () => {
    const p = run(
      input([work('a', null, 'A', 100), work('b', null, 'B', 100)], { edges: [follows('a', 'b', 2)] }),
    );
    expect(task(p, 'b').start).toBe(d(2));
  });

  it('counts the lag in calendar days, so a weekend counts as rest', () => {
    const p = run(
      input([work('a', null, 'A', 100, { notBefore: d(4) }), work('b', null, 'B', 100)], {
        edges: [follows('a', 'b', 2)],
      }),
    );
    expect(task(p, 'a').finish).toBe(d(4)); // Friday
    expect(task(p, 'b').start).toBe(d(7)); // Sat and Sun are rest, but both are closed: next open day is Monday
  });

  it('a wait uses days and none of her minutes, and other work fills the time', () => {
    const p = run(
      input(
        [
          work('a', null, 'Sew', 100),
          wait('w', null, 'Dye dries', 2),
          work('b', null, 'Press', 100),
          work('c', null, 'Other job', 600),
        ],
        { edges: [follows('a', 'w'), follows('w', 'b')] },
      ),
    );
    expect(task(p, 'w')).toMatchObject({ start: d(0), finish: d(2) });
    expect(task(p, 'b').start).toBe(d(2));
    expect(p.slots.some((s) => s.taskId === 'w')).toBe(false);
    // the other job still gets the days the wait covers
    expect(slotsOf(p, 'c').length).toBeGreaterThan(1);
  });

  it('a milestone marks the day its predecessors allow and uses nothing', () => {
    const p = run(
      input([work('a', null, 'A', 100), milestone('m', null, 'Ready for fitting')], {
        edges: [follows('a', 'm', 1)],
      }),
    );
    expect(task(p, 'm')).toMatchObject({ start: d(1), finish: d(1) });
    expect(p.slots.some((s) => s.taskId === 'm')).toBe(false);
  });
});

describe('things she fixed by hand', () => {
  it('keeps a fixed event at its day and time, and takes its length from that day', () => {
    const p = run(input([fixed('f', null, 'Fitting', d(2), '10:30', 60), work('a', null, 'A', 1000)]));
    expect(p.slots.find((s) => s.taskId === 'f')).toMatchObject({
      day: d(2),
      minutes: 60,
      time: '10:30',
      rank: 1,
    });
    // Wednesday has 300, the fitting takes 60, so the job gets 240 that day
    expect(slotsOf(p, 'a')).toContain(`${d(2)}:240`);
    expect(task(p, 'f').placement).toBe('pinned');
  });

  it('may sit on a closed day because she put it there, and says so', () => {
    const p = run(
      input([fixed('f', null, 'Saturday fitting', d(5), '10:00', 60), work('a', null, 'A', 100)]),
    );
    expect(slotsOf(p, 'f')).toEqual([`${d(5)}:60`]);
    expect(codes(p)).toContain('pinned_on_closed_day');
    expect(p.warnings.find((w) => w.code === 'pinned_on_closed_day')?.severity).toBe('info');
    expect(slotsOf(p, 'a').every((s) => !s.startsWith(d(5)))).toBe(true);
  });

  it('adds nothing else to a day her own bookings already overfill', () => {
    const p = run(input([fixed('f', null, 'Long fitting', d(1), '09:00', 400), work('a', null, 'A', 400)]));
    expect(slotsOf(p, 'a')).toEqual([`${d(0)}:300`, `${d(2)}:100`]); // nothing on Tuesday
    expect(codes(p)).toContain('pinned_over_capacity');
  });

  it('keeps locked work exactly where she locked it', () => {
    const p = run(
      input([
        work('lock', null, 'Locked job', 300, {
          lockedSlots: [
            { day: d(1), minutes: 200 },
            { day: d(3), minutes: 100 },
          ],
        }),
        work('a', null, 'A', 600),
      ]),
    );
    expect(slotsOf(p, 'lock')).toEqual([`${d(1)}:200`, `${d(3)}:100`]);
    expect(task(p, 'lock').placement).toBe('pinned');
    // Tuesday has 100 left after the locked 200
    expect(slotsOf(p, 'a')).toContain(`${d(1)}:100`);
  });

  it('does not move a fitting that comes before the work it needs, and says by how much', () => {
    // The fitting is Monday. The bodice (600 minutes) needs Mon 240, Tue 300, Wed 60.
    const p = run(
      input([work('bodice', 'o1', 'Bodice', 600), fixed('fit', 'o1', 'Fitting', d(0), '10:30', 60)], {
        orders: [ORDER('o1', d(14))],
        edges: [follows('bodice', 'fit')],
      }),
    );
    const w = p.warnings.find((x) => x.code === 'fixed_before_predecessor');
    expect(w).toBeDefined();
    expect(w?.severity).toBe('problem');
    expect(w?.numbers).toMatchObject({
      pinnedDay: d(0),
      predecessorFinish: d(2),
      lagDays: 0,
      shortfallDays: 2,
      minutesToFree: 360,
      predecessor: 'Bodice',
    });
    expect(w?.message).toContain('Move "Fitting" to');
    expect(w?.message).toContain('6h 00m');
    expect(slotsOf(p, 'fit')).toEqual([`${d(0)}:60`]);
    expect(order(p, 'o1').state).toBe('at_risk');
  });
});

describe('what is left out, and why', () => {
  it('leaves a held task out and everything after it', () => {
    const p = run(
      input(
        [
          work('a', 'o1', 'A', 100, { hold: 'Client away' }),
          work('b', 'o1', 'B', 100),
          work('c', 'o1', 'C', 100),
        ],
        { orders: [ORDER('o1', d(14))], edges: [follows('a', 'b'), follows('b', 'c')] },
      ),
    );
    expect(p.slots).toHaveLength(0);
    expect(['a', 'b', 'c'].map((id) => task(p, id).placement)).toEqual([
      'unplanned',
      'unplanned',
      'unplanned',
    ]);
    expect(codes(p)).toEqual(expect.arrayContaining(['task_on_hold', 'predecessor_unplanned']));
    expect(p.warnings.find((w) => w.code === 'task_on_hold')?.message).toContain('Client away');
    expect(order(p, 'o1')).toMatchObject({ state: 'at_risk', complete: false, readyOn: null });
  });

  it('leaves an appointment with no day yet out, with the work after it, and names it', () => {
    const fitting: Task = { id: 'fit', orderId: 'o1', title: 'First fitting', kind: 'fixed', minutes: 60 };
    const p = run(
      input([work('bodice', 'o1', 'Bodice', 100), fitting, work('alter', 'o1', 'Alterations', 100)], {
        orders: [ORDER('o1', d(14))],
        edges: [follows('bodice', 'fit'), follows('fit', 'alter')],
      }),
    );
    // The work before it is still planned; the fitting and what follows it are not.
    expect(task(p, 'bodice').placement).toBe('planned');
    expect(task(p, 'fit').placement).toBe('unplanned');
    expect(task(p, 'alter').placement).toBe('unplanned');
    const finding = p.warnings.find((w) => w.code === 'fixed_undated');
    expect(finding).toMatchObject({ severity: 'warning', orderId: 'o1', taskId: 'fit', numbers: {} });
    expect(finding?.message).toBe(say.fixedUndated({ title: 'First fitting' }));
    expect(p.warnings.find((w) => w.code === 'predecessor_unplanned')?.taskId).toBe('alter');
    expect(order(p, 'o1')).toMatchObject({ state: 'at_risk', complete: false, readyOn: null });
  });

  it('lets a hold speak for itself even on an appointment with no day', () => {
    const fitting: Task = {
      id: 'fit',
      orderId: 'o1',
      title: 'Fitting',
      kind: 'fixed',
      minutes: 60,
      hold: 'Client away',
    };
    const p = run(input([fitting], { orders: [ORDER('o1', d(14))] }));
    expect(codes(p)).toContain('task_on_hold');
    expect(codes(p)).not.toContain('fixed_undated');
  });

  it('does not guess a date for something with none', () => {
    const p = run(
      input([work('cut', 'o1', 'Cut', 100), work('sew', 'o1', 'Sew', 100)], {
        orders: [ORDER('o1', d(14))],
        edges: [follows('cut', 'sew')],
        prerequisites: [
          { id: 'silk', orderId: 'o1', label: 'Silk', state: 'needed', expectedOn: null, blocking: true },
        ],
        requirements: [{ taskId: 'cut', prerequisiteId: 'silk' }],
      }),
    );
    expect(task(p, 'cut').placement).toBe('unplanned');
    expect(task(p, 'sew').placement).toBe('unplanned');
    expect(p.warnings.find((w) => w.code === 'prerequisite_undated')?.numbers).toEqual({
      waitingFor: 'Silk',
    });
    expect(order(p, 'o1').state).toBe('at_risk');
  });

  it('starts work on the day a prerequisite is expected, and not before', () => {
    const p = run(
      input([work('cut', null, 'Cut', 100)], {
        prerequisites: [
          { id: 'silk', orderId: null, label: 'Silk', state: 'ordered', expectedOn: d(3), blocking: true },
        ],
        requirements: [{ taskId: 'cut', prerequisiteId: 'silk' }],
      }),
    );
    expect(slotsOf(p, 'cut')).toEqual([`${d(3)}:100`]);
  });

  it('ignores a prerequisite that has arrived, and one that does not block', () => {
    const p = run(
      input([work('a', null, 'A', 100), work('b', null, 'B', 100)], {
        prerequisites: [
          { id: 'x', orderId: null, label: 'Arrived', state: 'received', expectedOn: d(5), blocking: true },
          {
            id: 'y',
            orderId: null,
            label: 'Nice to have',
            state: 'needed',
            expectedOn: null,
            blocking: false,
          },
        ],
        requirements: [
          { taskId: 'a', prerequisiteId: 'x' },
          { taskId: 'b', prerequisiteId: 'y' },
        ],
      }),
    );
    expect(task(p, 'a').start).toBe(d(0));
    expect(task(p, 'b').start).toBe(d(0));
  });

  it('plans nothing for a calendar that has run out, and says so', () => {
    const p = run({
      ...input([work('a', 'o1', 'Huge', 5000)], { orders: [ORDER('o1', d(60))] }),
      calendar: flatCalendar(MON, 300, 5),
    });
    expect(task(p, 'a').placement).toBe('unplanned');
    expect(p.warnings.find((w) => w.code === 'no_room_in_calendar')?.severity).toBe('problem');
  });
});

describe('what is already done or no longer wanted', () => {
  it('lets a follower start after a done task, from the day it was done', () => {
    const p = run(
      input(
        [work('a', null, 'Done job', 100, { status: 'done', doneOn: d(0) }), work('b', null, 'Next', 100)],
        {
          edges: [follows('a', 'b', 1)],
        },
      ),
    );
    expect(task(p, 'a')).toMatchObject({ placement: 'done', start: d(0), finish: d(0) });
    expect(p.slots.some((s) => s.taskId === 'a')).toBe(false);
    expect(task(p, 'b').start).toBe(d(1));
  });

  it('ignores a cancelled task as if it had never been there', () => {
    const p = run(
      input([work('a', null, 'Cancelled', 900, { status: 'cancelled' }), work('b', null, 'B', 100)], {
        edges: [follows('a', 'b', 3)],
      }),
    );
    expect(p.tasks.map((t) => t.id)).toEqual(['b']);
    expect(task(p, 'b').start).toBe(d(0));
  });

  it('puts work already started ahead of work with less slack', () => {
    const p = run(
      input(
        [
          work('urgent', 'o1', 'Urgent', 300),
          work('started', 'o2', 'Started', 300, { status: 'in_progress' }),
        ],
        { orders: [ORDER('o1', d(2)), ORDER('o2', d(30))] },
      ),
    );
    expect(task(p, 'started').start).toBe(d(0));
    expect(task(p, 'urgent').start).toBe(d(1));
  });
});

describe('who goes first', () => {
  it('gives the order with less slack the earlier days', () => {
    const p = run(
      input([work('late', 'o1', 'Due later', 300), work('soon', 'o2', 'Due soon', 300)], {
        orders: [ORDER('o1', d(14)), ORDER('o2', d(3))],
      }),
    );
    expect(task(p, 'soon').start).toBe(d(0));
    expect(task(p, 'late').start).toBe(d(1));
  });

  it('breaks a tie by priority, then by id, so the plan never flickers', () => {
    const tasks = [
      work('b', null, 'B', 300),
      work('a', null, 'A', 300),
      work('c', null, 'C', 300, { priority: -1 }),
    ];
    const p = run(input(tasks));
    expect(['c', 'a', 'b'].map((id) => task(p, id).start)).toEqual([d(0), d(1), d(2)]);
  });

  it('plans studio work after work that has a promise', () => {
    const p = run(
      input([work('studio', null, 'Studio job', 300), work('job', 'o1', 'Order job', 300)], {
        orders: [ORDER('o1', d(30))],
      }),
    );
    expect(task(p, 'job').start).toBe(d(0));
    expect(task(p, 'studio').start).toBe(d(1));
  });
});

describe('the promise', () => {
  const o = [ORDER('o1', d(7), 2)]; // handover Monday 2 Nov, buffer 2: last working day is Saturday 31 Oct

  it('is on track when everything is ready by the last working day', () => {
    const p = run(input([work('a', 'o1', 'A', 300)], { orders: o }));
    expect(order(p, 'o1')).toMatchObject({
      state: 'on_track',
      readyOn: d(0),
      lastWorkDay: d(4),
      reasons: [],
    });
    expect(order(p, 'o1').slackDays).toBe(4);
  });

  it('is at risk when the buffer is used, and says how much', () => {
    // 1800 minutes is six working days, so Monday to Friday and then Monday 2 Nov.
    // Handover is Tuesday 3 Nov with a 2 day buffer, so the last working day is Saturday 31 Oct.
    const tight = [ORDER('o1', d(8), 2)];
    const p = run(input([work('a', 'o1', 'Big', 1800)], { orders: tight }));
    expect(task(p, 'a').finish).toBe(d(7)); // Mon 2 Nov
    expect(order(p, 'o1').state).toBe('at_risk');
    const w = p.warnings.find((x) => x.code === 'buffer_used');
    expect(w?.numbers).toMatchObject({ readyOn: d(7), bufferDays: 2, daysIntoBuffer: 2 });
  });

  it('is late when the plan misses handover although someone could have made it', () => {
    // Two orders due the same day, each needing 2 days of her time, with 3 days available before handover.
    const two = [ORDER('o1', d(3)), ORDER('o2', d(3))];
    const p = run(input([work('a', 'o1', 'A', 600), work('b', 'o2', 'B', 600)], { orders: two }));
    const states = [order(p, 'o1').state, order(p, 'o2').state].sort();
    expect(states).toEqual(['at_risk', 'on_track']);
    const late = order(p, 'o2').state === 'at_risk' ? 'o2' : 'o1';
    expect(codes(p)).toEqual(expect.arrayContaining(['order_late', 'capacity_shared']));
    expect(p.warnings.find((w) => w.code === 'capacity_shared' && w.orderId === late)?.message).toContain(
      'shared',
    );
  });

  it('is infeasible when no plan could keep it, with the numbers', () => {
    const p = run(input([work('a', 'o1', 'A', 900)], { orders: [ORDER('o1', d(2))] }));
    expect(order(p, 'o1').state).toBe('infeasible');
    const w = p.warnings.find((x) => x.code === 'order_cannot_make_delivery');
    expect(w?.severity).toBe('problem');
    expect(w?.numbers).toMatchObject({ workMinutes: 900, availableMinutes: 600, lateWorkingDays: 1 });
    expect(w?.message).toContain('15h 00m');
    expect(w?.message).toContain('10h 00m');
  });

  it('counts the waits when it says an order is hopeless', () => {
    // A 5 day wait cannot be shortened by any amount of work.
    const p = run(
      input([work('a', 'o1', 'A', 60), wait('w', 'o1', 'Glue sets', 5)], {
        orders: [ORDER('o1', d(3))],
        edges: [follows('a', 'w')],
      }),
    );
    expect(order(p, 'o1').state).toBe('infeasible');
    expect(p.warnings.find((x) => x.code === 'order_cannot_make_delivery')?.message).toContain('Glue sets');
  });

  it('flags a task past its own deadline', () => {
    const p = run(input([work('a', null, 'Needs a deadline', 900, { deadline: d(1) })]));
    expect(p.warnings.find((w) => w.code === 'task_after_latest_finish')?.numbers).toMatchObject({
      finish: d(2),
      latestFinish: d(1),
      lateDays: 1,
    });
  });

  it('names the late prerequisite behind a late task', () => {
    const p = run(
      input([work('trim', 'o1', 'Trim', 60)], {
        orders: [ORDER('o1', d(7), 0)],
        prerequisites: [
          { id: 'lace', orderId: 'o1', label: 'Lace', state: 'ordered', expectedOn: d(8), blocking: true },
        ],
        requirements: [{ taskId: 'trim', prerequisiteId: 'lace' }],
      }),
    );
    const w = p.warnings.find((x) => x.code === 'task_after_latest_finish');
    expect(w?.numbers).toMatchObject({ waitingFor: 'Lace', expectedOn: d(8) });
    expect(order(p, 'o1').state).toBe('infeasible'); // lace arrives after handover
  });

  it('is on track with nothing left to do, even if it finished late', () => {
    const p = run(
      input([work('a', 'o1', 'Old job', 100, { status: 'done', doneOn: addDays(MON, -1) })], {
        orders: [ORDER('o1', d(0))],
      }),
    );
    expect(order(p, 'o1')).toMatchObject({ state: 'on_track', complete: true, reasons: [] });
  });

  it('marks the chain that sets the ready day, in order', () => {
    const p = run(
      input([work('a', 'o1', 'A', 100), work('b', 'o1', 'B', 100), work('side', 'o1', 'Side job', 50)], {
        orders: [ORDER('o1', d(20))],
        edges: [follows('a', 'b', 3)],
      }),
    );
    expect(p.critical).toEqual(['a', 'b']);
    expect(task(p, 'side').critical).toBe(false);
  });
});

describe('bounds', () => {
  it('earliest finish counts the work that piles up behind a gap', () => {
    // Two 200 minute tasks both released on Friday cannot both finish by Friday (300 a day).
    const p = run(
      input(
        [work('a', 'o1', 'A', 200, { notBefore: d(4) }), work('b', 'o1', 'B', 200, { notBefore: d(4) })],
        { orders: [ORDER('o1', d(30))] },
      ),
    );
    expect(order(p, 'o1').earliestReadyOn).toBe(d(7)); // Monday
  });

  it('earliest ready is never later than the plan, and equal when the plan is as good as it gets', () => {
    const p = run(
      input([work('a', 'o1', 'A', 100), work('b', 'o1', 'B', 100)], {
        orders: [ORDER('o1', d(30))],
        edges: [follows('a', 'b')],
      }),
    );
    expect(order(p, 'o1').earliestReadyOn).toBe(order(p, 'o1').readyOn);
  });
});

describe('the whole thing is repeatable', () => {
  const tasks = [
    work('a', 'o1', 'A', 700),
    work('b', 'o1', 'B', 400),
    wait('w', 'o1', 'Rest', 2),
    fixed('f', 'o2', 'Fitting', d(3), '14:00', 45),
    work('c', 'o2', 'C', 500),
    work('s', null, 'Studio', 120),
  ];
  const i = input(tasks, {
    orders: [ORDER('o1', d(21), 2), ORDER('o2', d(10), 1)],
    edges: [follows('a', 'b'), follows('b', 'w'), follows('c', 'f')],
  });

  it('gives the same answer twice, byte for byte', () => {
    expect(JSON.stringify(plan(i))).toBe(JSON.stringify(plan(i)));
  });

  it('does not care in which order the lists were written', () => {
    const shuffled: PlanInput = {
      ...i,
      tasks: [...i.tasks].reverse(),
      edges: [...(i.edges ?? [])].reverse(),
      orders: [...(i.orders ?? [])].reverse(),
    };
    expect(JSON.stringify(plan(shuffled))).toBe(JSON.stringify(plan(i)));
  });

  it('does not change its input', () => {
    const before = JSON.stringify(i);
    plan(i);
    expect(JSON.stringify(i)).toBe(before);
  });
});

describe('the order of a day', () => {
  const rankOf = (p: Plan, id: string, day: string) =>
    p.slots.find((s) => s.taskId === id && s.day === day)?.rank;

  it('lists work before the fitting it must be finished for, on the same day', () => {
    const p = run(
      input([work('prep', null, 'Press the toile', 60), fixed('fit', null, 'Fitting', d(0), '10:30', 60)], {
        edges: [follows('prep', 'fit')],
      }),
    );
    expect(rankOf(p, 'prep', d(0))).toBe(1);
    expect(rankOf(p, 'fit', d(0))).toBe(2);
  });

  it('lists fixed events first by their clock time when nothing ties them to the work', () => {
    const p = run(
      input([
        work('w', null, 'Sewing', 100),
        fixed('late', null, 'Afternoon call', d(0), '14:00', 30),
        fixed('early', null, 'Morning fitting', d(0), '09:30', 60),
      ]),
    );
    expect(p.slots.filter((s) => s.day === d(0)).map((s) => s.taskId)).toEqual(['early', 'late', 'w']);
  });

  it('lists work that follows a fitting after it', () => {
    const p = run(
      input([fixed('fit', null, 'Fitting', d(0), '10:30', 60), work('alter', null, 'Alter the bodice', 90)], {
        edges: [follows('fit', 'alter')],
      }),
    );
    expect(rankOf(p, 'fit', d(0))).toBe(1);
    expect(rankOf(p, 'alter', d(0))).toBe(2);
  });

  it('keeps the predecessor first even when the events in between are earlier in the day', () => {
    const p = run(
      input(
        [
          work('prep', null, 'Press the toile', 60),
          fixed('fit', null, 'Fitting', d(0), '15:00', 60),
          fixed('call', null, 'Morning call', d(0), '09:00', 30),
        ],
        { edges: [follows('prep', 'fit')] },
      ),
    );
    expect(p.slots.filter((s) => s.day === d(0)).map((s) => s.taskId)).toEqual(['call', 'prep', 'fit']);
  });

  it('numbers a day from 1 with no gaps', () => {
    const p = run(input([work('a', null, 'A', 60), work('b', null, 'B', 60), work('c', null, 'C', 60)]));
    expect(p.slots.filter((s) => s.day === d(0)).map((s) => s.rank)).toEqual([1, 2, 3]);
  });
});

describe('an order with something left out', () => {
  const o = [ORDER('o1', d(14))];
  const held = () =>
    run(
      input([work('a', 'o1', 'Sew', 200), work('b', 'o1', 'Beading', 100, { hold: 'Beads not chosen' })], {
        orders: o,
      }),
    );

  it('has no ready day, because there is no day on which everything is finished', () => {
    const p = held();
    expect(task(p, 'a').finish).toBe(d(0));
    expect(order(p, 'o1')).toMatchObject({
      state: 'at_risk',
      complete: false,
      readyOn: null,
      slackDays: null,
    });
  });

  it('still says when the work that is planned ends, by that name, once it is already too late', () => {
    expect(
      say.orderLate({ label: 'Order 1', finish: d(9), complete: false, deliveryOn: d(8), lateDays: 2 }),
    ).toContain('The work planned for Order 1 ends on');
    expect(
      say.orderLate({ label: 'Order 1', finish: d(9), complete: true, deliveryOn: d(8), lateDays: 2 }),
    ).toContain('Order 1 would be ready on');
    expect(
      say.bufferUsed({ label: 'Order 1', finish: d(9), complete: false, bufferDays: 2, intoBuffer: 1 }),
    ).toContain('The work planned for Order 1 ends on');
    expect(say.capacityShared({ label: 'Order 1', earliest: d(2), finish: d(9), complete: false })).toContain(
      'the work planned for it ends on',
    );
  });

  it('gets its ready day back as soon as the task is released', () => {
    const p = run(
      input([work('a', 'o1', 'Sew', 200), work('b', 'o1', 'Beading', 100)], {
        orders: o,
      }),
    );
    expect(order(p, 'o1')).toMatchObject({ state: 'on_track', complete: true, readyOn: d(0) });
  });
});

describe('a step marked done out of order', () => {
  it('lets what follows it go ahead, although the step before it was never finished', () => {
    // She skipped "Toile" and went straight on to "Cut", which is done. "Hem" follows "Cut".
    // The toile is not due for a while, so it does not compete with the hem for her time.
    const p = run(
      input(
        [
          work('toile', 'o1', 'Toile', 1200, { notBefore: d(10) }),
          work('cut', 'o1', 'Cut', 100, { status: 'done', doneOn: d(0) }),
          work('hem', 'o1', 'Hem', 30),
        ],
        { orders: [ORDER('o1', d(21))], edges: [follows('toile', 'cut'), follows('cut', 'hem')] },
      ),
    );
    expect(task(p, 'hem')).toMatchObject({ start: d(0), finish: d(0) });
    // and the proven earliest is not pushed back by the toile that it no longer waits for
    expect(task(p, 'hem').earliestFinish).toBe(d(0));
  });
});

describe('an order with no time at all before handover', () => {
  it('cannot be made, and says so, even though not one task could be placed', () => {
    const closed: PlanInput = {
      today: MON,
      calendar: flatCalendar(MON, 0, 30),
      tasks: [work('a', 'o1', 'Sew the bodice', 60)],
      orders: [ORDER('o1', d(5))],
    };
    const p = run(closed);
    expect(task(p, 'a').placement).toBe('unplanned');
    expect(order(p, 'o1').state).toBe('infeasible');
    const w = p.warnings.find((x) => x.code === 'order_cannot_make_delivery');
    expect(w?.numbers).toMatchObject({ workMinutes: 60, availableMinutes: 0 });
  });

  it('is only "at risk" when handover lies beyond the end of the planning calendar, which proves nothing', () => {
    const p = run({
      today: MON,
      calendar: flatCalendar(MON, 0, 10),
      tasks: [work('a', 'o1', 'Sew the bodice', 60)],
      orders: [ORDER('o1', d(40))],
    });
    expect(order(p, 'o1').state).toBe('at_risk');
    expect(codes(p)).toContain('no_room_in_calendar');
  });
});

describe('the proven earliest finish, worked out by hand', () => {
  it('counts the days a wait lasts', () => {
    // A wait of 2 days from Monday ends Wednesday, so the work after it cannot finish before Wednesday.
    const p = run(
      input([wait('w', 'o1', 'Rest', 2), work('a', 'o1', 'Press', 30)], {
        orders: [ORDER('o1', d(14))],
        edges: [follows('w', 'a')],
      }),
    );
    expect(task(p, 'w')).toMatchObject({ start: d(0), finish: d(2), earliestFinish: d(2) });
    expect(task(p, 'a')).toMatchObject({ start: d(2), earliestFinish: d(2) });
    expect(order(p, 'o1').earliestReadyOn).toBe(d(2));
  });

  it('counts the time of the work that must come first, not just the task itself', () => {
    // Two jobs of 200 minutes in a row do not fit into one day of 300, so the second cannot finish on day 0.
    const p = run(
      input([work('a', null, 'A', 200), work('b', null, 'B', 200)], { edges: [follows('a', 'b')] }),
    );
    expect(task(p, 'a').earliestFinish).toBe(d(0));
    expect(task(p, 'b').earliestFinish).toBe(d(1));
  });

  it('counts a rest of several days between tasks', () => {
    const p = run(
      input([work('a', 'o1', 'A', 60), work('b', 'o1', 'B', 60)], {
        orders: [ORDER('o1', d(14))],
        edges: [follows('a', 'b', 3)],
      }),
    );
    expect(task(p, 'b')).toMatchObject({ start: d(3), earliestFinish: d(3) });
  });
});

describe('the last working day is the line between on track and using the buffer', () => {
  // Handover Thursday 5 Nov (d10) with a 2 day buffer: the last working day is Monday 2 Nov (d7).
  const o = [ORDER('o1', d(10), 2)];
  const readyBy = (day: number) =>
    run(input([work('a', 'o1', 'A', 60, { notBefore: d(day) })], { orders: o }));

  it('is on track when the work ends exactly on the last working day', () => {
    const p = readyBy(7);
    expect(order(p, 'o1').lastWorkDay).toBe(d(7));
    expect(task(p, 'a').finish).toBe(d(7));
    expect(order(p, 'o1')).toMatchObject({ state: 'on_track', slackDays: 0, reasons: [] });
    expect(codes(p)).toEqual([]);
  });

  it('uses the buffer when the work ends the day after, and says one day', () => {
    const p = readyBy(8);
    expect(order(p, 'o1').state).toBe('at_risk');
    expect(p.warnings.find((w) => w.code === 'buffer_used')?.numbers).toMatchObject({ daysIntoBuffer: 1 });
    expect(codes(p)).not.toContain('order_late');
  });

  it('is still only using the buffer on the last day before handover, and says two days', () => {
    const p = readyBy(9);
    expect(order(p, 'o1').state).toBe('at_risk');
    expect(p.warnings.find((w) => w.code === 'buffer_used')?.numbers).toMatchObject({ daysIntoBuffer: 2 });
    expect(codes(p)).not.toContain('order_late');
  });

  it('cannot be made when the work cannot start before handover day itself', () => {
    const p = readyBy(10);
    expect(order(p, 'o1').state).toBe('infeasible');
  });
});
