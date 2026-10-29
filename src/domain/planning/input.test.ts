import { describe, expect, it } from 'vitest';
import { addDays } from '../dates';
import type { OrderStatus } from '../orders/status';
import {
  CALENDAR_MARGIN_DAYS,
  MAX_CALENDAR_DAYS,
  MIN_CALENDAR_DAYS,
  buildPlanInput,
  calendarLength,
  type PlanningFacts,
} from './input';

const TODAY = '2026-10-26'; // a Monday
const WEEK = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '09:00', end: '17:00', breaks: [] }));

function facts(over: Partial<PlanningFacts> = {}): PlanningFacts {
  const order = (id: string, number: number, status: OrderStatus) => ({
    id,
    number,
    status,
    deliveryOn: addDays(TODAY, 30),
    bufferDays: 2,
    garmentTypes: ['Bridal gown'],
  });
  return {
    today: TODAY,
    calendar: { week: WEEK, exceptions: [], planningRatio: 0.5 },
    orders: [
      order('active', 1, 'active'),
      order('draft', 2, 'draft'),
      order('held', 3, 'on_hold'),
      order('done', 4, 'delivered'),
    ],
    tasks: ['active', 'draft', 'held', 'done'].flatMap((o) => [
      {
        id: `${o}-cut`,
        orderId: o,
        garment: 'Bridal gown',
        title: 'Cut',
        kind: 'work' as const,
        minutes: 120,
        days: null,
        fixedOn: null,
        fixedTime: null,
        notBefore: null,
        status: 'not_started' as const,
        doneOn: null,
        remainingMinutes: null,
        holdReason: '',
        pinnedOn: null,
      },
      {
        id: `${o}-fit`,
        orderId: o,
        garment: 'Bridal gown',
        title: 'Fitting',
        kind: 'fixed' as const,
        minutes: 60,
        days: null,
        fixedOn: null,
        fixedTime: null,
        notBefore: null,
        status: 'not_started' as const,
        doneOn: null,
        remainingMinutes: null,
        holdReason: '',
        pinnedOn: null,
      },
    ]),
    edges: ['active', 'draft'].map((o) => ({ from: `${o}-cut`, to: `${o}-fit`, lagDays: 1 })),
    prerequisites: ['active', 'draft'].map((o) => ({
      id: `${o}-lace`,
      orderId: o,
      label: 'Lace',
      state: 'ordered' as const,
      expectedOn: addDays(TODAY, 3),
      blocking: true,
    })),
    requirements: ['active', 'draft'].map((o) => ({ taskId: `${o}-cut`, prerequisiteId: `${o}-lace` })),
    ...over,
  };
}

describe('what the engine is given', () => {
  it('plans only active orders: a draft promises nothing, a held or delivered order takes none of her time', () => {
    const input = buildPlanInput(facts());
    expect(input.orders?.map((o) => o.id)).toEqual(['active']);
    expect(input.tasks.map((t) => t.id)).toEqual(['active-cut', 'active-fit']);
    expect(input.edges).toEqual([{ from: 'active-cut', to: 'active-fit', lagDays: 1 }]);
    expect(input.prerequisites?.map((p) => p.id)).toEqual(['active-lace']);
    expect(input.requirements).toEqual([{ taskId: 'active-cut', prerequisiteId: 'active-lace' }]);
  });

  it('names each order as the engine’s messages will', () => {
    expect(buildPlanInput(facts()).orders?.[0]).toEqual({
      id: 'active',
      label: 'Order #1, bridal gown',
      deliveryOn: addDays(TODAY, 30),
      bufferDays: 2,
    });
  });

  it('gives an appointment its day only when both day and time are set', () => {
    const tasks = facts().tasks.map((t) =>
      t.id === 'active-fit' ? { ...t, fixedOn: addDays(TODAY, 5), fixedTime: '10:30' } : t,
    );
    const withDay = buildPlanInput(facts({ tasks }));
    expect(withDay.tasks.find((t) => t.id === 'active-fit')?.fixedAt).toEqual({
      day: addDays(TODAY, 5),
      time: '10:30',
    });
    const withoutDay = buildPlanInput(facts());
    expect(withoutDay.tasks.find((t) => t.id === 'active-fit')?.fixedAt).toBeUndefined();
  });

  it('carries each kind’s own measure, and a day it may not start before', () => {
    const tasks = [
      {
        id: 'w',
        orderId: 'active',
        garment: 'Bridal gown',
        title: 'Dry',
        kind: 'wait' as const,
        minutes: null,
        days: 2,
        fixedOn: null,
        fixedTime: null,
        notBefore: addDays(TODAY, 4),
        status: 'not_started' as const,
        doneOn: null,
        remainingMinutes: null,
        holdReason: '',
        pinnedOn: null,
      },
      {
        id: 'm',
        orderId: 'active',
        garment: 'Bridal gown',
        title: 'Ready',
        kind: 'milestone' as const,
        minutes: null,
        days: null,
        fixedOn: null,
        fixedTime: null,
        notBefore: null,
        status: 'not_started' as const,
        doneOn: null,
        remainingMinutes: null,
        holdReason: '',
        pinnedOn: null,
      },
    ];
    const input = buildPlanInput(facts({ tasks, edges: [], requirements: [] }));
    expect(input.tasks).toEqual([
      { id: 'w', orderId: 'active', title: 'Dry', kind: 'wait', days: 2, notBefore: addDays(TODAY, 4) },
      { id: 'm', orderId: 'active', title: 'Ready', kind: 'milestone' },
    ]);
  });

  it('makes the calendar from her week, from today', () => {
    const input = buildPlanInput(facts());
    expect(input.today).toBe(TODAY);
    expect(input.calendar.start).toBe(TODAY);
    // Monday to Friday, 8 hours, half of it planned; the weekend closed.
    expect(input.calendar.usable.slice(0, 7)).toEqual([240, 240, 240, 240, 240, 0, 0]);
  });
});

describe('how far ahead the calendar reaches', () => {
  it('reaches a month past the last date anything mentions, between four months and two years', () => {
    expect(calendarLength(TODAY, [])).toBe(MIN_CALENDAR_DAYS);
    expect(calendarLength(TODAY, [addDays(TODAY, 200), null])).toBe(200 + 1 + CALENDAR_MARGIN_DAYS);
    expect(calendarLength(TODAY, [addDays(TODAY, 5000)])).toBe(MAX_CALENDAR_DAYS);
  });

  it('counts handover days, appointments, start days and expected deliveries', () => {
    const far = addDays(TODAY, 300);
    const base = facts();
    const cases: PlanningFacts[] = [
      facts({ orders: base.orders.map((o) => (o.id === 'active' ? { ...o, deliveryOn: far } : o)) }),
      facts({
        tasks: base.tasks.map((t) =>
          t.id === 'active-fit' ? { ...t, fixedOn: far, fixedTime: '10:00' } : t,
        ),
      }),
      facts({ tasks: base.tasks.map((t) => (t.id === 'active-cut' ? { ...t, notBefore: far } : t)) }),
      facts({
        prerequisites: base.prerequisites.map((p) =>
          p.id === 'active-lace' ? { ...p, expectedOn: far } : p,
        ),
      }),
    ];
    for (const f of cases)
      expect(buildPlanInput(f).calendar.usable).toHaveLength(300 + 1 + CALENDAR_MARGIN_DAYS);
    // A draft's far date does not stretch the calendar: the draft is not planned.
    const draftFar = facts({
      orders: base.orders.map((o) => (o.id === 'draft' ? { ...o, deliveryOn: far } : o)),
    });
    expect(buildPlanInput(draftFar).calendar.usable).toHaveLength(MIN_CALENDAR_DAYS);
  });
});

describe('progress and studio work', () => {
  const base = facts();
  const cut = base.tasks.find((t) => t.id === 'active-cut')!;
  const engineTask = (f: PlanningFacts, id: string) => buildPlanInput(f).tasks.find((t) => t.id === id);

  it('gives a task in progress what is left, or its whole estimate when she has not said', () => {
    const going = facts({ tasks: [{ ...cut, status: 'in_progress', remainingMinutes: 30 }] });
    expect(engineTask(going, 'active-cut')).toMatchObject({ status: 'in_progress', minutes: 30 });
    const unsaid = facts({ tasks: [{ ...cut, status: 'in_progress' }] });
    expect(engineTask(unsaid, 'active-cut')).toMatchObject({ status: 'in_progress', minutes: 120 });
  });

  it('gives a done task its day, and a held task her reason', () => {
    const done = facts({ tasks: [{ ...cut, status: 'done', doneOn: TODAY }] });
    expect(engineTask(done, 'active-cut')).toMatchObject({ status: 'done', doneOn: TODAY });
    const held = facts({ tasks: [{ ...cut, holdReason: 'Client away' }] });
    expect(engineTask(held, 'active-cut')).toMatchObject({ hold: 'Client away' });
    expect(engineTask(facts(), 'active-cut')).not.toHaveProperty('status');
    expect(engineTask(facts(), 'active-cut')).not.toHaveProperty('hold');
  });

  it('plans studio work, which has no order', () => {
    const studio = facts({
      tasks: [
        ...base.tasks,
        { ...cut, id: 'shears', orderId: null, garment: null, title: 'Sharpen the shears' },
      ],
    });
    expect(engineTask(studio, 'shears')).toMatchObject({
      orderId: null,
      title: 'Sharpen the shears',
      minutes: 120,
    });
  });
});

describe('a piece of work pinned to a day', () => {
  const cut = facts().tasks.find((t) => t.id === 'active-cut')!;
  const engineTask = (f: PlanningFacts) => buildPlanInput(f).tasks.find((t) => t.id === 'active-cut');

  it('puts all of what is left on its day', () => {
    expect(engineTask(facts({ tasks: [{ ...cut, pinnedOn: addDays(TODAY, 2) }] }))?.lockedSlots).toEqual([
      { day: addDays(TODAY, 2), minutes: 120 },
    ]);
    const going = facts({
      tasks: [{ ...cut, pinnedOn: TODAY, status: 'in_progress', remainingMinutes: 30 }],
    });
    expect(engineTask(going)?.lockedSlots).toEqual([{ day: TODAY, minutes: 30 }]);
  });

  it('is dropped once its day has passed, and means nothing on a done task', () => {
    expect(engineTask(facts({ tasks: [{ ...cut, pinnedOn: addDays(TODAY, -1) }] }))).not.toHaveProperty(
      'lockedSlots',
    );
    expect(
      engineTask(facts({ tasks: [{ ...cut, pinnedOn: TODAY, status: 'done', doneOn: TODAY }] })),
    ).not.toHaveProperty('lockedSlots');
  });

  it('stretches the calendar to reach it', () => {
    const far = addDays(TODAY, 300);
    expect(buildPlanInput(facts({ tasks: [{ ...cut, pinnedOn: far }] })).calendar.usable).toHaveLength(
      300 + 1 + CALENDAR_MARGIN_DAYS,
    );
  });
});
