import { describe, expect, it } from 'vitest';
import type { Slot } from '../engine/types';
import { blockedBy, buildToday, toReview, type Item, type LiveTask } from './today';

const TODAY = '2026-10-27';
const task = (id: string, over: Partial<LiveTask> = {}): LiveTask => ({
  id,
  orderId: 'o1',
  orderLabel: 'Order #1, bridal gown',
  title: id,
  kind: 'work',
  minutes: 60,
  status: 'not_started',
  remainingMinutes: null,
  actualMinutes: null,
  holdReason: '',
  ...over,
});
const slot = (taskId: string, minutes: number, rank: number, day = TODAY, time?: string): Slot => ({
  taskId,
  day,
  minutes,
  rank,
  ...(time ? { time } : {}),
});
const lace: Item = { id: 'lace', label: 'Lace', state: 'ordered', expectedOn: '2026-10-28', blocking: true };

describe('today’s list', () => {
  const tasks = [
    task('fitting', { kind: 'fixed', title: 'Client fitting' }),
    task('cut', { title: 'Cut evening gown' }),
    task('trims', { title: 'Prepare bridal trims' }),
    task('lining', { title: 'Construct jacket lining', status: 'in_progress' }),
    task('tomorrow'),
  ];
  const slots = [
    slot('cut', 90, 2),
    slot('fitting', 30, 1, TODAY, '10:30'),
    slot('trims', 45, 4),
    slot('lining', 60, 3),
    slot('tomorrow', 120, 1, '2026-10-28'),
  ];
  const today = buildToday({
    today: TODAY,
    usableMinutes: 315,
    slots,
    tasks,
    needs: [{ taskId: 'trims', itemId: 'lace' }],
    items: [lace],
  });

  it('shows today’s slots in the plan’s order, appointments with their time', () => {
    expect(today.entries.map((e) => [e.task.id, e.minutesToday, e.time, e.state])).toEqual([
      ['fitting', 30, '10:30', 'ready'],
      ['cut', 90, null, 'ready'],
      ['lining', 60, null, 'started'],
      ['trims', 45, null, 'blocked'],
    ]);
  });

  it('says what blocks a task, and does not count it in today’s time', () => {
    const trims = today.entries.find((e) => e.task.id === 'trims');
    expect(trims).toMatchObject({ reason: 'Lace not received. Expected Wed 28 Oct.', counted: false });
    expect(today.plannedMinutes).toBe(30 + 90 + 60);
    expect(today.freeMinutes).toBe(315 - 180);
  });

  it('shows a held task with her reason, not counted', () => {
    const held = buildToday({
      today: TODAY,
      usableMinutes: 300,
      slots: [slot('cut', 90, 1)],
      tasks: [task('cut', { holdReason: 'Client away' })],
      needs: [],
      items: [],
    });
    expect(held.entries[0]).toMatchObject({ state: 'held', reason: 'Client away', counted: false });
    expect(held.plannedMinutes).toBe(0);
  });

  it('lists work started another day, and studio work waiting for a day', () => {
    const t = buildToday({
      today: TODAY,
      usableMinutes: 300,
      slots: [slot('cut', 90, 1)],
      tasks: [
        task('cut'),
        task('old', { status: 'in_progress' }),
        task('shears', { orderId: null, orderLabel: null }),
        task('done-shears', { orderId: null, orderLabel: null, status: 'done' }),
      ],
      needs: [],
      items: [],
    });
    expect(t.alsoStarted.map((e) => e.task.id)).toEqual(['old']);
    expect(t.waitingForADay.map((x) => x.id)).toEqual(['shears']);
  });

  it('asks the review about everything not finished, once each', () => {
    const t = buildToday({
      today: TODAY,
      usableMinutes: 300,
      slots: [slot('cut', 90, 1), slot('sew', 60, 2)],
      tasks: [task('cut', { status: 'done' }), task('sew'), task('old', { status: 'in_progress' })],
      needs: [],
      items: [],
    });
    expect(toReview(t).map((e) => e.task.id)).toEqual(['sew', 'old']);
  });

  it('is empty without an approved plan', () => {
    const t = buildToday({
      today: TODAY,
      usableMinutes: 300,
      slots: [],
      tasks: [task('cut')],
      needs: [],
      items: [],
    });
    expect(t.entries).toEqual([]);
    expect(t.freeMinutes).toBe(300);
  });
});

describe('what blocks a task', () => {
  it('names each blocking item not received, with its day or the lack of one', () => {
    const items: Item[] = [
      lace,
      { id: 'silk', label: 'Silk', state: 'needed', expectedOn: null, blocking: true },
      { id: 'veil', label: 'Veil', state: 'needed', expectedOn: null, blocking: false },
      { id: 'fabric', label: 'Fabric', state: 'received', expectedOn: null, blocking: true },
    ];
    const needs = ['lace', 'silk', 'veil', 'fabric'].map((itemId) => ({ taskId: 't', itemId }));
    expect(blockedBy('t', needs, items)).toBe(
      'Lace not received. Expected Wed 28 Oct. Silk not received, and no expected day yet.',
    );
    expect(blockedBy('t', needs.slice(2), items)).toBeNull();
  });
});
