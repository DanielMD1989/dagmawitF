import { addDays, daysBetween, type IsoDate } from '../dates';
import type { OrderStatus } from '../orders/status';

/**
 * Her calendar (docs/calendar-first.md): every step of her open jobs and her studio work, by day. Pure: the server
 * reads the rows, this decides what goes where.
 */

export interface JobRef {
  id: string;
  number: number;
  /** What it is, in her words. */
  title: string;
  /** Null for an event, such as a bazaar. */
  clientName: string | null;
  dueOn: IsoDate;
  status: OrderStatus;
}

export interface Step {
  id: string;
  title: string;
  onDay: IsoDate | null;
  untilDay: IsoDate | null;
  /** 'HH:MM' */
  startsAt: string | null;
  endsAt: string | null;
  doneOn: IsoDate | null;
  /** Null for her studio work. */
  job: JobRef | null;
}

export interface Entry {
  step: Step;
  /** For a step over several days: which day of how many this is. */
  part: { n: number; of: number } | null;
  /** Another step with a time overlaps it on this day. */
  clash: boolean;
}

export interface AgendaDay {
  day: IsoDate;
  entries: Entry[];
}

export interface Agenda {
  /** Not done, and its last day has passed. Oldest first. */
  overdue: Step[];
  days: AgendaDay[];
  /** Not done, and not given a day yet. */
  undated: Step[];
}

/** A job's steps are on her calendar while it is confirmed; studio work always is. */
export function isOnCalendar(step: Step): boolean {
  return step.job === null || step.job.status === 'active';
}

export const lastDayOf = (step: Step): IsoDate | null => step.untilDay ?? step.onDay;

export function isOverdue(step: Step, today: IsoDate): boolean {
  const last = lastDayOf(step);
  return step.doneOn === null && last !== null && last < today;
}

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** The times of two steps cross: from–to times that overlap, or the same start. A start with no end is that moment. */
export function timesOverlap(
  a: Pick<Step, 'startsAt' | 'endsAt'>,
  b: Pick<Step, 'startsAt' | 'endsAt'>,
): boolean {
  if (!a.startsAt || !b.startsAt) return false;
  const as = minutes(a.startsAt);
  const bs = minutes(b.startsAt);
  if (as === bs) return true;
  const ae = a.endsAt ? minutes(a.endsAt) : as;
  const be = b.endsAt ? minutes(b.endsAt) : bs;
  return as < be && bs < ae;
}

/** Two steps are on at least one day together. */
function shareADay(a: Pick<Step, 'onDay' | 'untilDay'>, b: Pick<Step, 'onDay' | 'untilDay'>): boolean {
  if (!a.onDay || !b.onDay) return false;
  return a.onDay <= (b.untilDay ?? b.onDay) && b.onDay <= (a.untilDay ?? a.onDay);
}

/**
 * The step on her calendar whose time a new or changed step would cross, if any (decision 0067): her time is hers
 * once, so such a step is not saved. Steps done, of jobs not on her calendar, or the step itself do not count.
 */
export function findClash(
  candidate: Pick<Step, 'onDay' | 'untilDay' | 'startsAt' | 'endsAt'> & { id?: string },
  steps: readonly Step[],
): Step | null {
  if (!candidate.startsAt || !candidate.onDay) return null;
  return (
    steps.find(
      (s) =>
        s.id !== candidate.id &&
        s.doneOn === null &&
        isOnCalendar(s) &&
        shareADay(candidate, s) &&
        timesOverlap(candidate, s),
    ) ?? null
  );
}

function byTimeThenDue(a: Entry, b: Entry): number {
  const ta = a.step.startsAt;
  const tb = b.step.startsAt;
  if (ta && tb && ta !== tb) return ta < tb ? -1 : 1;
  if (ta && !tb) return -1;
  if (!ta && tb) return 1;
  const da = a.step.job?.dueOn ?? '9999-12-31';
  const db = b.step.job?.dueOn ?? '9999-12-31';
  if (da !== db) return da < db ? -1 : 1;
  return a.step.title.localeCompare(b.step.title);
}

export function entriesOn(steps: readonly Step[], day: IsoDate): Entry[] {
  const entries = steps
    .filter((s) => isOnCalendar(s) && s.onDay !== null && s.onDay <= day && day <= lastDayOf(s)!)
    .map((step): Entry => {
      const of = step.untilDay ? daysBetween(step.onDay!, step.untilDay) + 1 : 1;
      return {
        step,
        part: of > 1 ? { n: daysBetween(step.onDay!, day) + 1, of } : null,
        clash: false,
      };
    });
  const timed = entries.filter((e) => e.step.startsAt && e.step.doneOn === null);
  for (const a of timed) {
    for (const b of timed) {
      if (a === b) continue;
      if (timesOverlap(a.step, b.step)) a.clash = true;
    }
  }
  return entries.sort(byTimeThenDue);
}

export function buildAgenda(steps: readonly Step[], today: IsoDate, days = 7): Agenda {
  const onCalendar = steps.filter(isOnCalendar);
  return {
    overdue: onCalendar
      .filter((s) => isOverdue(s, today))
      .sort((a, b) => (lastDayOf(a)! < lastDayOf(b)! ? -1 : lastDayOf(a)! > lastDayOf(b)! ? 1 : 0)),
    days: Array.from({ length: days }, (_, i) => {
      const day = addDays(today, i);
      return { day, entries: entriesOn(onCalendar, day) };
    }),
    undated: onCalendar.filter((s) => s.onDay === null && s.doneOn === null),
  };
}

/** How many open steps are on each day of a month, for the month view. Keys are days with at least one. */
export function monthCounts(steps: readonly Step[], first: IsoDate, last: IsoDate): Map<IsoDate, number> {
  const counts = new Map<IsoDate, number>();
  for (const s of steps) {
    if (!isOnCalendar(s) || s.onDay === null || s.doneOn !== null) continue;
    const from = s.onDay < first ? first : s.onDay;
    const to = lastDayOf(s)! > last ? last : lastDayOf(s)!;
    for (let d = from; d <= to; d = addDays(d, 1)) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return counts;
}

/** What to tell her about one job's steps, in plain words. */
export function jobWarnings(steps: readonly Step[], dueOn: IsoDate, today: IsoDate): string[] {
  const out: string[] = [];
  for (const s of steps) {
    if (s.doneOn !== null) continue;
    const last = lastDayOf(s);
    if (last !== null && last > dueOn) out.push(`“${s.title}” is after the job’s day.`);
    else if (isOverdue(s, today)) out.push(`“${s.title}” was due and is not done.`);
  }
  return out;
}
