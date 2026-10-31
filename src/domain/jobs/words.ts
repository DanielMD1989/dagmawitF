import { addDays, daysBetween, formatDay, type IsoDate } from '../dates';

/**
 * What a job is called (decision 0068): who it is for and what it is. A job for nobody is an event, such as a bazaar,
 * called by its name. The work, not the step, is what she reads first (her Task 7).
 */

export interface JobName {
  number: number;
  /** What it is, in her words; may be empty for a client's job. */
  title: string;
  /** Null for an event. */
  clientName: string | null;
}

/** "Megan · Bridal gown", "Megan", or for an event "Bazaar at the Hyatt". */
export function jobHeadline(job: JobName): string {
  if (!job.clientName) return job.title || `Job #${job.number}`;
  return job.title ? `${job.clientName} · ${job.title}` : job.clientName;
}

/** "#3 · Megan · Bridal gown": the headline with its number, where jobs are listed. */
export function jobLabel(job: JobName): string {
  return `#${job.number} · ${jobHeadline(job)}`;
}

/** "today", "tomorrow", "12 days left", "yesterday", "3 days ago". */
export function daysLeft(day: IsoDate, today: IsoDate): string {
  const n = daysBetween(today, day);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `${n} days left` : `${-n} days ago`;
}

/** Jobs grouped by their own day, in the order given: what the month marks and lists as due. */
export function byDueDay<J extends { dueOn: IsoDate }>(jobs: readonly J[]): Map<IsoDate, J[]> {
  const days = new Map<IsoDate, J[]>();
  for (const job of jobs) days.set(job.dueOn, [...(days.get(job.dueOn) ?? []), job]);
  return days;
}

/**
 * The jobs due on a day that its steps do not already show: a job with a step that day is listed through that step,
 * so listing it again as due repeats it (her question, decision 0074). A job with no step that day would not appear
 * at all without this.
 */
export function dueNotShown<J extends { id: string }>(
  due: readonly J[],
  shownJobIds: Iterable<string | null>,
): J[] {
  const shown = new Set(shownJobIds);
  return due.filter((job) => !shown.has(job.id));
}

/** "Delivery" for a client's job, "Event" for an event. */
export const dueWord = (job: { clientName: string | null }): string =>
  job.clientName ? 'Delivery' : 'Event';

export interface Upcoming<J> {
  job: J;
  /** "Sat 14 Nov" */
  day: string;
  /** "12 days left" */
  left: string;
}

/**
 * Her confirmed jobs ahead, from tomorrow, soonest first: deliveries and events alike, however far (decision 0078).
 * Today's are on Today, with their steps; this is the countdown to what is still to come.
 */
export function comingUp<J extends JobName & { dueOn: IsoDate; status: string }>(
  jobs: readonly J[],
  today: IsoDate,
): Upcoming<J>[] {
  return jobs
    .filter((j) => j.status === 'active' && j.dueOn > today)
    .sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : a.number - b.number))
    .map((job) => ({ job, day: formatDay(job.dueOn), left: daysLeft(job.dueOn, today) }));
}

/** What is coming up, split into the next seven days and later. */
export function byHorizon<J extends { dueOn: IsoDate }>(
  upcoming: readonly Upcoming<J>[],
  today: IsoDate,
): { week: Upcoming<J>[]; later: Upcoming<J>[] } {
  const end = addDays(today, 7);
  return {
    week: upcoming.filter((u) => u.job.dueOn <= end),
    later: upcoming.filter((u) => u.job.dueOn > end),
  };
}
