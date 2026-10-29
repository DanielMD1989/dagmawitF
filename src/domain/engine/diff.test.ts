import { describe, expect, it } from 'vitest';
import { addDays } from '../dates';
import { diff } from './diff';
import { fixed, flatCalendar, follows, work } from './fixtures/build';
import { plan } from './plan';
import type { OrderFacts, Plan, PlanInput, Task } from './types';

const MON = '2026-10-26';
const d = (n: number) => addDays(MON, n);
const o = (id: string, deliveryOn: string): OrderFacts => ({ id, label: id, deliveryOn, bufferDays: 0 });

function run(tasks: Task[], extra: Partial<PlanInput> = {}): Plan {
  const result = plan({
    today: MON,
    calendar: flatCalendar(MON, [300, 300, 300, 300, 300, 0, 0], 60),
    tasks,
    ...extra,
  });
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join(' | '));
  return result.plan;
}

describe('diff', () => {
  const tasks = [work('a', 'o1', 'A', 300), work('b', 'o1', 'B', 300)];
  const orders = [o('o1', d(14))];

  it('says nothing changed when nothing did', () => {
    const p = run(tasks, { orders });
    expect(diff(p, p)).toEqual({ moved: [], newlyAtRisk: [], recovered: [], readyDateChanges: [] });
  });

  it('lists a task that moved, with where it was and where it is', () => {
    const before = run(tasks, { orders });
    const after = run([tasks[0] as Task, work('b', 'o1', 'B', 300, { notBefore: d(3) })], { orders });
    const result = diff(before, after);
    expect(result.moved).toEqual([
      {
        taskId: 'b',
        orderId: 'o1',
        before: { start: d(1), finish: d(1) },
        after: { start: d(3), finish: d(3) },
        change: 'moved',
      },
    ]);
    expect(result.readyDateChanges).toEqual([{ orderId: 'o1', before: d(1), after: d(3), days: 2 }]);
  });

  it('notices a task that is the same day but a different amount of time', () => {
    const before = run([work('a', null, 'A', 100)]);
    const after = run([work('a', null, 'A', 150)]);
    expect(diff(before, after).moved.map((m) => m.taskId)).toEqual(['a']);
  });

  it('notices a task that joined the plan and one that left it', () => {
    const before = run([work('a', 'o1', 'A', 100, { hold: 'waiting' }), work('b', 'o1', 'B', 100)], {
      orders,
    });
    const after = run([work('a', 'o1', 'A', 100), work('b', 'o1', 'B', 100, { hold: 'waiting' })], {
      orders,
    });
    const changes = Object.fromEntries(diff(before, after).moved.map((m) => [m.taskId, m.change]));
    expect(changes).toEqual({ a: 'newly_planned', b: 'no_longer_planned' });
  });

  it('shows which orders got worse and which recovered', () => {
    const calm = run([work('a', 'o1', 'A', 300)], { orders: [o('o1', d(4))] });
    const rushed = run([work('a', 'o1', 'A', 3000)], { orders: [o('o1', d(4))] });
    expect(diff(calm, rushed).newlyAtRisk).toEqual([
      { orderId: 'o1', before: 'on_track', after: 'infeasible' },
    ]);
    expect(diff(rushed, calm).recovered).toEqual([
      { orderId: 'o1', before: 'infeasible', after: 'on_track' },
    ]);
    expect(diff(calm, rushed).recovered).toEqual([]);
  });

  it('does not report a done task as moved', () => {
    const before = run([work('a', null, 'A', 100)]);
    const after = run([work('a', null, 'A', 100, { status: 'done', doneOn: d(0) })]);
    expect(diff(before, after).moved).toEqual([]);
  });

  it('lets the lace delay show up as a moved task, a later order and a new risk', () => {
    const base = (laceOn: string): PlanInput => ({
      today: MON,
      calendar: flatCalendar(MON, [300, 300, 300, 300, 300, 0, 0], 60),
      // Handover Mon d(14) with 3 days of buffer: the last day to finish is Thu d(10).
      orders: [{ id: 'o1', label: 'o1', deliveryOn: d(14), bufferDays: 3 }],
      tasks: [
        work('trim', 'o1', 'Trims', 60),
        work('finish', 'o1', 'Finish', 120),
        fixed('fit', 'o1', 'Fitting', d(2), '10:30', 30),
      ],
      edges: [follows('trim', 'finish'), follows('fit', 'finish', 1)],
      prerequisites: [
        { id: 'lace', orderId: 'o1', label: 'Lace', state: 'ordered', expectedOn: laceOn, blocking: true },
      ],
      requirements: [{ taskId: 'trim', prerequisiteId: 'lace' }],
    });
    const a = plan(base(d(1)));
    const b = plan(base(d(11))); // the lace now arrives after the last day to finish
    if (!a.ok || !b.ok) throw new Error('refused');
    expect(a.plan.orders[0]?.state).toBe('on_track');
    expect(b.plan.orders[0]?.state).toBe('at_risk');
    const result = diff(a.plan, b.plan);
    expect(result.moved.map((m) => m.taskId)).toEqual(['finish', 'trim']);
    expect(result.readyDateChanges).toEqual([{ orderId: 'o1', before: d(3), after: d(11), days: 8 }]);
    expect(result.newlyAtRisk).toEqual([{ orderId: 'o1', before: 'on_track', after: 'at_risk' }]);
  });
});
