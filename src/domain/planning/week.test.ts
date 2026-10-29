import { describe, expect, it } from 'vitest';
import { mondayOf, weekBoard } from './week';
import type { StoredPlan } from './proposal';

const plan: StoredPlan = {
  today: '2026-10-28',
  calendar: { start: '2026-10-28', usable: [300, 300, 300, 0, 0, 300, 300, 300, 300, 300] },
  orders: [],
  tasks: [],
  warnings: [],
  critical: [],
  facts: {
    orders: [{ id: 'o1', label: 'Order #1, bridal gown', deliveryOn: '2026-11-30', bufferDays: 2 }],
    tasks: [
      {
        id: 'cut',
        orderId: 'o1',
        garment: 'Bridal gown',
        title: 'Cut',
        kind: 'work',
        minutes: 120,
        days: null,
      },
      {
        id: 'fit',
        orderId: 'o1',
        garment: 'Bridal gown',
        title: 'Fitting',
        kind: 'fixed',
        minutes: 60,
        days: null,
      },
      {
        id: 'shears',
        orderId: null,
        garment: null,
        title: 'Sharpen the shears',
        kind: 'work',
        minutes: 20,
        days: null,
      },
    ],
  },
};
const slots = [
  { taskId: 'cut', day: '2026-10-28', minutes: 120, rank: 2 },
  { taskId: 'fit', day: '2026-10-28', minutes: 60, rank: 1, time: '10:30' },
  { taskId: 'shears', day: '2026-10-30', minutes: 20, rank: 1 },
  { taskId: 'cut', day: '2026-11-03', minutes: 30, rank: 1 },
];

describe('the week board', () => {
  it('starts on the Monday of any day of the week', () => {
    expect(mondayOf('2026-10-28')).toBe('2026-10-26');
    expect(mondayOf('2026-10-26')).toBe('2026-10-26');
    expect(mondayOf('2026-11-01')).toBe('2026-10-26');
  });

  it('lays out each day: her usable time, what is planned, and the tasks in the plan’s order', () => {
    const b = weekBoard(plan, slots, '2026-10-29');
    expect(b.week).toBe('2026-10-26');
    expect(b.days.map((x) => [x.day, x.usable, x.planned])).toEqual([
      ['2026-10-26', null, 0],
      ['2026-10-27', null, 0],
      ['2026-10-28', 300, 180],
      ['2026-10-29', 300, 0],
      ['2026-10-30', 300, 20],
      ['2026-10-31', 0, 0],
      ['2026-11-01', 0, 0],
    ]);
    expect(b.days[2]?.tasks.map((t) => [t.title, t.time, t.orderLabel])).toEqual([
      ['Fitting', '10:30', 'Order #1, bridal gown'],
      ['Cut', null, 'Order #1, bridal gown'],
    ]);
    expect(b.days[4]?.tasks[0]).toMatchObject({
      title: 'Sharpen the shears',
      orderLabel: null,
      orderId: null,
    });
    expect([b.planned, b.usable]).toEqual([200, 900]);
  });

  it('shows the next week from the same plan', () => {
    const b = weekBoard(plan, slots, '2026-11-02');
    expect(b.days[1]).toMatchObject({ day: '2026-11-03', planned: 30, usable: 300 });
  });
});
