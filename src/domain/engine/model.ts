import { addDays, daysBetween, isIsoDate, type IsoDate } from '../dates';
import { isTimeOfDay, toMinutes } from '../calendar/time';
import type { TimeOfDay } from '../calendar/types';
import type { ErrorCode, PlanInput, Prerequisite, TaskKind, ValidationError } from './types';

/** Minutes since midnight as HH:MM, for messages. */
const clockText = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * Step 1 of the engine: check the facts and turn them into the form the passes work on.
 * Inside the engine a day is a whole number counted from `calendar.start`, and every list is
 * sorted by id, so the order the caller listed things in can never change the answer.
 */

export interface Link {
  /** Index of the other node. */
  node: number;
  lag: number;
}

export interface Node {
  /** Position in `Model.nodes`, which is sorted by id. */
  i: number;
  id: string;
  title: string;
  /** Index into `Model.orders`, or -1 for studio work. */
  orderIdx: number;
  kind: TaskKind;
  inProgress: boolean;
  done: boolean;
  minutes: number;
  days: number;
  notBefore: number | null;
  /** Fixed events: the day and clock time. */
  fixedDay: number | null;
  fixedTime: string | null;
  deadline: number | null;
  /** Work she pinned, sorted by day. */
  locked: { day: number; minutes: number }[] | null;
  doneDay: number | null;
  hold: string | null;
  priority: number;
  preds: Link[];
  succs: Link[];
  /** Latest expected arrival of a blocking prerequisite that has not arrived, if any has a date. */
  prereqDay: number | null;
  /** The prerequisite that sets `prereqDay`. */
  prereqLabel: string | null;
  /** Blocking prerequisites not yet received that have no expected date. */
  undated: string[];
}

export interface OrderModel {
  id: string;
  label: string;
  deliveryDay: number;
  bufferDays: number;
  /** The last day work may finish: the day before handover, less the buffer. */
  lastDay: number;
}

export interface Model {
  startDate: IsoDate;
  today: number;
  /** Number of days in the calendar. */
  horizon: number;
  /** Planner minutes per day. Days before today are closed. */
  cap: number[];
  minSlot: number;
  /** Everything except cancelled tasks, sorted by id. */
  nodes: Node[];
  /** Node indexes in a stable order where every task comes after its predecessors. */
  topo: number[];
  orders: OrderModel[];
}

export const DEFAULT_MIN_SLOT_MINUTES = 30;

/** Compare by code unit, so the result never depends on the machine's language settings. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Fixed events and locked work: placed where she put them, never moved by the engine. */
export function isPinned(n: Node): boolean {
  return !n.done && (n.fixedDay !== null || n.locked !== null);
}

/** First day a pinned task occupies. */
export function pinnedStart(n: Node): number {
  if (n.fixedDay !== null) return n.fixedDay;
  const first = n.locked?.[0];
  if (first === undefined) throw new Error(`Task ${n.id} is not pinned`);
  return first.day;
}

/** Last day a pinned task occupies. */
export function pinnedFinish(n: Node): number {
  if (n.fixedDay !== null) return n.fixedDay;
  const last = n.locked?.[n.locked.length - 1];
  if (last === undefined) throw new Error(`Task ${n.id} is not pinned`);
  return last.day;
}

type Details = ValidationError['details'];

class Errors {
  readonly list: ValidationError[] = [];
  add(code: ErrorCode, subject: string | null, message: string, details: Details = {}) {
    this.list.push({ code, subject, message, details });
  }
  get any() {
    return this.list.length > 0;
  }
}

const KINDS: readonly string[] = ['work', 'wait', 'fixed', 'milestone'];
const STATUSES: readonly string[] = ['not_started', 'in_progress', 'done', 'cancelled'];

const isWhole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

export function buildModel(
  input: PlanInput,
): { ok: true; model: Model } | { ok: false; errors: ValidationError[] } {
  const errors = new Errors();
  const { calendar } = input;

  // --- the calendar and today ---------------------------------------------------------------
  const dateOk = (value: unknown, subject: string | null, what: string): value is IsoDate => {
    if (typeof value === 'string' && isIsoDate(value)) return true;
    errors.add('bad_date', subject, `${what} is not a calendar date (YYYY-MM-DD): ${String(value)}`, {
      value: String(value),
    });
    return false;
  };

  if (!dateOk(calendar.start, null, 'The calendar start') || !dateOk(input.today, null, 'Today')) {
    return { ok: false, errors: errors.list };
  }
  const horizon = calendar.usable.length;
  calendar.usable.forEach((minutes, index) => {
    if (!isWhole(minutes) || minutes < 0) {
      errors.add(
        'bad_capacity',
        null,
        `Day ${index} of the calendar has ${String(minutes)} minutes. It needs a whole number, 0 or more.`,
        {
          day: addDays(calendar.start, index),
        },
      );
    }
  });
  const today = daysBetween(calendar.start, input.today);
  if (today < 0 || today >= horizon) {
    errors.add(
      'today_outside_calendar',
      null,
      `Today (${input.today}) is not inside the calendar, which starts ${calendar.start} and covers ${horizon} days.`,
      { today: input.today, start: calendar.start, days: horizon },
    );
  }
  if (errors.any) return { ok: false, errors: errors.list };

  const dayOf = (iso: IsoDate) => daysBetween(calendar.start, iso);

  // --- unique ids ---------------------------------------------------------------------------
  const seen = (kind: string, ids: string[]) => {
    const found = new Set<string>();
    for (const id of ids) {
      if (found.has(id)) errors.add('duplicate_id', id, `Two ${kind} share the id "${id}".`, { id });
      found.add(id);
    }
    return found;
  };
  const orders = input.orders ?? [];
  const edges = input.edges ?? [];
  const prerequisites = input.prerequisites ?? [];
  const requirements = input.requirements ?? [];
  const taskIds = seen(
    'tasks',
    input.tasks.map((t) => t.id),
  );
  const orderIds = seen(
    'orders',
    orders.map((o) => o.id),
  );
  const prerequisiteIds = seen(
    'prerequisites',
    prerequisites.map((p) => p.id),
  );

  // --- orders -------------------------------------------------------------------------------
  const orderModels: OrderModel[] = [];
  for (const o of [...orders].sort((a, b) => compareText(a.id, b.id))) {
    if (!dateOk(o.deliveryOn, o.id, `The delivery day of ${o.label}`)) continue;
    if (!isWhole(o.bufferDays) || o.bufferDays < 0) {
      errors.add(
        'bad_buffer',
        o.id,
        `${o.label} has a buffer of ${String(o.bufferDays)} days. It needs a whole number, 0 or more.`,
        {
          bufferDays: String(o.bufferDays),
        },
      );
      continue;
    }
    const deliveryDay = dayOf(o.deliveryOn);
    orderModels.push({
      id: o.id,
      label: o.label,
      deliveryDay,
      bufferDays: o.bufferDays,
      lastDay: deliveryDay - 1 - o.bufferDays,
    });
  }
  const orderIndex = new Map(orderModels.map((o, i) => [o.id, i]));

  // --- prerequisites ------------------------------------------------------------------------
  const prereqById = new Map<string, Prerequisite>();
  for (const p of prerequisites) {
    prereqById.set(p.id, p);
    if (p.orderId !== null && !orderIds.has(p.orderId)) {
      errors.add(
        'unknown_order',
        p.id,
        `The prerequisite "${p.label}" belongs to an order that is not in the plan: ${p.orderId}.`,
        {
          orderId: p.orderId,
        },
      );
    }
    if (p.expectedOn !== null) dateOk(p.expectedOn, p.id, `The expected day of "${p.label}"`);
  }

  // --- tasks --------------------------------------------------------------------------------
  const nodes: Node[] = [];
  const taskById = new Map(input.tasks.map((t) => [t.id, t]));
  for (const t of [...input.tasks].sort((a, b) => compareText(a.id, b.id))) {
    const status = t.status ?? 'not_started';
    if (!KINDS.includes(t.kind)) {
      errors.add(
        'unknown_kind',
        t.id,
        `"${t.title}" has a kind the engine does not know: ${String(t.kind)}.`,
        { kind: String(t.kind) },
      );
      continue;
    }
    if (!STATUSES.includes(status)) {
      errors.add(
        'unknown_status',
        t.id,
        `"${t.title}" has a status the engine does not know: ${String(status)}.`,
        { status: String(status) },
      );
      continue;
    }
    if (t.orderId !== null && !orderIds.has(t.orderId)) {
      errors.add(
        'unknown_order',
        t.id,
        `"${t.title}" belongs to an order that is not in the plan: ${t.orderId}.`,
        { orderId: t.orderId },
      );
    }
    if (status === 'cancelled') continue;

    const minutes = t.minutes ?? 0;
    const days = t.days ?? 0;
    const isDone = status === 'done';

    if (!isDone) {
      if ((t.kind === 'work' || t.kind === 'fixed') && !(isWhole(minutes) && minutes > 0)) {
        errors.add('missing_estimate', t.id, `"${t.title}" has no estimate. Say how many minutes it takes.`, {
          minutes: String(t.minutes),
        });
      }
      if (t.kind === 'wait' && !(isWhole(days) && days > 0)) {
        errors.add('wait_without_days', t.id, `"${t.title}" is a wait but does not say how many days.`, {
          days: String(t.days),
        });
      }
    }

    let fixedDay: number | null = null;
    let fixedTime: string | null = null;
    if (t.kind === 'fixed' && !isDone) {
      // No day yet (a fitting not agreed with the client) is not an error: the task is left out of
      // the plan and named (`fixed_undated`, passes.ts). A time that is not a clock time is refused.
      const at = t.fixedAt;
      if (!at) {
        // left for findUnplanned
      } else if (!isTimeOfDay(at.time)) {
        errors.add(
          'fixed_without_time',
          t.id,
          `"${t.title}" is a fixed event but its time is not a clock time (HH:MM).`,
          { time: String(at.time) },
        );
      } else if (dateOk(at.day, t.id, `The day of "${t.title}"`)) {
        fixedDay = dayOf(at.day);
        fixedTime = at.time;
        if (fixedDay < today) {
          errors.add(
            'fixed_event_in_past',
            t.id,
            `"${t.title}" is fixed on ${at.day}, which has passed. Mark it done or move it.`,
            { day: at.day, today: input.today },
          );
        } else if (fixedDay >= horizon) {
          errors.add(
            'beyond_calendar',
            t.id,
            `"${t.title}" is on ${at.day}, beyond the end of the calendar.`,
            { day: at.day, calendarDays: horizon },
          );
        }
      }
    }

    let locked: Node['locked'] = null;
    if (t.lockedSlots && t.lockedSlots.length > 0 && !isDone) {
      if (t.kind !== 'work') {
        errors.add('locked_not_work', t.id, `"${t.title}" has locked slots but is not work.`, {
          kind: t.kind,
        });
      } else {
        const slots: { day: number; minutes: number }[] = [];
        const daysSeen = new Set<string>();
        let total = 0;
        let ok = true;
        for (const s of t.lockedSlots) {
          if (!dateOk(s.day, t.id, `A locked day of "${t.title}"`)) {
            ok = false;
            continue;
          }
          if (!isWhole(s.minutes) || s.minutes <= 0 || daysSeen.has(s.day)) {
            errors.add(
              'locked_mismatch',
              t.id,
              `"${t.title}" has a locked slot on ${s.day} that is empty or repeated.`,
              { day: s.day },
            );
            ok = false;
            continue;
          }
          daysSeen.add(s.day);
          total += s.minutes;
          const day = dayOf(s.day);
          if (day < today) {
            errors.add(
              'locked_slot_in_past',
              t.id,
              `"${t.title}" is locked on ${s.day}, which has passed. Unlock it.`,
              { day: s.day, today: input.today },
            );
            ok = false;
          } else if (day >= horizon) {
            errors.add(
              'beyond_calendar',
              t.id,
              `"${t.title}" is locked on ${s.day}, beyond the end of the calendar.`,
              { day: s.day, calendarDays: horizon },
            );
            ok = false;
          }
          slots.push({ day, minutes: s.minutes });
        }
        if (ok && total !== minutes) {
          errors.add(
            'locked_mismatch',
            t.id,
            `"${t.title}" needs ${minutes} minutes but its locked slots add up to ${total}.`,
            { minutes, locked: total },
          );
        } else if (ok) {
          locked = slots.sort((a, b) => a.day - b.day);
        }
      }
    }

    let doneDay: number | null = null;
    if (isDone) {
      if (t.doneOn == null) {
        errors.add('done_without_date', t.id, `"${t.title}" is done but has no finish day.`, {});
      } else if (dateOk(t.doneOn, t.id, `The finish day of "${t.title}"`)) {
        doneDay = dayOf(t.doneOn);
      }
    }

    let notBefore: number | null = null;
    if (t.notBefore != null && dateOk(t.notBefore, t.id, `The earliest start of "${t.title}"`))
      notBefore = dayOf(t.notBefore);
    let deadline: number | null = null;
    if (t.deadline != null && dateOk(t.deadline, t.id, `The deadline of "${t.title}"`))
      deadline = dayOf(t.deadline);

    nodes.push({
      i: nodes.length,
      id: t.id,
      title: t.title,
      orderIdx: t.orderId === null ? -1 : (orderIndex.get(t.orderId) ?? -1),
      kind: t.kind,
      inProgress: status === 'in_progress',
      done: isDone,
      minutes: isDone ? 0 : minutes,
      days: isDone ? 0 : days,
      notBefore,
      fixedDay,
      fixedTime,
      deadline,
      locked,
      doneDay,
      hold: t.hold ?? null,
      priority: t.priority ?? 0,
      preds: [],
      succs: [],
      prereqDay: null,
      prereqLabel: null,
      undated: [],
    });
  }

  // --- requirements -------------------------------------------------------------------------
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  for (const r of [...requirements].sort(
    (a, b) => compareText(a.taskId, b.taskId) || compareText(a.prerequisiteId, b.prerequisiteId),
  )) {
    if (!taskIds.has(r.taskId)) {
      errors.add(
        'unknown_task',
        r.taskId,
        `A requirement refers to a task that does not exist: ${r.taskId}.`,
        { taskId: r.taskId },
      );
      continue;
    }
    if (!prerequisiteIds.has(r.prerequisiteId)) {
      errors.add(
        'unknown_prerequisite',
        r.prerequisiteId,
        `A requirement refers to a prerequisite that does not exist: ${r.prerequisiteId}.`,
        { prerequisiteId: r.prerequisiteId },
      );
      continue;
    }
    const node = nodeById.get(r.taskId);
    const p = prereqById.get(r.prerequisiteId);
    if (!node || !p || node.done || !p.blocking || p.state === 'received') continue;
    if (p.expectedOn === null || !isIsoDate(p.expectedOn)) {
      node.undated.push(p.label);
    } else {
      const day = dayOf(p.expectedOn);
      if (node.prereqDay === null || day > node.prereqDay) {
        node.prereqDay = day;
        node.prereqLabel = p.label;
      }
    }
  }
  for (const n of nodes) n.undated.sort(compareText);

  // --- links --------------------------------------------------------------------------------
  const pairs = new Set<string>();
  for (const e of [...edges].sort((a, b) => compareText(a.from, b.from) || compareText(a.to, b.to))) {
    const lag = e.lagDays ?? 0;
    if (!taskIds.has(e.from) || !taskIds.has(e.to)) {
      errors.add(
        'unknown_task',
        `${e.from} -> ${e.to}`,
        `A link refers to a task that does not exist: ${taskIds.has(e.from) ? e.to : e.from}.`,
        { from: e.from, to: e.to },
      );
      continue;
    }
    if (e.from === e.to) {
      errors.add('edge_to_self', e.from, `A task cannot follow itself: ${e.from}.`, { taskId: e.from });
      continue;
    }
    if (!isWhole(lag) || lag < 0) {
      errors.add(
        'bad_lag',
        `${e.from} -> ${e.to}`,
        `The gap between two tasks must be a whole number of days, 0 or more (got ${String(e.lagDays)}).`,
        { lagDays: String(e.lagDays) },
      );
      continue;
    }
    const a = nodeById.get(e.from);
    const b = nodeById.get(e.to);
    if (!a || !b) continue; // one end is cancelled: the link falls away
    if (taskById.get(e.from)?.orderId !== taskById.get(e.to)?.orderId) {
      errors.add(
        'cross_order_edge',
        `${e.from} -> ${e.to}`,
        `"${a.title}" and "${b.title}" belong to different orders, and tasks may only follow tasks of their own order.`,
        { from: e.from, to: e.to },
      );
      continue;
    }
    const key = `${e.from}\u0000${e.to}`;
    if (pairs.has(key)) {
      // The same link twice: keep the longest gap.
      const existing = a.succs.find((l) => l.node === b.i);
      if (existing && lag > existing.lag) {
        existing.lag = lag;
        const back = b.preds.find((l) => l.node === a.i);
        if (back) back.lag = lag;
      }
      continue;
    }
    pairs.add(key);
    a.succs.push({ node: b.i, lag });
    b.preds.push({ node: a.i, lag });
  }
  for (const n of nodes) {
    n.preds.sort((x, y) => x.node - y.node);
    n.succs.sort((x, y) => x.node - y.node);
  }

  if (errors.any) return { ok: false, errors: errors.list };

  // --- cycles -------------------------------------------------------------------------------
  const topo = topologicalOrder(nodes);
  if (topo.length < nodes.length) {
    const left = new Set(nodes.map((n) => n.i));
    for (const i of topo) left.delete(i);
    errors.add(
      'cycle',
      null,
      `These tasks wait on each other in a circle: ${cycleThrough(nodes, left).join(' -> ')}.`,
      {
        tasks: cycleThrough(nodes, left),
      },
    );
    return { ok: false, errors: errors.list };
  }

  // --- pinned things that contradict each other ---------------------------------------------
  for (const b of nodes) {
    if (!isPinned(b) || b.done) continue;
    for (const link of b.preds) {
      const a = nodes[link.node];
      if (!a) continue;
      const aFinish = a.done ? a.doneDay : isPinned(a) ? pinnedFinish(a) : null;
      if (aFinish === null) continue;
      const earliest = aFinish + link.lag;

      // Two fixed events on one day, the second meant to come after the first: their clock times
      // must agree, or the day cannot be shown in an order that makes sense.
      if (
        earliest === pinnedStart(b) &&
        a.fixedDay !== null &&
        b.fixedDay !== null &&
        a.fixedDay === b.fixedDay &&
        a.fixedTime !== null &&
        b.fixedTime !== null
      ) {
        const endsAt = toMinutes(a.fixedTime as TimeOfDay) + a.minutes;
        if (endsAt > toMinutes(b.fixedTime as TimeOfDay)) {
          errors.add(
            'pinned_contradiction',
            b.id,
            `"${b.title}" starts at ${b.fixedTime} on ${addDays(calendar.start, b.fixedDay)}, but "${a.title}" which it follows runs until ${clockText(endsAt)} that day. Move one of them.`,
            {
              task: b.id,
              after: a.id,
              taskDay: addDays(calendar.start, b.fixedDay),
              startsAt: b.fixedTime,
              predecessorEndsAt: clockText(endsAt),
            },
          );
        }
        continue;
      }

      if (earliest > pinnedStart(b)) {
        errors.add(
          'pinned_contradiction',
          b.id,
          `"${b.title}" is set for ${addDays(calendar.start, pinnedStart(b))}, but "${a.title}" which it follows is fixed to finish ${addDays(calendar.start, aFinish)}${link.lag > 0 ? ` and then needs ${link.lag} day${link.lag === 1 ? '' : 's'}` : ''}. Move one of them.`,
          {
            task: b.id,
            after: a.id,
            taskDay: addDays(calendar.start, pinnedStart(b)),
            predecessorFinish: addDays(calendar.start, aFinish),
            lagDays: link.lag,
          },
        );
      }
    }
  }
  if (errors.any) return { ok: false, errors: errors.list };

  const cap = calendar.usable.map((m, d) => (d < today ? 0 : m));
  return {
    ok: true,
    model: {
      startDate: calendar.start,
      today,
      horizon,
      cap,
      minSlot: Math.max(1, input.options?.minSlotMinutes ?? DEFAULT_MIN_SLOT_MINUTES),
      nodes,
      topo,
      orders: orderModels,
    },
  };
}

/** Kahn's algorithm, always taking the lowest index first, so the order is the same every time. */
function topologicalOrder(nodes: Node[]): number[] {
  const waiting = nodes.map((n) => n.preds.length);
  const ready: number[] = [];
  nodes.forEach((n, i) => {
    if (n.preds.length === 0) ready.push(i);
  });
  const out: number[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => a - b);
    const i = ready.shift() as number;
    out.push(i);
    for (const link of nodes[i]?.succs ?? []) {
      const remaining = (waiting[link.node] ?? 0) - 1;
      waiting[link.node] = remaining;
      if (remaining === 0) ready.push(link.node);
    }
  }
  return out;
}

/** Ids of one circle among the tasks left over after ordering, starting from the lowest id. */
function cycleThrough(nodes: Node[], left: Set<number>): string[] {
  let current = Math.min(...left);
  const path: number[] = [];
  const at = new Map<number, number>();
  while (!at.has(current)) {
    at.set(current, path.length);
    path.push(current);
    const next = nodes[current]?.succs.find((l) => left.has(l.node));
    if (!next) break;
    current = next.node;
  }
  const circle = path.slice(at.get(current) ?? 0);
  const lowest = circle.reduce(
    (best, i, k) => (compareText(nodes[i]?.id ?? '', nodes[circle[best] as number]?.id ?? '') < 0 ? k : best),
    0,
  );
  const rotated = [...circle.slice(lowest), ...circle.slice(0, lowest)];
  return [...rotated, rotated[0] as number].map((i) => nodes[i]?.id ?? '');
}

/**
 * For each task, the indexes of every task that must come before it, directly or through
 * others. A task that is done is a wall: it satisfies what follows it from the day it was
 * finished, so the work behind it, even if that was skipped and is still open, no longer
 * has to come first.
 */
export function ancestorSets(model: Pick<Model, 'nodes' | 'topo'>): Set<number>[] {
  const sets = model.nodes.map(() => new Set<number>());
  for (const i of model.topo) {
    const set = sets[i];
    if (!set) continue;
    for (const link of model.nodes[i]?.preds ?? []) {
      set.add(link.node);
      if (model.nodes[link.node]?.done) continue;
      for (const a of sets[link.node] ?? []) set.add(a);
    }
  }
  return sets;
}
