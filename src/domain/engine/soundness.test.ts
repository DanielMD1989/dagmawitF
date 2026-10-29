import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays } from '../dates';
import { plan } from './plan';
import { parameters, RUNS } from './testing/fc-config';
import type { Edge, PlanInput, Prerequisite, Requirement, Task } from './types';

/**
 * "Cannot be done" is the strongest thing the engine ever tells her, so it must never be wrong.
 * This checks it against a search that tries every way of spending her minutes on tiny orders.
 * If any schedule at all gets the order ready in time, the engine must not say it is impossible.
 *
 * The search shares no code with the engine. It works from the facts alone: minutes per day,
 * what must follow what, the days things cannot start before, and the day of handover.
 */

const START = '2026-10-26';
const CALENDAR_DAYS = 8;

interface Tiny {
  input: PlanInput;
  /** The last day (counted from the start) on which work may finish: the day before handover. */
  limit: number;
}

const choose = <T>(...values: T[]): fc.Arbitrary<T> => fc.constantFrom(...values);
const sometimes = <T>(arb: fc.Arbitrary<T>, outOf: number): fc.Arbitrary<T | null> =>
  fc.oneof({ weight: outOf - 1, arbitrary: fc.constant(null) }, { weight: 1, arbitrary: arb });

function tiny(options: { links: boolean; waits: boolean; chain?: boolean }): fc.Arbitrary<Tiny> {
  return fc
    .record({
      cap: fc.array(fc.integer({ min: 0, max: 6 }), { minLength: CALENDAR_DAYS, maxLength: CALENDAR_DAYS }),
      delivery: fc.integer({ min: 1, max: CALENDAR_DAYS - 1 }),
      tasks: fc.array(
        fc.record({
          wait: options.waits ? choose(false, false, false, true) : fc.constant(false),
          minutes: fc.integer({ min: 1, max: 6 }),
          days: fc.integer({ min: 1, max: 2 }),
          notBefore: sometimes(fc.integer({ min: 0, max: 4 }), 3),
          arrives: sometimes(fc.integer({ min: 0, max: 4 }), 4),
        }),
        { minLength: 1, maxLength: 4 },
      ),
      edges: options.links
        ? fc.array(fc.record({ a: fc.nat(3), b: fc.nat(3), lag: choose(0, 0, 1, 2) }), { maxLength: 4 })
        : fc.constant([]),
      chainLags: fc.array(choose(0, 0, 1, 2), { minLength: 3, maxLength: 3 }),
    })
    .map((spec): Tiny => {
      const tasks: Task[] = spec.tasks.map((t, i) => {
        const base: Task = { id: `t${i}`, orderId: 'o', title: `Task ${i}`, kind: t.wait ? 'wait' : 'work' };
        if (t.wait) base.days = t.days;
        else base.minutes = t.minutes;
        if (t.notBefore !== null) base.notBefore = addDays(START, t.notBefore);
        return base;
      });
      const edges: Edge[] = [];
      const seen = new Set<string>();
      // A chain: each task follows the one before it. That is the shape of most real orders.
      if (options.chain) {
        tasks.slice(1).forEach((t, i) => {
          edges.push({ from: `t${i}`, to: t.id, lagDays: spec.chainLags[i] ?? 0 });
        });
      }
      for (const e of options.chain ? [] : spec.edges) {
        const [a, b] = [e.a % tasks.length, e.b % tasks.length];
        if (a === b || seen.has(`${Math.min(a, b)}>${Math.max(a, b)}`)) continue;
        seen.add(`${Math.min(a, b)}>${Math.max(a, b)}`);
        edges.push({ from: `t${Math.min(a, b)}`, to: `t${Math.max(a, b)}`, lagDays: e.lag });
      }
      const prerequisites: Prerequisite[] = [];
      const requirements: Requirement[] = [];
      spec.tasks.forEach((t, i) => {
        if (t.arrives === null) return;
        prerequisites.push({
          id: `p${i}`,
          orderId: 'o',
          label: `Material ${i}`,
          state: 'ordered',
          expectedOn: addDays(START, t.arrives),
          blocking: true,
        });
        requirements.push({ taskId: `t${i}`, prerequisiteId: `p${i}` });
      });
      return {
        limit: spec.delivery - 1,
        input: {
          today: START,
          calendar: { start: START, usable: spec.cap },
          tasks,
          edges,
          orders: [{ id: 'o', label: 'The order', deliveryOn: addDays(START, spec.delivery), bufferDays: 0 }],
          prerequisites,
          requirements,
          options: { minSlotMinutes: 1 },
        },
      };
    });
}

/** Is there any way at all to finish every task by `limit`? Tries every split of every day. */
function canBeDone({ input, limit }: Tiny): boolean {
  const cap = input.calendar.usable;
  const tasks = input.tasks;
  const n = tasks.length;
  const day = (iso: string) => Math.round((Date.parse(iso) - Date.parse(START)) / 86_400_000);
  const preds: { from: number; lag: number }[][] = tasks.map(() => []);
  for (const e of input.edges ?? []) {
    const [from, to] = [tasks.findIndex((t) => t.id === e.from), tasks.findIndex((t) => t.id === e.to)];
    preds[to]?.push({ from, lag: e.lagDays ?? 0 });
  }
  const notBefore = tasks.map((t) => (t.notBefore ? day(t.notBefore) : 0));
  const arrives = tasks.map((t) => {
    const needs = (input.requirements ?? []).filter((r) => r.taskId === t.id);
    return Math.max(
      0,
      ...needs.map((r) =>
        day((input.prerequisites ?? []).find((p) => p.id === r.prerequisiteId)?.expectedOn as string),
      ),
    );
  });

  // finish[i] is the day a work task was completed, once it has been.
  const finishOf = (i: number, finish: readonly (number | undefined)[]): number | undefined => {
    if (tasks[i]?.kind === 'work') return finish[i];
    const start = startOf(i, finish);
    return start === Infinity ? undefined : start + (tasks[i]?.days ?? 0);
  };
  const startOf = (i: number, finish: readonly (number | undefined)[]): number => {
    let start = Math.max(notBefore[i] ?? 0, arrives[i] ?? 0);
    for (const p of preds[i] ?? []) {
      const f = finishOf(p.from, finish);
      if (f === undefined) return Infinity;
      start = Math.max(start, f + p.lag);
    }
    return start;
  };

  const seen = new Map<string, boolean>();
  const startDay = (t: number, remaining: number[], finish: (number | undefined)[]): boolean => {
    if (remaining.every((r) => r === 0)) {
      return tasks.every((_, i) => {
        const f = finishOf(i, finish);
        return f !== undefined && f <= limit;
      });
    }
    if (t > limit) return false;
    const key = `${t}|${remaining.join(',')}|${finish.join(',')}`;
    const known = seen.get(key);
    if (known !== undefined) return known;
    const result = spend(t, 0, cap[t] ?? 0, remaining, finish);
    seen.set(key, result);
    return result;
  };
  // Decide, task by task in order, how much of today's time each one gets.
  const spend = (
    t: number,
    i: number,
    left: number,
    remaining: number[],
    finish: (number | undefined)[],
  ): boolean => {
    if (i === n) return startDay(t + 1, remaining, finish);
    const need = remaining[i] ?? 0;
    if (tasks[i]?.kind !== 'work' || need === 0 || startOf(i, finish) > t) {
      return spend(t, i + 1, left, remaining, finish);
    }
    for (let x = Math.min(need, left); x >= 0; x--) {
      const nextRemaining = [...remaining];
      const nextFinish = [...finish];
      nextRemaining[i] = need - x;
      if (need - x === 0) nextFinish[i] = t;
      if (spend(t, i + 1, left - x, nextRemaining, nextFinish)) return true;
    }
    return false;
  };

  return startDay(
    0,
    tasks.map((t) => (t.kind === 'work' ? (t.minutes ?? 0) : 0)),
    tasks.map(() => undefined),
  );
}

const verdict = (t: Tiny) => {
  const result = plan(t.input);
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join(' | '));
  return result.plan.orders[0]?.state === 'infeasible';
};

describe('"cannot be done" is never said of something that can be done', () => {
  it('holds for tasks that depend on each other, wait for materials and for days', () => {
    fc.assert(
      fc.property(tiny({ links: true, waits: true }), (t) => {
        if (verdict(t)) expect(canBeDone(t), JSON.stringify(t)).toBe(false);
      }),
      { ...parameters, numRuns: RUNS * 5 },
    );
  }, 300_000);
});

describe('and for tasks that depend on nothing it is exact', () => {
  // With no links the only limits are her days and the days things cannot start before, and then
  // the engine's bound is not just safe but complete: it says "cannot" exactly when that is true.
  it('says so exactly when no schedule exists', () => {
    fc.assert(
      fc.property(tiny({ links: false, waits: false }), (t) => {
        expect(verdict(t), JSON.stringify(t)).toBe(!canBeDone(t));
      }),
      { ...parameters, numRuns: RUNS * 5 },
    );
  }, 300_000);
});

describe('and for a chain of tasks, each following the one before, it is exact too', () => {
  // Pattern, toile, fitting, cut: most orders are chains. With links, waits, gaps and materials
  // arriving on given days, the bound still says "cannot" exactly when that is true.
  it('says so exactly when no schedule exists', () => {
    fc.assert(
      fc.property(tiny({ links: true, waits: true, chain: true }), (t) => {
        expect(verdict(t), JSON.stringify(t)).toBe(!canBeDone(t));
      }),
      { ...parameters, numRuns: RUNS * 5 },
    );
  }, 300_000);
});

describe('the search itself', () => {
  const sample = fc.sample(tiny({ links: true, waits: true }), { numRuns: 600, seed: parameters.seed });

  it('meets both kinds of case, so the checks above are not vacuous', () => {
    const possible = sample.filter(canBeDone).length;
    const impossible = sample.length - possible;
    expect(possible).toBeGreaterThan(60);
    expect(impossible).toBeGreaterThan(60);
    expect(sample.filter(verdict).length).toBeGreaterThan(20);
  });

  it('knows a simple case by hand', () => {
    const base: PlanInput = {
      today: START,
      calendar: { start: START, usable: [3, 3, 3, 3, 3, 3, 3, 3] },
      tasks: [{ id: 't0', orderId: 'o', title: 'A', kind: 'work', minutes: 6 }],
      orders: [{ id: 'o', label: 'O', deliveryOn: addDays(START, 2), bufferDays: 0 }],
      options: { minSlotMinutes: 1 },
    };
    expect(canBeDone({ input: base, limit: 1 })).toBe(true); // 3 + 3 over two days
    expect(
      canBeDone({ input: { ...base, tasks: [{ ...(base.tasks[0] as Task), minutes: 7 }] }, limit: 1 }),
    ).toBe(false);
    expect(
      canBeDone({
        input: { ...base, tasks: [{ ...(base.tasks[0] as Task), notBefore: addDays(START, 1) }] },
        limit: 1,
      }),
    ).toBe(false);
  });
});
