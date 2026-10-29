import { daysBetween, type IsoDate } from '../dates';
import type { CalendarException, WorkDay } from '../calendar/types';
import { buildCalendar } from '../engine/calendar';
import type { Edge, OrderFacts, PlanInput, Prerequisite, Requirement, Task, TaskKind } from '../engine/types';
import { orderLabel } from '../orders/display';
import type { PrerequisiteState } from '../orders/prerequisites';
import { isPlanned, type OrderStatus } from '../orders/status';

/**
 * What the engine is given, from what is stored: the one mapping between the two (docs/planning.md,
 * "Proposing a plan"). Pure, so it is tested on its own and the server only reads rows and calls it.
 */

export interface PlanningFacts {
  today: IsoDate;
  calendar: { week: readonly WorkDay[]; exceptions: readonly CalendarException[]; planningRatio: number };
  orders: readonly {
    id: string;
    number: number;
    status: OrderStatus;
    deliveryOn: IsoDate;
    bufferDays: number;
    garmentTypes: readonly string[];
  }[];
  tasks: readonly {
    id: string;
    /** Empty for studio work (decision 0044). */
    orderId: string | null;
    /** The garment it is for, as the order calls it. Empty for studio work. */
    garment: string | null;
    title: string;
    kind: TaskKind;
    minutes: number | null;
    days: number | null;
    fixedOn: IsoDate | null;
    fixedTime: string | null;
    notBefore: IsoDate | null;
    /** Progress (docs/my-day.md). */
    status: 'not_started' | 'in_progress' | 'done';
    doneOn: IsoDate | null;
    remainingMinutes: number | null;
    /** Empty when not on hold. */
    holdReason: string;
    /** Work pinned to a day (docs/change.md). */
    pinnedOn: IsoDate | null;
  }[];
  edges: readonly { from: string; to: string; lagDays: number }[];
  prerequisites: readonly {
    id: string;
    orderId: string;
    label: string;
    state: PrerequisiteState;
    expectedOn: IsoDate | null;
    blocking: boolean;
  }[];
  requirements: readonly { taskId: string; prerequisiteId: string }[];
}

/** The calendar is at least this long, so a plan always shows the coming months. */
export const MIN_CALENDAR_DAYS = 120;
/** And at most this long: two years ahead is beyond anything she plans. */
export const MAX_CALENDAR_DAYS = 730;
/** Days of calendar after the last date anything mentions, so late work still finds room and says how late. */
export const CALENDAR_MARGIN_DAYS = 30;

/** How many days the calendar must cover: past the last day any fact mentions, within the limits above. */
export function calendarLength(today: IsoDate, days: readonly (IsoDate | null)[]): number {
  const last = days.reduce<number>((far, d) => (d === null ? far : Math.max(far, daysBetween(today, d))), 0);
  return Math.min(MAX_CALENDAR_DAYS, Math.max(MIN_CALENDAR_DAYS, last + 1 + CALENDAR_MARGIN_DAYS));
}

export function buildPlanInput(facts: PlanningFacts): PlanInput {
  // Only an active order takes her time: a draft promises nothing, a held order waits, a closed one is done.
  const orders = facts.orders.filter((o) => isPlanned(o.status));
  const planned = new Set(orders.map((o) => o.id));
  // Studio work has no order and no promise; the engine plans it after every order.
  const tasks = facts.tasks.filter((t) => t.orderId === null || planned.has(t.orderId));
  const taskIds = new Set(tasks.map((t) => t.id));
  const prerequisites = facts.prerequisites.filter((p) => planned.has(p.orderId));
  const prerequisiteIds = new Set(prerequisites.map((p) => p.id));

  const engineOrders: OrderFacts[] = orders.map((o) => ({
    id: o.id,
    label: orderLabel(o.number, o.garmentTypes),
    deliveryOn: o.deliveryOn,
    bufferDays: o.bufferDays,
  }));

  const engineTasks: Task[] = tasks.map((t) => {
    const task: Task = { id: t.id, orderId: t.orderId, title: t.title, kind: t.kind };
    // While in progress the engine plans what is left: her estimate of it, or the whole estimate.
    const minutes = t.status === 'in_progress' ? (t.remainingMinutes ?? t.minutes) : t.minutes;
    if (minutes !== null) task.minutes = minutes;
    if (t.status !== 'not_started') task.status = t.status;
    if (t.status === 'done' && t.doneOn !== null) task.doneOn = t.doneOn;
    if (t.holdReason !== '') task.hold = t.holdReason;
    // A pin puts all of what is left on its day. Once the day has passed it cannot be kept, and the task is planned
    // like any other (decision 0048).
    if (
      t.kind === 'work' &&
      t.pinnedOn !== null &&
      t.pinnedOn >= facts.today &&
      t.status !== 'done' &&
      minutes !== null
    )
      task.lockedSlots = [{ day: t.pinnedOn, minutes }];
    if (t.days !== null) task.days = t.days;
    if (t.notBefore !== null) task.notBefore = t.notBefore;
    // An appointment with no day yet is given none: the engine leaves it out and says so (decision 0032).
    if (t.kind === 'fixed' && t.fixedOn !== null && t.fixedTime !== null)
      task.fixedAt = { day: t.fixedOn, time: t.fixedTime };
    return task;
  });

  const edges: Edge[] = facts.edges
    .filter((e) => taskIds.has(e.from) && taskIds.has(e.to))
    .map((e) => ({ from: e.from, to: e.to, lagDays: e.lagDays }));

  const enginePrerequisites: Prerequisite[] = prerequisites.map((p) => ({
    id: p.id,
    orderId: p.orderId,
    label: p.label,
    state: p.state,
    expectedOn: p.expectedOn,
    blocking: p.blocking,
  }));

  const requirements: Requirement[] = facts.requirements
    .filter((r) => taskIds.has(r.taskId) && prerequisiteIds.has(r.prerequisiteId))
    .map((r) => ({ taskId: r.taskId, prerequisiteId: r.prerequisiteId }));

  const length = calendarLength(facts.today, [
    ...orders.map((o) => o.deliveryOn),
    ...tasks.flatMap((t) => [t.fixedOn, t.notBefore, t.pinnedOn]),
    ...prerequisites.map((p) => p.expectedOn),
  ]);

  return {
    today: facts.today,
    calendar: buildCalendar(facts.calendar, facts.today, length),
    tasks: engineTasks,
    edges,
    orders: engineOrders,
    prerequisites: enginePrerequisites,
    requirements,
  };
}
