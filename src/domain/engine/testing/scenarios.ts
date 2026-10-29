import fc from 'fast-check';
import { toMinutes } from '../../calendar/time';
import { addDays, daysBetween, type IsoDate } from '../../dates';
import type {
  Edge,
  LockedSlot,
  OrderFacts,
  PlanInput,
  Prerequisite,
  PrerequisiteState,
  Requirement,
  Task,
  TaskKind,
  TaskStatus,
} from '../types';

/**
 * Random but valid situations for the property tests: a few orders, up to a dozen tasks of
 * every kind, links between them, fittings and locked work, things being waited for, and a
 * calendar with odd leftover minutes. They are meant to look like a real atelier week, only
 * more awkward, so a rule that holds for all of them holds for hers.
 *
 * "Valid" means the engine should plan it. The one exception is two pinned things that
 * contradict each other, which the generator avoids but cannot always rule out.
 */

/** A Monday. Day 0 of every generated calendar. */
export const START: IsoDate = '2026-10-26';
/** The longest calendar. Shorter ones, down to MIN_CALENDAR_DAYS, make running out of room possible. */
export const CALENDAR_DAYS = 50;
const MIN_CALENDAR_DAYS = 30;
export const MAX_TASKS = 12;
const ORDER_COUNT = 3;
const PREREQUISITE_COUNT = 3;

const choose = <T>(...values: T[]): fc.Arbitrary<T> => fc.constantFrom(...values);
/** `null` most of the time, a value one time in `outOf`. */
const sometimes = <T>(arb: fc.Arbitrary<T>, outOf: number): fc.Arbitrary<T | null> =>
  fc.oneof({ weight: outOf - 1, arbitrary: fc.constant(null) }, { weight: 1, arbitrary: arb });

const taskSpec = fc.record({
  kind: choose<TaskKind>('work', 'work', 'work', 'work', 'wait', 'fixed', 'milestone'),
  order: fc.integer({ min: -1, max: ORDER_COUNT - 1 }),
  minutes: fc.oneof(
    { weight: 3, arbitrary: fc.integer({ min: 5, max: 60 }) },
    { weight: 4, arbitrary: fc.integer({ min: 30, max: 600 }) },
    { weight: 1, arbitrary: fc.integer({ min: 600, max: 2400 }) },
  ),
  days: fc.integer({ min: 1, max: 4 }),
  status: choose<TaskStatus>(
    'not_started',
    'not_started',
    'not_started',
    'not_started',
    'not_started',
    'in_progress',
    'in_progress',
    'done',
    'cancelled',
  ),
  doneBack: fc.integer({ min: 0, max: 5 }),
  notBefore: sometimes(fc.integer({ min: 0, max: 20 }), 5),
  deadline: sometimes(fc.integer({ min: 1, max: 40 }), 6),
  hold: sometimes(choose('', 'waiting for the client'), 14),
  priority: fc.integer({ min: -2, max: 2 }),
  lock: sometimes(fc.uniqueArray(fc.integer({ min: 0, max: 24 }), { minLength: 1, maxLength: 3 }), 7),
  fixedDay: fc.integer({ min: 0, max: 24 }),
  fixedHour: fc.integer({ min: 8, max: 16 }),
  fixedHalf: fc.boolean(),
  /** Now and then an appointment whose day has not been agreed yet. */
  fixedUndated: fc.integer({ min: 0, max: 7 }).map((n) => n === 0),
});
type ValueOf<A> = A extends fc.Arbitrary<infer T> ? T : never;
type TaskSpec = ValueOf<typeof taskSpec>;

const weekday = choose(315, 315, 300, 240, 200, 150, 100, 0);
const weekend = choose(0, 0, 0, 0, 120);

const scenarioSpec = fc.record({
  todayOffset: fc.integer({ min: 0, max: 5 }),
  calendarDays: fc.integer({ min: MIN_CALENDAR_DAYS, max: CALENDAR_DAYS }),
  week: fc.tuple(weekday, weekday, weekday, weekday, weekday, weekend, weekend),
  overrides: fc.array(
    fc.record({
      day: fc.integer({ min: 0, max: MIN_CALENDAR_DAYS - 1 }),
      minutes: fc.oneof(fc.constant(0), fc.integer({ min: 10, max: 480 })),
    }),
    { maxLength: 6 },
  ),
  orders: fc.array(
    fc.record({ delivery: fc.integer({ min: 3, max: 40 }), buffer: fc.integer({ min: 0, max: 3 }) }),
    { minLength: ORDER_COUNT, maxLength: ORDER_COUNT },
  ),
  tasks: fc.array(taskSpec, { minLength: 1, maxLength: MAX_TASKS }),
  edges: fc.array(
    fc.record({
      a: fc.nat(MAX_TASKS - 1),
      b: fc.nat(MAX_TASKS - 1),
      lag: choose(0, 0, 0, 1, 1, 2, 3),
    }),
    { maxLength: 14 },
  ),
  prerequisites: fc.array(
    fc.record({
      order: fc.integer({ min: -1, max: ORDER_COUNT - 1 }),
      state: choose<PrerequisiteState>('needed', 'ordered', 'ordered', 'received'),
      expected: fc.oneof(
        { weight: 1, arbitrary: fc.constant(null) },
        { weight: 3, arbitrary: fc.integer({ min: 0, max: 35 }) },
      ),
      blocking: choose(true, true, true, false),
    }),
    { maxLength: PREREQUISITE_COUNT },
  ),
  requirements: fc.array(
    fc.record({ task: fc.nat(MAX_TASKS - 1), prerequisite: fc.nat(PREREQUISITE_COUNT - 1) }),
    { maxLength: 5 },
  ),
  minSlot: choose(30, 30, 30, 1, 45, 60),
});
type ScenarioSpec = ValueOf<typeof scenarioSpec>;

function makeTask(s: TaskSpec, index: number, today: IsoDate): Task {
  const at = (offset: number) => addDays(today, offset);
  const status: TaskStatus = s.status === 'in_progress' && s.kind !== 'work' ? 'not_started' : s.status;
  const task: Task = {
    id: `t${index}`,
    orderId: s.order < 0 ? null : `o${s.order}`,
    title: `Task ${index}`,
    kind: s.kind,
    status,
    priority: s.priority,
  };
  if (s.notBefore !== null) task.notBefore = at(s.notBefore);
  if (s.deadline !== null) task.deadline = at(s.deadline);
  if (s.hold !== null) task.hold = s.hold;

  const time = `${String(s.fixedHour).padStart(2, '0')}:${s.fixedHalf ? '30' : '00'}`;
  if (s.kind === 'work') task.minutes = s.minutes;
  if (s.kind === 'wait') task.days = s.days;
  if (s.kind === 'fixed') {
    task.minutes = 30 + (s.minutes % 6) * 30;
    if (!s.fixedUndated) task.fixedAt = { day: at(s.fixedDay), time };
  }

  if (status === 'done') {
    const doneOn = addDays(today, -s.doneBack);
    task.doneOn = doneOn < START ? START : doneOn;
    if (s.kind === 'fixed') task.fixedAt = { day: task.doneOn, time };
  }

  if (s.kind === 'work' && s.lock !== null && (status === 'not_started' || status === 'in_progress')) {
    const offsets = [...s.lock].sort((x, y) => x - y).slice(0, Math.min(s.lock.length, s.minutes));
    const each = Math.floor(s.minutes / offsets.length);
    const slots: LockedSlot[] = offsets.map((offset, i) => ({
      day: at(offset),
      minutes: i === 0 ? s.minutes - each * (offsets.length - 1) : each,
    }));
    task.lockedSlots = slots;
  }
  return task;
}

/** Where a task is pinned or done, as day numbers, or null when it can move. */
function pinSpan(t: Task): { start: number; finish: number } | null {
  const no = (iso: IsoDate) => daysBetween(START, iso);
  if (t.status === 'cancelled') return null;
  if (t.status === 'done') return t.doneOn ? { start: no(t.doneOn), finish: no(t.doneOn) } : null;
  if (t.kind === 'fixed' && t.fixedAt) return { start: no(t.fixedAt.day), finish: no(t.fixedAt.day) };
  const slots = t.lockedSlots;
  if (slots && slots.length > 0) {
    return {
      start: no((slots[0] as LockedSlot).day),
      finish: no((slots[slots.length - 1] as LockedSlot).day),
    };
  }
  return null;
}

/** Two pinned things that cannot both stand: the engine would refuse them. */
function contradicts(from: Task, to: Task, lag: number): boolean {
  if (to.status === 'done' || to.status === 'cancelled') return false;
  const a = pinSpan(from);
  const b = pinSpan(to);
  const toPinned = (to.kind === 'fixed' && to.fixedAt) || (to.lockedSlots && to.lockedSlots.length > 0);
  if (!a || !b || !toPinned) return false;
  if (a.finish + lag > b.start) return true;
  if (
    lag === 0 &&
    from.status !== 'done' &&
    from.kind === 'fixed' &&
    to.kind === 'fixed' &&
    from.fixedAt &&
    to.fixedAt &&
    from.fixedAt.day === to.fixedAt.day
  ) {
    return toMinutes(from.fixedAt.time) + (from.minutes ?? 0) > toMinutes(to.fixedAt.time);
  }
  return false;
}

export function build(spec: ScenarioSpec): PlanInput {
  const today = addDays(START, spec.todayOffset);
  const usable = Array.from({ length: spec.calendarDays }, (_, i) => spec.week[i % 7] ?? 0);
  for (const o of spec.overrides) usable[o.day] = o.minutes;

  const orders: OrderFacts[] = spec.orders.map((o, i) => ({
    id: `o${i}`,
    label: `Order ${i}`,
    deliveryOn: addDays(today, o.delivery),
    bufferDays: o.buffer,
  }));
  const tasks = spec.tasks.map((s, i) => makeTask(s, i, today));

  const edges: Edge[] = [];
  const seen = new Set<string>();
  for (const e of spec.edges) {
    const [a, b] = [e.a % tasks.length, e.b % tasks.length];
    if (a === b) continue;
    const [from, to] = a < b ? [a, b] : [b, a];
    const [f, t] = [tasks[from] as Task, tasks[to] as Task];
    if (f.orderId !== t.orderId || seen.has(`${from}>${to}`)) continue;
    if (contradicts(f, t, e.lag)) continue;
    seen.add(`${from}>${to}`);
    edges.push({ from: f.id, to: t.id, lagDays: e.lag });
  }

  const prerequisites: Prerequisite[] = spec.prerequisites.map((p, i) => ({
    id: `p${i}`,
    orderId: p.order < 0 ? null : `o${p.order}`,
    label: `Prerequisite ${i}`,
    state: p.state,
    expectedOn: p.expected === null ? null : addDays(START, p.expected),
    blocking: p.blocking,
  }));
  const requirements: Requirement[] = [];
  const linked = new Set<string>();
  if (prerequisites.length > 0) {
    for (const r of spec.requirements) {
      const taskId = `t${r.task % tasks.length}`;
      const prerequisiteId = `p${r.prerequisite % prerequisites.length}`;
      if (linked.has(`${taskId}|${prerequisiteId}`)) continue;
      linked.add(`${taskId}|${prerequisiteId}`);
      requirements.push({ taskId, prerequisiteId });
    }
  }

  return {
    today,
    calendar: { start: START, usable },
    tasks,
    edges,
    orders,
    prerequisites,
    requirements,
    options: { minSlotMinutes: spec.minSlot },
  };
}

export const scenario: fc.Arbitrary<PlanInput> = scenarioSpec.map(build);

/**
 * The same facts with every list in another order, chosen by `keys`. The engine must not be
 * able to tell the difference.
 */
export function shuffled(input: PlanInput, keys: readonly number[]): PlanInput {
  const reorder = <T>(items: readonly T[] | undefined, salt: number): T[] | undefined =>
    items
      ?.map((item, index) => ({ item, index, key: keys[(index * 7 + salt) % Math.max(keys.length, 1)] ?? 0 }))
      .sort((a, b) => a.key - b.key || a.index - b.index)
      .map((entry) => entry.item);
  return {
    ...input,
    tasks: (reorder(input.tasks, 0) ?? []).map((t) =>
      t.lockedSlots ? { ...t, lockedSlots: [...t.lockedSlots].reverse() } : t,
    ),
    edges: reorder(input.edges, 1),
    orders: reorder(input.orders, 2),
    prerequisites: reorder(input.prerequisites, 3),
    requirements: reorder(input.requirements, 4),
  };
}
