import { addDays, formatDay, type IsoDate } from '../dates';
import { KIND_WORDS } from '../jobs/kinds';
import type { Entry, JobRef, Step } from './agenda';

/** The words her calendar shows for a step. One place, so the screens and the offline copy say the same. */

/** "#7 · Hana · New order" */
export function jobLabel(job: JobRef): string {
  return `#${job.number} · ${job.clientName} · ${KIND_WORDS[job.kind].label}`;
}

/** "09:00–13:00", "09:00", or null. */
export function timeLabel(step: Pick<Step, 'startsAt' | 'endsAt'>): string | null {
  if (!step.startsAt) return null;
  return step.endsAt ? `${step.startsAt}–${step.endsAt}` : step.startsAt;
}

/** "Day 2 of 5" for a step over several days. */
export function partLabel(entry: Pick<Entry, 'part'>): string | null {
  return entry.part ? `Day ${entry.part.n} of ${entry.part.of}` : null;
}

/** "Today", "Tomorrow", or "Wed 4 Nov". */
export function dayHeading(day: IsoDate, today: IsoDate): string {
  if (day === today) return 'Today';
  if (day === addDays(today, 1)) return 'Tomorrow';
  return formatDay(day);
}

/** "Tue 10 Nov", or "Tue 10 – Fri 13 Nov" for a step over several days, or "No day yet". */
export function daysLabel(step: Pick<Step, 'onDay' | 'untilDay'>): string {
  if (!step.onDay) return 'No day yet';
  return step.untilDay ? `${formatDay(step.onDay)} – ${formatDay(step.untilDay)}` : formatDay(step.onDay);
}
