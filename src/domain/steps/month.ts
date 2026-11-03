import { addDays, isIsoDate, isoWeekday, type IsoDate } from '../dates';
import { entriesOn, isDeliveryStep, type Step } from './agenda';

/** The weeks of a month as her calendar shows them: Monday first, with the days of the months around it. */

export interface MonthGrid {
  /** 'YYYY-MM' */
  month: string;
  /** "November 2026" */
  title: string;
  first: IsoDate;
  last: IsoDate;
  /** The first and last day shown, from the Monday before `first` to the Sunday after `last`. */
  from: IsoDate;
  to: IsoDate;
  previous: string;
  next: string;
  days: { day: IsoDate; inMonth: boolean }[];
}

const MONTH = /^(\d{4})-(\d{2})$/;

/** The month named, or the month of `today` when the name is missing or not a month. */
export function monthGrid(name: string | undefined, today: IsoDate): MonthGrid {
  const m = MONTH.exec(name ?? '');
  const month =
    m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[1]) >= 2000 && Number(m[1]) <= 2099
      ? `${m[1]}-${m[2]}`
      : today.slice(0, 7);
  const first = `${month}-01`;
  let last = addDays(first, 27);
  while (isIsoDate(addDays(last, 1)) && addDays(last, 1).startsWith(month)) last = addDays(last, 1);
  const from = addDays(first, 1 - isoWeekday(first));
  const to = addDays(last, 7 - isoWeekday(last));
  const days: MonthGrid['days'] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push({ day: d, inMonth: d.startsWith(month) });
  const title = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(
    new Date(`${first}T00:00:00Z`),
  );
  return {
    month,
    title,
    first,
    last,
    from,
    to,
    previous: addDays(first, -1).slice(0, 7),
    next: addDays(last, 1).slice(0, 7),
    days,
  };
}

/** One short label in a day of the month (decision 0086): an order due, an event, or a step. */
export interface DayMark {
  kind: 'due' | 'event' | 'step';
  /** As short as a day's box allows: the client's first name, the event's name, or the step. */
  text: string;
  /** Said in full to a screen reader, and in the day's list. */
  full: string;
}

/** An order or event due on a day, as the month needs it. */
export interface DueOn {
  id: string;
  number: number;
  title: string;
  clientName: string | null;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

function dueMark(job: DueOn): DayMark {
  if (!job.clientName) {
    const name = job.title || `Event #${job.number}`;
    return { kind: 'event', text: name, full: name };
  }
  const headline = job.title ? `${job.clientName} · ${job.title}` : job.clientName;
  return { kind: 'due', text: firstName(job.clientName), full: `${headline} due` };
}

/**
 * What a day of the month shows, most important first (decision 0086): the orders due that day, by the client's
 * first name, then the events by their name, then the steps not done yet, in the order of the day's list. An order's
 * "Delivery" step is its due mark, so an order is never shown twice on its day.
 */
export function dayMarks(steps: readonly Step[], due: readonly DueOn[], day: IsoDate): DayMark[] {
  const entries = entriesOn(steps, day).filter((e) => e.step.doneOn === null);
  const deliveries = entries.filter((e) => e.step.job && isDeliveryStep(e.step.title));
  const dueJobs = new Map<string, DueOn>(due.map((j) => [j.id, j]));
  for (const e of deliveries) if (!dueJobs.has(e.step.job!.id)) dueJobs.set(e.step.job!.id, e.step.job!);
  const marks = [...dueJobs.values()].map(dueMark);
  const work = entries
    .filter((e) => !deliveries.includes(e))
    .map(({ step }): DayMark => {
      const whose = step.job ? (step.job.clientName ?? step.job.title) : null;
      return { kind: 'step', text: step.title, full: whose ? `${step.title} · ${whose}` : step.title };
    });
  return [...marks.filter((m) => m.kind === 'due'), ...marks.filter((m) => m.kind === 'event'), ...work];
}
