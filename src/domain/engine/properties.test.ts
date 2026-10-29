import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { daysBetween } from '../dates';
import { diff } from './diff';
import { plan } from './plan';
import { parameters } from './testing/fc-config';
import { scenario, shuffled, START } from './testing/scenarios';
import {
  WARNING_CODES,
  type Edge,
  type OrderPlan,
  type Plan,
  type PlanInput,
  type PlannedTask,
  type Slot,
  type Task,
  type Warning,
} from './types';

/**
 * Properties that must hold for any situation at all, not just the ones written by hand. Each
 * is checked against hundreds of random atelier weeks. The rules come from docs/engine.md.
 * A failing property is a question about the engine's rules, never a reason to loosen a check.
 */

const no = (iso: string) => daysBetween(START, iso);
const TIMEOUT = 120_000;

function property(name: string, check: (world: World) => void, runs = parameters.numRuns): void {
  it(
    name,
    () => {
      fc.assert(
        fc.property(scenario, (input) => {
          const world = worldOf(input);
          if (world) check(world);
        }),
        { ...parameters, numRuns: runs },
      );
    },
    TIMEOUT,
  );
}

interface World {
  input: PlanInput;
  plan: Plan;
  /** Every task except the cancelled ones, which the engine ignores. */
  tasks: Task[];
  byId: Map<string, Task>;
  planned: Map<string, PlannedTask>;
  slots: Map<string, Slot[]>;
  /** Links whose two ends both still count. */
  edges: Edge[];
  usable: (day: string) => number;
  /** The earliest day a task may start, from today, its not-before day, what it waits for and its predecessors. */
  earliestAllowed: (id: string) => number;
  /** Tasks the engine must leave out, from the facts alone. */
  mustBeUnplanned: Set<string>;
  /** Every task that has to come before another, however far back. */
  before: (a: string, b: string) => boolean;
  /** The blocking prerequisites a task still waits for. */
  needs: (id: string) => { label: string; expectedOn: string | null }[];
}

function worldOf(input: PlanInput): World | null {
  const result = plan(input);
  if (!result.ok) return null;
  const p = result.plan;

  const tasks = input.tasks.filter((t) => t.status !== 'cancelled');
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const planned = new Map(p.tasks.map((t) => [t.id, t]));
  const slots = new Map<string, Slot[]>();
  for (const s of p.slots) slots.set(s.taskId, [...(slots.get(s.taskId) ?? []), s]);
  const edges = (input.edges ?? []).filter((e) => byId.has(e.from) && byId.has(e.to));
  const usable = (day: string) => input.calendar.usable[daysBetween(input.calendar.start, day)] ?? 0;
  const prerequisites = new Map((input.prerequisites ?? []).map((q) => [q.id, q]));
  const needs = (taskId: string) =>
    (input.requirements ?? [])
      .filter((r) => r.taskId === taskId)
      .flatMap((r) => {
        const q = prerequisites.get(r.prerequisiteId);
        return q && q.blocking && q.state !== 'received' ? [q] : [];
      });

  const earliestAllowed = (id: string): number => {
    const t = byId.get(id) as Task;
    let start = no(input.today);
    if (t.notBefore) start = Math.max(start, no(t.notBefore));
    for (const q of needs(id)) if (q.expectedOn) start = Math.max(start, no(q.expectedOn));
    for (const e of edges) {
      const finish = planned.get(e.from)?.finish;
      if (e.to === id && finish) start = Math.max(start, no(finish) + (e.lagDays ?? 0));
    }
    return start;
  };

  // Only a hold removes something she pinned. Everything else that is missing from a pinned task
  // is reported against it, and it stays where she put it.
  const pinnedIds = new Set(tasks.filter(isPinnedTask).map((t) => t.id));
  const mustBeUnplanned = new Set<string>();
  for (const t of tasks) {
    if (t.status === 'done') continue;
    const held = t.hold !== undefined && t.hold !== null;
    const undated = needs(t.id).some((q) => q.expectedOn === null);
    const noDayYet = t.kind === 'fixed' && !t.fixedAt;
    if (held || noDayYet || (undated && !pinnedIds.has(t.id))) mustBeUnplanned.add(t.id);
  }
  for (let grew = true; grew;) {
    grew = false;
    for (const e of edges) {
      const succ = byId.get(e.to) as Task;
      if (
        mustBeUnplanned.has(e.from) &&
        succ.status !== 'done' &&
        !pinnedIds.has(e.to) &&
        !mustBeUnplanned.has(e.to)
      ) {
        mustBeUnplanned.add(e.to);
        grew = true;
      }
    }
  }

  const reaches = new Map<string, Set<string>>();
  for (const t of tasks) reaches.set(t.id, new Set());
  for (let grew = true; grew;) {
    grew = false;
    for (const e of edges) {
      const set = reaches.get(e.from) as Set<string>;
      // A task that is done is a wall: what follows it no longer waits for what came before.
      const additions = [
        e.to,
        ...((byId.get(e.to) as Task).status === 'done' ? [] : (reaches.get(e.to) ?? [])),
      ];
      for (const x of additions) {
        if (!set.has(x)) {
          set.add(x);
          grew = true;
        }
      }
    }
  }

  return {
    input,
    plan: p,
    tasks,
    byId,
    planned,
    slots,
    edges,
    usable,
    earliestAllowed,
    mustBeUnplanned,
    before: (a, b) => reaches.get(a)?.has(b) ?? false,
    needs,
  };
}

const isPinnedTask = (t: Task) =>
  t.status !== 'done' && ((t.kind === 'fixed' && !!t.fixedAt) || (t.lockedSlots?.length ?? 0) > 0);
const minutesIn = (slots: Slot[] | undefined) => (slots ?? []).reduce((sum, s) => sum + s.minutes, 0);

// ---------------------------------------------------------------------------------------------
describe('the generator itself', () => {
  const sample = fc.sample(scenario, { numRuns: 1500, seed: parameters.seed });
  const results = sample.map((input) => plan(input));

  it('gives the engine situations it can plan, nearly always', () => {
    const refused = results.flatMap((r) => (r.ok ? [] : r.errors.map((e) => e.code)));
    expect(new Set(refused)).toEqual(new Set(refused.length > 0 ? ['pinned_contradiction'] : []));
    expect(refused.length).toBeLessThan(sample.length * 0.05);
  });

  it('reaches all three order states', () => {
    const states = new Set(results.flatMap((r) => (r.ok ? r.plan.orders.map((o) => o.state) : [])));
    expect([...states].sort()).toEqual(['at_risk', 'infeasible', 'on_track']);
  });

  it('reaches every kind of finding, so no rule below goes untested', () => {
    const seen = new Set(results.flatMap((r) => (r.ok ? r.plan.warnings.map((w) => w.code) : [])));
    expect(WARNING_CODES.filter((c) => !seen.has(c))).toEqual([]);
  });

  it('reaches every way a task can be placed', () => {
    const seen = new Set(results.flatMap((r) => (r.ok ? r.plan.tasks.map((t) => t.placement) : [])));
    expect([...seen].sort()).toEqual(['done', 'pinned', 'planned', 'unplanned']);
  });
});

// ---------------------------------------------------------------------------------------------
describe('her time', () => {
  property('no day carries more planned time than she has, beyond what she set by hand', (w) => {
    const load = new Map<string, { pinned: number; other: number }>();
    for (const s of w.plan.slots) {
      const row = load.get(s.day) ?? { pinned: 0, other: 0 };
      if (w.planned.get(s.taskId)?.placement === 'pinned') row.pinned += s.minutes;
      else row.other += s.minutes;
      load.set(s.day, row);
    }
    for (const [day, row] of load) {
      expect(row.other, `planned time on ${day}`).toBeLessThanOrEqual(
        Math.max(0, w.usable(day) - row.pinned),
      );
    }
  });

  property('nothing is planned on a closed day or before today, unless she put it there', (w) => {
    for (const s of w.plan.slots) {
      expect(no(s.day), `${s.taskId} on ${s.day}`).toBeGreaterThanOrEqual(no(w.input.today));
      if (w.planned.get(s.taskId)?.placement !== 'pinned') {
        expect(w.usable(s.day), `${s.taskId} on ${s.day}`).toBeGreaterThan(0);
      }
    }
  });

  property('every minute of a task is planned once, or none of it is', (w) => {
    for (const t of w.tasks) {
      const mine = w.slots.get(t.id);
      const placement = w.planned.get(t.id)?.placement;
      if (t.kind === 'wait' || t.kind === 'milestone' || placement === 'done' || placement === 'unplanned') {
        expect(mine, `${t.id} is ${placement}`).toBeUndefined();
      } else {
        expect(minutesIn(mine), t.id).toBe(t.minutes);
      }
    }
  });

  property(
    'a task takes one slot a day, and no slot but the last is shorter than the least she would sew',
    (w) => {
      const least = w.input.options?.minSlotMinutes ?? 30;
      for (const t of w.tasks) {
        const mine = w.slots.get(t.id) ?? [];
        expect(new Set(mine.map((s) => s.day)).size, `${t.id} has two slots on one day`).toBe(mine.length);
        if (w.planned.get(t.id)?.placement !== 'planned') continue;
        for (const s of mine.slice(0, -1))
          expect(s.minutes, `${t.id} on ${s.day}`).toBeGreaterThanOrEqual(least);
      }
    },
  );
});

// ---------------------------------------------------------------------------------------------
describe('what she fixed by hand', () => {
  property('fixed events and locked work stay exactly where she put them', (w) => {
    for (const t of w.tasks.filter(isPinnedTask)) {
      const placement = w.planned.get(t.id)?.placement;
      if (t.hold !== undefined && t.hold !== null) {
        expect(placement, `${t.id} is on hold`).toBe('unplanned'); // her own instruction
        continue;
      }
      expect(placement, t.id).toBe('pinned');
      const mine = (w.slots.get(t.id) ?? []).map((s) => ({ day: s.day, minutes: s.minutes, time: s.time }));
      const expected = t.fixedAt
        ? [{ day: t.fixedAt.day, minutes: t.minutes, time: t.fixedAt.time }]
        : (t.lockedSlots ?? []).map((s) => ({ ...s, time: undefined }));
      expect(mine).toEqual(expected);
    }
  });

  property('only fixed events carry a clock time', (w) => {
    for (const s of w.plan.slots) {
      expect(s.time !== undefined, s.taskId).toBe(w.byId.get(s.taskId)?.kind === 'fixed');
    }
  });

  property('what she pinned on a closed or full day is reported, never moved or hidden', (w) => {
    const said = new Set(
      w.plan.warnings
        .filter((x) => x.code === 'pinned_on_closed_day')
        .map((x) => `${x.taskId}|${x.numbers.day}`),
    );
    for (const s of w.plan.slots) {
      if (w.planned.get(s.taskId)?.placement === 'pinned' && w.usable(s.day) === 0) {
        expect(said.has(`${s.taskId}|${s.day}`), `${s.taskId} on ${s.day}`).toBe(true);
      }
    }
    for (const x of said) {
      const [id, day] = x.split('|') as [string, string];
      expect(w.usable(day), x).toBe(0);
      expect(w.planned.get(id)?.placement).toBe('pinned');
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe('the order of the work', () => {
  property('no task starts before the tasks it follows, the rest it needs, or its not-before day', (w) => {
    for (const t of w.tasks) {
      const p = w.planned.get(t.id) as PlannedTask;
      if (p.placement !== 'planned') continue;
      expect(no(p.start as string), `${t.id} starts ${p.start}`).toBeGreaterThanOrEqual(
        w.earliestAllowed(t.id),
      );
    }
  });

  property('a fixed event set too early is reported, and nothing else ever starts early', (w) => {
    const reported = new Set(
      w.plan.warnings.filter((x) => x.code === 'fixed_before_predecessor').map((x) => x.taskId),
    );
    const early = new Set<string>();
    for (const e of w.edges) {
      const [a, b] = [w.planned.get(e.from) as PlannedTask, w.planned.get(e.to) as PlannedTask];
      if (a.finish === null || b.start === null || b.placement === 'done') continue;
      if (no(b.start) < no(a.finish) + (e.lagDays ?? 0)) {
        expect(b.placement, `${e.to} starts early`).toBe('pinned');
        early.add(e.to);
      }
    }
    expect(reported).toEqual(early);
  });

  property(
    'a wait starts as soon as it may, lasts exactly its days, and a milestone sits on one day',
    (w) => {
      for (const t of w.tasks) {
        const p = w.planned.get(t.id) as PlannedTask;
        if (p.placement !== 'planned') continue;
        if (t.kind === 'wait') {
          expect(no(p.start as string), `${t.id} starts`).toBe(w.earliestAllowed(t.id));
          expect(no(p.finish as string) - no(p.start as string), `${t.id} lasts`).toBe(t.days);
        }
        if (t.kind === 'milestone') {
          expect(no(p.start as string), `${t.id} is placed`).toBe(w.earliestAllowed(t.id));
          expect(p.finish).toBe(p.start);
        }
      }
    },
  );

  property('a task starts and finishes on the first and last days it has minutes', (w) => {
    for (const t of w.tasks) {
      const mine = w.slots.get(t.id);
      const p = w.planned.get(t.id) as PlannedTask;
      if (!mine || mine.length === 0) continue;
      const days = mine.map((s) => s.day).sort();
      expect([p.start, p.finish]).toEqual([days[0], days[days.length - 1]]);
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe('what is left out', () => {
  property(
    'held tasks, appointments with no day, tasks waiting on something undated, and everything after them are left out',
    (w) => {
      for (const id of w.mustBeUnplanned) {
        const p = w.planned.get(id) as PlannedTask;
        expect(p.placement, id).toBe('unplanned');
        expect([p.start, p.finish]).toEqual([null, null]);
      }
    },
  );

  property('every task left out has exactly one reason, and nothing else is left out', (w) => {
    const reasons = new Map<string, string[]>();
    for (const x of w.plan.warnings) {
      if (
        [
          'task_on_hold',
          'fixed_undated',
          'prerequisite_undated',
          'predecessor_unplanned',
          'no_room_in_calendar',
        ].includes(x.code)
      ) {
        reasons.set(x.taskId as string, [...(reasons.get(x.taskId as string) ?? []), x.code]);
      }
    }
    for (const t of w.plan.tasks) {
      const mine = reasons.get(t.id) ?? [];
      if (t.placement === 'unplanned') {
        expect(mine, t.id).toHaveLength(1);
      } else {
        // Something pinned that is missing what it needs says so, but is not left out.
        expect(
          mine.filter((c) => c === 'task_on_hold' || c === 'no_room_in_calendar'),
          t.id,
        ).toEqual([]);
        if (t.placement !== 'pinned') expect(mine, t.id).toEqual([]);
      }
    }
  });

  property('a task whose predecessor was left out is left out too, unless she fixed it by hand', (w) => {
    for (const e of w.edges) {
      const [a, b] = [w.planned.get(e.from) as PlannedTask, w.planned.get(e.to) as PlannedTask];
      if (a.placement !== 'unplanned' || b.placement === 'done') continue;
      const successor = w.byId.get(e.to) as Task;
      const held = successor.hold !== undefined && successor.hold !== null;
      expect(b.placement, e.to).toBe(isPinnedTask(successor) && !held ? 'pinned' : 'unplanned');
    }
  });

  property(
    'what a fixed task is missing is reported against it, and nothing is reported that is not missing',
    (w) => {
      const said = (code: string) =>
        w.plan.warnings.filter(
          (x) => x.code === code && w.planned.get(x.taskId as string)?.placement === 'pinned',
        );

      const unplannedBefore = new Set<string>();
      const undated = new Set<string>();
      const tooLate = new Set<string>();
      for (const t of w.tasks.filter(isPinnedTask)) {
        if (w.planned.get(t.id)?.placement !== 'pinned') continue;
        for (const e of w.edges) {
          if (e.to === t.id && w.planned.get(e.from)?.placement === 'unplanned') {
            unplannedBefore.add(`${t.id}|${(w.byId.get(e.from) as Task).title}`);
          }
        }
        for (const q of w.needs(t.id)) if (q.expectedOn === null) undated.add(`${t.id}|${q.label}`);
        const dated = w.needs(t.id).flatMap((q) => (q.expectedOn === null ? [] : [q.expectedOn]));
        const start = w.planned.get(t.id)?.start as string;
        if (dated.some((day) => no(day) > no(start))) tooLate.add(t.id);
      }

      expect(
        new Set(said('predecessor_unplanned').map((x) => `${x.taskId}|${x.numbers.predecessor}`)),
      ).toEqual(unplannedBefore);
      expect(new Set(said('prerequisite_undated').map((x) => `${x.taskId}|${x.numbers.waitingFor}`))).toEqual(
        undated,
      );
      expect(new Set(said('fixed_before_prerequisite').map((x) => x.taskId))).toEqual(tooLate);
      for (const x of said('fixed_before_prerequisite')) {
        const start = w.planned.get(x.taskId as string)?.start as string;
        expect(x.numbers.pinnedDay).toBe(start);
        expect(x.numbers.shortfallDays).toBe(no(x.numbers.expectedOn as string) - no(start));
      }
    },
  );

  property('cancelled tasks are not in the plan, and nothing refers to them', (w) => {
    const cancelled = new Set(w.input.tasks.filter((t) => t.status === 'cancelled').map((t) => t.id));
    expect(w.plan.tasks.map((t) => t.id).filter((id) => cancelled.has(id))).toEqual([]);
    expect(w.plan.slots.filter((s) => cancelled.has(s.taskId))).toEqual([]);
    expect(w.plan.warnings.filter((x) => x.taskId !== null && cancelled.has(x.taskId))).toEqual([]);
    expect(w.plan.critical.filter((id) => cancelled.has(id))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('the promise to each order', () => {
  const byOrder = (w: World, o: OrderPlan) => w.plan.warnings.filter((x) => x.orderId === o.id);
  const SERIOUS = (x: Warning) => x.severity !== 'info';
  /** An order with nothing left to do has nothing left to plan, so it is never judged late. */
  const hasWorkLeft = (w: World, o: OrderPlan) =>
    w.tasks.some((t) => t.orderId === o.id && t.status !== 'done');

  property(
    'on_track means everything is planned and finishes by the last working day, with no warning',
    (w) => {
      for (const o of w.plan.orders.filter((x) => x.state === 'on_track')) {
        expect(byOrder(w, o).filter(SERIOUS), o.id).toEqual([]);
        expect(o.complete, o.id).toBe(true);
        if (o.readyOn !== null && hasWorkLeft(w, o)) {
          expect(no(o.readyOn), o.id).toBeLessThanOrEqual(no(o.lastWorkDay));
        }
      }
    },
  );

  property('at_risk always says why', (w) => {
    for (const o of w.plan.orders.filter((x) => x.state === 'at_risk')) {
      expect(o.reasons.length, o.id).toBeGreaterThan(0);
      expect(o.reasons, o.id).toEqual(byOrder(w, o).filter(SERIOUS));
    }
  });

  property('infeasible says so once, with the numbers behind it', (w) => {
    for (const o of w.plan.orders.filter((x) => x.state === 'infeasible')) {
      const found = byOrder(w, o).filter((x) => x.code === 'order_cannot_make_delivery');
      expect(found, o.id).toHaveLength(1);
      const numbers = (found[0] as Warning).numbers;
      expect(found[0]?.severity).toBe('problem');
      expect(typeof numbers.workMinutes).toBe('number');
      expect(typeof numbers.availableMinutes).toBe('number');
      expect(typeof numbers.deliveryOn).toBe('string');
      expect(typeof numbers.limitedBy).toBe('string');
      expect(o.reasons).toContainEqual(found[0]);
    }
  });

  property('only an infeasible order says it cannot be done, and a late one says how late', (w) => {
    for (const o of w.plan.orders) {
      const codes = byOrder(w, o).map((x) => x.code);
      expect(codes.includes('order_cannot_make_delivery'), o.id).toBe(o.state === 'infeasible');
      if (o.state === 'infeasible') expect(codes).not.toContain('order_late');
    }
  });

  property('an order with work left, ready after its last working day, is never on_track', (w) => {
    for (const o of w.plan.orders) {
      if (o.readyOn !== null && hasWorkLeft(w, o) && no(o.readyOn) > no(o.lastWorkDay)) {
        expect(o.state, o.id).not.toBe('on_track');
      }
    }
  });

  property('the buffer and lateness warnings appear exactly when the plan crosses their line', (w) => {
    for (const o of w.plan.orders) {
      const facts = (w.input.orders ?? []).find((x) => x.id === o.id);
      if (!facts) continue;
      const meant = w.tasks.filter(
        (t) => t.orderId === o.id && t.status !== 'done' && !w.mustBeUnplanned.has(t.id),
      );
      if (meant.length === 0 || o.state === 'infeasible') continue;
      // The day the plan has the last task of the order finished, counting only what is planned.
      const finishes = w.plan.tasks
        .filter((t) => t.orderId === o.id && t.placement !== 'unplanned' && t.finish !== null)
        .map((t) => no(t.finish as string));
      if (finishes.length === 0) continue;
      const ready = Math.max(...finishes);
      const lastDay = no(o.lastWorkDay);
      const lastBeforeHandover = no(facts.deliveryOn) - 1;
      const codes = byOrder(w, o).map((x) => x.code);
      expect(codes.includes('order_late'), `${o.id} late`).toBe(ready > lastBeforeHandover);
      expect(codes.includes('buffer_used'), `${o.id} buffer`).toBe(
        ready > lastDay && ready <= lastBeforeHandover,
      );
      const used = byOrder(w, o).find((x) => x.code === 'buffer_used');
      if (used) expect(used.numbers.daysIntoBuffer).toBe(ready - lastDay);
      const late = byOrder(w, o).find((x) => x.code === 'order_late');
      if (late) expect(late.numbers.lateDays).toBe(ready - lastBeforeHandover);
    }
  });

  property('the last working day is the day before handover, less the buffer', (w) => {
    for (const facts of w.input.orders ?? []) {
      const o = w.plan.orders.find((x) => x.id === facts.id) as OrderPlan;
      expect(no(o.lastWorkDay)).toBe(no(facts.deliveryOn) - 1 - facts.bufferDays);
    }
  });

  property('slack and completeness agree with the plan', (w) => {
    for (const o of w.plan.orders) {
      const ready = o.readyOn;
      expect(o.slackDays, o.id).toBe(ready === null ? null : no(o.lastWorkDay) - no(ready));
      const left = w.plan.tasks.some((t) => t.orderId === o.id && t.placement === 'unplanned');
      expect(o.complete, o.id).toBe(!left);
    }
    for (const t of w.plan.tasks) {
      if (t.slackDays !== null) {
        expect(t.latestFinish).not.toBeNull();
        expect(t.slackDays, t.id).toBe(no(t.latestFinish as string) - no(t.finish as string));
      }
    }
  });

  property('every finding carries its numbers and reads as a sentence', (w) => {
    const NEEDS_NUMBERS = new Set([
      'order_cannot_make_delivery',
      'order_late',
      'buffer_used',
      'capacity_shared',
      'task_after_latest_finish',
      'fixed_before_predecessor',
      'no_room_in_calendar',
      'prerequisite_undated',
      'predecessor_unplanned',
      'pinned_on_closed_day',
      'pinned_over_capacity',
    ]);
    for (const x of w.plan.warnings) {
      if (NEEDS_NUMBERS.has(x.code)) expect(Object.keys(x.numbers).length, x.code).toBeGreaterThan(0);
      expect(x.message.length, x.code).toBeGreaterThan(20);
      expect(x.message, x.code).not.toMatch(/undefined|NaN|Infinity|\[object|null/);
      expect(JSON.stringify(x.numbers), x.code).not.toMatch(/null|NaN|Infinity/);
    }
  });

  property(
    'a task is late only when a finding says so, and a finding names a task that really is late',
    (w) => {
      const named = new Set(
        w.plan.warnings.filter((x) => x.code === 'task_after_latest_finish').map((x) => x.taskId),
      );
      const late = w.plan.tasks.filter((t) => t.slackDays !== null && t.slackDays < 0);
      for (const id of named) expect(late.map((t) => t.id)).toContain(id);
      if (late.length > 0) expect(named.size).toBeGreaterThan(0);
      for (const x of w.plan.warnings.filter((y) => y.code === 'task_after_latest_finish')) {
        const t = w.planned.get(x.taskId as string) as PlannedTask;
        expect(x.numbers.lateDays).toBe(-(t.slackDays as number));
      }
    },
  );
});

// ---------------------------------------------------------------------------------------------
describe('the bounds behind the verdicts', () => {
  // The bounds are proven for plans that respect every link. When she has fixed something earlier
  // than the work it needs, the plan has to break that link, says so (fixed_before_predecessor),
  // and may then finish sooner than any plan that kept it.
  const respectsEveryLink = (w: World) => !w.plan.warnings.some((x) => x.code === 'fixed_before_predecessor');

  property('no task is planned to finish sooner than its proven earliest finish', (w) => {
    if (!respectsEveryLink(w)) return;
    for (const t of w.plan.tasks) {
      if (t.placement === 'done' || t.placement === 'unplanned') continue;
      expect(t.earliestFinish, t.id).not.toBeNull();
      expect(no(t.earliestFinish as string), t.id).toBeLessThanOrEqual(no(t.finish as string));
    }
  });

  property('no order is planned to be ready sooner than its proven earliest ready day', (w) => {
    if (!respectsEveryLink(w)) return;
    for (const o of w.plan.orders) {
      if (o.readyOn === null || o.earliestReadyOn === null) continue;
      expect(no(o.earliestReadyOn), o.id).toBeLessThanOrEqual(no(o.readyOn));
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe('the day as she sees it', () => {
  property('a day is numbered from 1 with no gaps, and listed in that order', (w) => {
    const days = new Map<string, Slot[]>();
    for (const s of w.plan.slots) days.set(s.day, [...(days.get(s.day) ?? []), s]);
    expect(w.plan.slots.map((s) => s.day)).toEqual([...w.plan.slots.map((s) => s.day)].sort());
    for (const [day, list] of days)
      expect(
        list.map((s) => s.rank),
        day,
      ).toEqual(list.map((_, i) => i + 1));
  });

  property('every task comes after the tasks it follows', (w) => {
    const days = new Map<string, Slot[]>();
    for (const s of w.plan.slots) days.set(s.day, [...(days.get(s.day) ?? []), s]);
    for (const [day, list] of days) {
      for (const a of list) {
        for (const b of list) {
          if (a !== b && w.before(a.taskId, b.taskId)) {
            expect(a.rank, `${a.taskId} before ${b.taskId} on ${day}`).toBeLessThan(b.rank);
          }
        }
      }
    }
  });

  property('fixed events come first by clock time, unless work has to come before them', (w) => {
    const days = new Map<string, Slot[]>();
    for (const s of w.plan.slots) days.set(s.day, [...(days.get(s.day) ?? []), s]);
    for (const [day, list] of days) {
      const free = list.filter(
        (s) => s.time !== undefined && !list.some((o) => o !== s && w.before(o.taskId, s.taskId)),
      );
      for (const e of free) {
        for (const other of list.filter((o) => o.time === undefined)) {
          expect(e.rank, `${e.taskId} against ${other.taskId} on ${day}`).toBeLessThan(other.rank);
        }
        for (const f of free) {
          if (
            e !== f &&
            ((e.time as string) < (f.time as string) || (e.time === f.time && e.taskId < f.taskId))
          ) {
            expect(e.rank, `${e.taskId} against ${f.taskId} on ${day}`).toBeLessThan(f.rank);
          }
        }
      }
    }
  });

  property('the chain that sets an order’s ready day ends at the last task to finish', (w) => {
    expect(new Set(w.plan.critical)).toEqual(
      new Set(w.plan.tasks.filter((t) => t.critical).map((t) => t.id)),
    );
    for (const o of w.plan.orders) {
      const open = w.plan.tasks.filter(
        (t) => t.orderId === o.id && (t.placement === 'planned' || t.placement === 'pinned'),
      );
      if (open.length === 0) continue;
      const last = open.map((t) => no(t.finish as string)).reduce((x, y) => Math.max(x, y));
      const onChain = open.filter((t) => t.critical);
      expect(
        onChain.map((t) => no(t.finish as string)),
        o.id,
      ).toContain(last);
      for (const t of onChain) expect(t.placement === 'planned' || t.placement === 'pinned').toBe(true);
    }
    for (const t of w.plan.tasks) if (t.critical) expect(t.orderId).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
describe('the same facts always give the same plan', () => {
  it(
    'twice over gives the identical text, and never changes the input',
    () => {
      fc.assert(
        fc.property(scenario, (input) => {
          const before = JSON.stringify(input);
          const first = JSON.stringify(plan(input));
          expect(JSON.stringify(plan(input))).toBe(first);
          expect(JSON.stringify(input)).toBe(before);
        }),
        parameters,
      );
    },
    TIMEOUT,
  );

  it(
    'is not changed by the order the lists were written in',
    () => {
      fc.assert(
        fc.property(scenario, fc.array(fc.integer(), { minLength: 60, maxLength: 60 }), (input, keys) => {
          expect(JSON.stringify(plan(shuffled(input, keys)))).toBe(JSON.stringify(plan(input)));
        }),
        parameters,
      );
    },
    TIMEOUT,
  );

  it(
    'is not changed by renaming nothing but the titles',
    () => {
      fc.assert(
        fc.property(scenario, (input) => {
          const retitled: PlanInput = {
            ...input,
            tasks: input.tasks.map((t) => ({ ...t, title: t.title.toUpperCase() })),
          };
          const a = plan(input);
          const b = plan(retitled);
          if (!a.ok || !b.ok) return expect(a.ok).toBe(b.ok);
          expect(b.plan.slots).toEqual(a.plan.slots);
          expect(b.plan.orders.map((o) => o.state)).toEqual(a.plan.orders.map((o) => o.state));
        }),
        parameters,
      );
    },
    TIMEOUT,
  );
});

// ---------------------------------------------------------------------------------------------
describe('what changed between two plans', () => {
  property('a plan compared with itself has no change', (w) => {
    expect(diff(w.plan, w.plan)).toEqual({ moved: [], newlyAtRisk: [], recovered: [], readyDateChanges: [] });
  });

  it(
    'is the same story read backwards',
    () => {
      fc.assert(
        fc.property(scenario, fc.nat(11), (input, which) => {
          const held: PlanInput = {
            ...input,
            tasks: input.tasks.map((t, i) =>
              i === which % input.tasks.length ? { ...t, hold: 'paused' } : t,
            ),
          };
          const [a, b] = [plan(input), plan(held)];
          if (!a.ok || !b.ok) return;
          const forward = diff(a.plan, b.plan);
          const backward = diff(b.plan, a.plan);
          expect(backward.moved.map((m) => m.taskId)).toEqual(forward.moved.map((m) => m.taskId));
          expect(backward.newlyAtRisk.map((r) => [r.orderId, r.after, r.before])).toEqual(
            forward.recovered.map((r) => [r.orderId, r.before, r.after]),
          );
          expect(backward.recovered.map((r) => [r.orderId, r.after, r.before])).toEqual(
            forward.newlyAtRisk.map((r) => [r.orderId, r.before, r.after]),
          );
          expect(backward.readyDateChanges.map((r) => [r.orderId, r.after, r.before])).toEqual(
            forward.readyDateChanges.map((r) => [r.orderId, r.before, r.after]),
          );
        }),
        parameters,
      );
    },
    TIMEOUT,
  );
});
