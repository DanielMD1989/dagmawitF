import { addDays, formatDay, type IsoDate } from '../dates';
import { KIND_WORDS } from '../jobs/kinds';
import type { Entry, JobRef, Step } from './agenda';

/** The words her calendar shows for a step. One place, so the screens and the offline copy say the same. */

/** "#7 · Hana · New order" */
export function jobLabel(job: JobRef): string {
  return `#${job.number} · ${job.clientName} · ${KIND_WORDS[job.kind].label}`;
}

/** A time on the 12-hour clock she reads: '14:30' → "2:30 PM", '00:15' → "12:15 AM". */
export function clock(time: string): string {
  const [h, m] = [Number(time.slice(0, 2)), time.slice(3, 5)];
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "9:00–11:30 AM", "11:30 AM–1:00 PM", "2:00 PM", or null. */
export function timeLabel(step: Pick<Step, 'startsAt' | 'endsAt'>): string | null {
  if (!step.startsAt) return null;
  if (!step.endsAt) return clock(step.startsAt);
  const from = clock(step.startsAt);
  const to = clock(step.endsAt);
  // One AM or PM is enough when both are on the same side of noon.
  return from.slice(-2) === to.slice(-2) ? `${from.slice(0, -3)}–${to}` : `${from}–${to}`;
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

/** Why a step was not saved: the step whose time it would cross, named so she can find it. */
export function clashMessage(other: Step): string {
  const whose = other.job ? `${other.job.clientName}, #${other.job.number}` : 'your own';
  const day = other.untilDay ? daysLabel(other) : formatDay(other.onDay!);
  return `${timeLabel(other)} on ${day} is taken by “${other.title}” (${whose}). Choose another time.`;
}
