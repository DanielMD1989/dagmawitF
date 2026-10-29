import { describe, expect, it } from 'vitest';
import { addDays } from '../dates';
import { plan } from '../engine/plan';
import { buildPlanInput, type PlanningFacts } from './input';
import { isCurrent, toPlan, toStored, type StoredPlan } from './proposal';
import {
  causeCount,
  changesAgainst,
  estimateText,
  formatSpan,
  planOrders,
  reviewOrder,
  taskMoves,
  weekLoads,
} from './review';
import type { Slot } from '../engine/types';

const TODAY = '2026-10-26'; // Monday
const d = (n: number) => addDays(TODAY, n);
const WEEK = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '09:00', end: '17:00', breaks: [] }));

type T = PlanningFacts['tasks'][number];
const work = (id: string, orderId: string, title: string, minutes: number): T => ({
  id,
  orderId,
  garment: 'Bridal gown',
  title,
  kind: 'work',
  minutes,
  days: null,
  fixedOn: null,
  fixedTime: null,
  notBefore: null,
  status: 'not_started' as const,
  doneOn: null,
  remainingMinutes: null,
  holdReason: '',
  pinnedOn: null,
});
const fitting = (id: string, orderId: string, on: string | null): T => ({
  id,
  orderId,
  garment: 'Bridal gown',
  title: 'First fitting',
  kind: 'fixed',
  minutes: 60,
  days: null,
  fixedOn: on,
  fixedTime: on ? '10:30' : null,
  notBefore: null,
  status: 'not_started' as const,
  doneOn: null,
  remainingMinutes: null,
  holdReason: '',
  pinnedOn: null,
});

function facts(over: { laceOn?: string | null; fitOn?: string | null } = {}): PlanningFacts {
  const order = (id: string, number: number, deliveryOn: string) => ({
    id,
    number,
    status: 'active' as const,
    deliveryOn,
    bufferDays: 2,
    garmentTypes: [number === 1 ? 'Bridal gown' : 'Evening dress'],
  });
  return {
    today: TODAY,
    calendar: { week: WEEK, exceptions: [], planningRatio: 0.5 }, // 240 minutes a weekday
    orders: [order('gown', 1, d(30)), order('dress', 2, d(20))],
    tasks: [
      work('cut', 'gown', 'Cut', 120),
      fitting('fit', 'gown', over.fitOn === undefined ? d(8) : over.fitOn),
      work('alter', 'gown', 'Alterations', 180),
      work('sew', 'dress', 'Sew the dress', 600),
    ],
    edges: [
      { from: 'cut', to: 'fit', lagDays: 0 },
      { from: 'fit', to: 'alter', lagDays: 0 },
    ],
    prerequisites: [
      {
        id: 'lace',
        orderId: 'gown',
        label: 'Lace',
        state: 'ordered',
        expectedOn: over.laceOn === undefined ? d(3) : over.laceOn,
        blocking: true,
      },
    ],
    requirements: [{ taskId: 'cut', prerequisiteId: 'lace' }],
  };
}

function stored(f: PlanningFacts): { stored: StoredPlan; slots: Slot[] } {
  const input = buildPlanInput(f);
  const result = plan(input);
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join('; '));
  const garments = new Map(f.tasks.map((t) => [t.id, t.garment]));
  const { result: s, slots } = toStored(input, result.plan, (id) => garments.get(id) ?? null);
  // Through JSON, as the database keeps it.
  return {
    stored: JSON.parse(JSON.stringify(s)) as StoredPlan,
    slots: slots.map((r) => ({
      taskId: r.task_id,
      day: r.day,
      minutes: r.minutes,
      rank: r.rank,
      ...(r.at_time ? { time: r.at_time } : {}),
    })),
  };
}

describe('words for a schedule', () => {
  it('writes a span of days the short way', () => {
    expect(formatSpan('2026-10-27', '2026-10-27')).toBe('Tue 27 Oct');
    expect(formatSpan('2026-10-27', '2026-10-28')).toBe('Tue 27 to Wed 28 Oct');
    expect(formatSpan('2026-10-30', '2026-11-04')).toBe('Fri 30 Oct to Wed 4 Nov');
  });
  it('writes an estimate by its kind', () => {
    expect(estimateText('work', 90, null)).toBe('1h 30m');
    expect(estimateText('fixed', 45, null)).toBe('45 min');
    expect(estimateText('wait', null, 1)).toBe('1 day');
    expect(estimateText('wait', null, 3)).toBe('3 days');
    expect(estimateText('milestone', null, null)).toBe('');
  });
});

describe('the review of one order', () => {
  it('is on track when everything is placed before the buffer', () => {
    const { stored: s, slots } = stored(facts());
    const r = reviewOrder(s, slots, 'gown');
    expect(r).toMatchObject({
      label: 'Order #1, bridal gown',
      state: 'on_track',
      stateLabel: 'On track',
      attention: [],
    });
    expect(r?.neededMinutes).toBe(120 + 60 + 180);
    expect(r?.placedMinutes).toBe(120 + 60 + 180);
    // Cut waits for the lace (Thursday), the fitting is fixed, the alterations follow it.
    expect(r?.schedule.map((x) => [x.title, x.planned, x.status.text])).toEqual([
      ['Cut', 'Thu 29 Oct', 'Planned'],
      ['First fitting', 'Tue 3 Nov, 10:30', 'Fixed by you'],
      ['Alterations', 'Tue 3 Nov', 'Planned'],
    ]);
  });

  it('leads with what needs her attention when a fitting has no day, and says what is not placed', () => {
    const { stored: s, slots } = stored(facts({ fitOn: null }));
    const r = reviewOrder(s, slots, 'gown');
    expect(r?.state).toBe('at_risk');
    expect(r?.attention.map((f) => [f.code, f.taskId])).toEqual([['fixed_undated', 'fit']]);
    // The alterations are left out only because the fitting is: they follow when it has a day.
    expect(r?.consequences.map((f) => [f.code, f.taskId])).toEqual([['predecessor_unplanned', 'alter']]);
    expect(r?.attention[0]?.garment).toBe('Bridal gown');
    expect(causeCount(s)).toBe(1);
    expect(r?.placedMinutes).toBe(120);
    expect(r?.readyOn).toBeNull();
    expect(r?.schedule.map((x) => [x.title, x.status.text, x.status.tone])).toEqual([
      ['Cut', 'Planned', 'ok'],
      ['First fitting', 'Needs a day', 'problem'],
      ['Alterations', 'Waits for work not planned', 'problem'],
    ]);
  });

  it('says why work waiting for something with no date is not placed', () => {
    const { stored: s, slots } = stored(facts({ laceOn: null }));
    const cut = reviewOrder(s, slots, 'gown')?.schedule.find((x) => x.taskId === 'cut');
    expect(cut?.status).toEqual({ text: 'Waiting for a date', tone: 'problem' });
  });

  it('knows nothing of an order that is not in the plan', () => {
    const { stored: s, slots } = stored(facts());
    expect(reviewOrder(s, slots, 'nope')).toBeNull();
  });
});

describe('her shared time, week by week', () => {
  it('shows each week the order has work in: her usable time, this order, the others, what is free', () => {
    const { stored: s, slots } = stored(facts());
    const weeks = weekLoads(s, slots, 'gown');
    expect(weeks.map((w) => w.week)).toEqual(['2026-10-26', '2026-11-02']);
    const total = (week: string) => slots.filter((x) => x.day >= week && x.day < addDays(week, 7));
    for (const w of weeks) {
      expect(w.usable).toBe(5 * 240);
      const all = total(w.week).reduce((sum, x) => sum + x.minutes, 0);
      expect(w.thisOrder + w.otherOrders).toBe(all);
      expect(w.free).toBe(w.usable - all);
    }
    expect(weeks[0]?.thisOrder).toBe(120);
    expect(weeks[0]?.otherOrders).toBe(600);
  });

  it('counts no time before the plan’s first day', () => {
    const { stored: s, slots } = stored({ ...facts(), today: d(2) });
    const first = weekLoads(s, slots, 'gown')[0];
    expect(first?.week).toBe('2026-10-26');
    expect(first?.usable).toBe(3 * 240);
  });
});

describe('every order in a plan', () => {
  it('lists the ones in trouble first, then by handover', () => {
    const { stored: s } = stored(facts({ fitOn: null }));
    expect(planOrders(s).map((o) => [o.id, o.stateLabel])).toEqual([
      ['gown', 'At risk'],
      ['dress', 'On track'],
    ]);
  });
});

describe('what a proposal changes', () => {
  it('says which orders are ready later or sooner, and which got worse', () => {
    const before = stored(facts());
    const after = stored(facts({ laceOn: d(10) }));
    const changes = changesAgainst({ number: 3, ...before }, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ orderId: 'gown', worse: true });
    // The lace now comes after the fitting: the fitting stays where she put it, and the order is at risk.
    expect(changes[0]?.text).toContain('At risk (was on track).');
  });

  it('says nothing when nothing changes, and nothing without an approved plan', () => {
    const a = stored(facts());
    const b = stored(facts());
    expect(changesAgainst({ number: 1, ...a }, b)).toEqual([]);
    expect(changesAgainst(null, b)).toEqual([]);
  });

  it('names an order that joined or left the plan', () => {
    const both = stored(facts());
    const one = stored({ ...facts(), orders: facts().orders.filter((o) => o.id === 'gown') });
    expect(changesAgainst({ number: 1, ...both }, one).map((c) => [c.orderId, c.text])).toEqual([
      [
        'dress',
        'Not in this plan: it is no longer active (on hold, delivered, cancelled or back to a draft).',
      ],
    ]);
    expect(changesAgainst({ number: 1, ...one }, both).map((c) => [c.orderId, c.text])).toEqual([
      ['dress', 'New in this plan: on track.'],
    ]);
  });
});

describe('a stored plan', () => {
  it('reads back as the engine’s own plan', () => {
    const input = buildPlanInput(facts());
    const result = plan(input);
    if (!result.ok) throw new Error('refused');
    const { result: s, slots } = toStored(input, result.plan);
    const back = toPlan(
      s,
      slots.map((r) => ({
        taskId: r.task_id,
        day: r.day,
        minutes: r.minutes,
        rank: r.rank,
        ...(r.at_time ? { time: r.at_time } : {}),
      })),
    );
    expect(back).toEqual(result.plan);
    expect(s.facts.tasks.find((t) => t.id === 'fit')).toEqual({
      id: 'fit',
      orderId: 'gown',
      title: 'First fitting',
      kind: 'fixed',
      minutes: 60,
      days: null,
      garment: null,
    });
    expect(s.calendar).toEqual(input.calendar);
  });
});

describe('whether a plan is current', () => {
  it('is current only at today’s facts and for today', () => {
    expect(isCurrent({ epoch: 7, madeFor: TODAY }, 7, TODAY)).toBe(true);
    expect(isCurrent({ epoch: 6, madeFor: TODAY }, 7, TODAY)).toBe(false);
    expect(isCurrent({ epoch: 7, madeFor: d(-1) }, 7, TODAY)).toBe(false);
  });
});

describe('an order with nothing to plan yet', () => {
  it('says how many tasks it has, so a screen does not call it on track', () => {
    const f = facts();
    const { stored: s, slots } = stored({ ...f, tasks: f.tasks.filter((t) => t.orderId !== 'dress') });
    expect(reviewOrder(s, slots, 'dress')).toMatchObject({ taskCount: 0, garments: [] });
    expect(planOrders(s).find((o) => o.id === 'dress')?.taskCount).toBe(0);
    expect(reviewOrder(s, slots, 'gown')).toMatchObject({ taskCount: 3, garments: ['Bridal gown'] });
  });
});

describe('what moves, task by task', () => {
  it('says from when to when each task moves when the lace comes later', () => {
    const before = stored(facts());
    const after = stored(facts({ laceOn: d(5) }));
    const moves = taskMoves(before, after);
    const cut = moves.find((m) => m.taskId === 'cut');
    expect(cut).toMatchObject({
      title: 'Cut',
      garment: 'Bridal gown',
      change: 'moved',
      // The lace comes on a Saturday; she does not work weekends, so the cutting moves to Monday.
      text: 'Thu 29 Oct → Mon 2 Nov',
    });
    // The fitting is pinned by her and does not move.
    expect(moves.some((m) => m.taskId === 'fit')).toBe(false);
  });

  it('says when a task drops out of the plan or comes into it', () => {
    const planned = stored(facts());
    const undated = stored(facts({ laceOn: null }));
    expect(taskMoves(planned, undated).find((m) => m.taskId === 'cut')).toMatchObject({
      change: 'no_longer_planned',
      text: 'no longer planned (was Thu 29 Oct)',
    });
    expect(taskMoves(undated, planned).find((m) => m.taskId === 'cut')).toMatchObject({
      change: 'newly_planned',
      text: 'now planned Thu 29 Oct',
    });
  });

  it('says nothing when nothing moves', () => {
    expect(taskMoves(stored(facts()), stored(facts()))).toEqual([]);
  });
});
