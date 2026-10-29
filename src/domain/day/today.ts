import { formatDay, type IsoDate } from '../dates';
import type { Slot, TaskKind } from '../engine/types';
import type { PrerequisiteState } from '../orders/prerequisites';

/**
 * Today's list (docs/my-day.md, "Today's list"): the approved plan's slots for today, with each task as it stands now.
 * Pure: the page reads rows, calls this, and lays the result out.
 */

export type TaskStatus = 'not_started' | 'in_progress' | 'done';

export interface LiveTask {
  id: string;
  orderId: string | null;
  /** "Order #1, bridal gown", or empty for studio work. */
  orderLabel: string | null;
  title: string;
  kind: TaskKind;
  minutes: number | null;
  status: TaskStatus;
  remainingMinutes: number | null;
  actualMinutes: number | null;
  holdReason: string;
}

export interface Item {
  id: string;
  label: string;
  state: PrerequisiteState;
  expectedOn: IsoDate | null;
  blocking: boolean;
}

export type TodayState = 'done' | 'started' | 'held' | 'blocked' | 'ready';

export interface TodayEntry {
  task: LiveTask;
  /** Minutes the plan gives it today; none for a task that is not on today's plan. */
  minutesToday: number;
  /** Appointments only. */
  time: string | null;
  state: TodayState;
  /** Why it is blocked or held, in her words. */
  reason: string | null;
  /** Whether its minutes count in today's planned time: not when blocked or held. */
  counted: boolean;
}

export interface Today {
  entries: TodayEntry[];
  /** Started on another day or not on today's plan, and not finished. */
  alsoStarted: TodayEntry[];
  /** Studio work the approved plan does not place yet: it waits for the next proposal. */
  waitingForADay: LiveTask[];
  plannedMinutes: number;
  usableMinutes: number;
  freeMinutes: number;
}

/** What holds a task back now: the first blocking item it needs that has not arrived. */
export function blockedBy(
  taskId: string,
  needs: readonly { taskId: string; itemId: string }[],
  items: readonly Item[],
): string | null {
  const missing = needs
    .filter((n) => n.taskId === taskId)
    .map((n) => items.find((i) => i.id === n.itemId))
    .filter((i): i is Item => i !== undefined && i.blocking && i.state !== 'received');
  if (missing.length === 0) return null;
  return missing
    .map((i) =>
      i.expectedOn === null
        ? `${i.label} not received, and no expected day yet.`
        : `${i.label} not received. Expected ${formatDay(i.expectedOn)}.`,
    )
    .join(' ');
}

function entryFor(
  task: LiveTask,
  minutesToday: number,
  time: string | null,
  needs: readonly { taskId: string; itemId: string }[],
  items: readonly Item[],
): TodayEntry {
  if (task.status === 'done') return { task, minutesToday, time, state: 'done', reason: null, counted: true };
  if (task.holdReason !== '')
    return { task, minutesToday, time, state: 'held', reason: task.holdReason, counted: false };
  const blocked = task.status === 'in_progress' ? null : blockedBy(task.id, needs, items);
  if (blocked !== null)
    return { task, minutesToday, time, state: 'blocked', reason: blocked, counted: false };
  return {
    task,
    minutesToday,
    time,
    state: task.status === 'in_progress' ? 'started' : 'ready',
    reason: null,
    counted: true,
  };
}

export function buildToday(input: {
  today: IsoDate;
  usableMinutes: number;
  /** All slots of the approved plan, or none when there is no approved plan. */
  slots: readonly Slot[];
  tasks: readonly LiveTask[];
  needs: readonly { taskId: string; itemId: string }[];
  items: readonly Item[];
}): Today {
  const byId = new Map(input.tasks.map((t) => [t.id, t]));
  const todays = input.slots.filter((s) => s.day === input.today).sort((a, b) => a.rank - b.rank);
  const entries = todays.flatMap((s) => {
    const task = byId.get(s.taskId);
    return task ? [entryFor(task, s.minutes, s.time ?? null, input.needs, input.items)] : [];
  });

  const onToday = new Set(entries.map((e) => e.task.id));
  const alsoStarted = input.tasks
    .filter((t) => t.status === 'in_progress' && !onToday.has(t.id))
    .map((t) => entryFor(t, 0, null, input.needs, input.items));

  const planned = new Set(input.slots.map((s) => s.taskId));
  const waitingForADay = input.tasks.filter(
    (t) => t.orderId === null && t.status !== 'done' && !planned.has(t.id),
  );

  const plannedMinutes = entries.filter((e) => e.counted).reduce((sum, e) => sum + e.minutesToday, 0);
  return {
    entries,
    alsoStarted,
    waitingForADay,
    plannedMinutes,
    usableMinutes: input.usableMinutes,
    freeMinutes: Math.max(0, input.usableMinutes - plannedMinutes),
  };
}

/** Today's tasks that are not finished, and everything in progress: what the end-of-day review asks about. */
export function toReview(today: Today): TodayEntry[] {
  const open = [...today.entries, ...today.alsoStarted].filter((e) => e.task.status !== 'done');
  const seen = new Set<string>();
  return open.filter((e) => (seen.has(e.task.id) ? false : (seen.add(e.task.id), true)));
}
