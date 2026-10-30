import { addDays, daysBetween, type IsoDate } from '../dates';

/**
 * Suggested days for a new job's steps, counting back from its due day (docs/calendar-first.md, decision 0066).
 * Only a starting point: she changes any day, and the job keeps the days she settles on.
 *
 * - A step starts its template's "days before" the due day, and runs its span of days.
 * - When the due day is nearer than the template's first step, every step is drawn in proportionally, so the job
 *   still fits between today and the due day ("squeezed"), in the same order.
 * - A step never starts before today, and moves to the nearest earlier day she works (or, if there is none before
 *   it, the next later one before the due day).
 * - A step on the due day itself (the delivery, the appointment) stays on it: that day is agreed with the client.
 */

export interface TemplateStep {
  title: string;
  daysBefore: number;
  spanDays: number;
  withClient: boolean;
}

export interface SuggestedStep {
  title: string;
  onDay: IsoDate;
  /** The last day of a step that runs over several days. */
  untilDay: IsoDate | null;
  withClient: boolean;
}

export interface Suggestion {
  steps: SuggestedStep[];
  /** True when the due day was too near for the template's days, and every step was drawn in. */
  squeezed: boolean;
}

export function suggestDays(
  template: readonly TemplateStep[],
  due: IsoDate,
  today: IsoDate,
  isOpen: (day: IsoDate) => boolean,
): Suggestion {
  const room = Math.max(0, daysBetween(today, due));
  const longest = Math.max(0, ...template.map((s) => s.daysBefore));
  const factor = longest > room ? room / longest : 1;
  const earliest = due < today ? due : today;

  const steps = template.map((s): SuggestedStep => {
    const before = Math.round(s.daysBefore * factor);
    if (before === 0) return { title: s.title, onDay: due, untilDay: null, withClient: s.withClient };

    let onDay = addDays(due, -before);
    if (onDay < earliest) onDay = earliest;
    onDay = nearestOpen(onDay, earliest, addDays(due, -1), isOpen);

    const span = Math.max(1, Math.round(s.spanDays * factor));
    let untilDay: IsoDate | null = addDays(onDay, span - 1);
    const lastAllowed = addDays(due, -1);
    if (untilDay > lastAllowed) untilDay = lastAllowed;
    while (untilDay > onDay && !isOpen(untilDay)) untilDay = addDays(untilDay, -1);
    return { title: s.title, onDay, untilDay: untilDay > onDay ? untilDay : null, withClient: s.withClient };
  });

  return { steps, squeezed: factor < 1 };
}

/** `day` if she works then; else the nearest earlier working day not before `from`; else the next one up to `to`. */
function nearestOpen(day: IsoDate, from: IsoDate, to: IsoDate, isOpen: (day: IsoDate) => boolean): IsoDate {
  if (isOpen(day)) return day;
  for (let d = addDays(day, -1); d >= from; d = addDays(d, -1)) if (isOpen(d)) return d;
  for (let d = addDays(day, 1); d <= to; d = addDays(d, 1)) if (isOpen(d)) return d;
  return day;
}
