import { toMinutes, isTimeOfDay } from './time';
import type { WorkDay } from './types';

export const MAX_BREAKS = 6;

/**
 * The rules a working day must obey. The database enforces the same rules as its final
 * authority (migration 20261025090100_calendar.sql); this version exists so the screen can
 * say what is wrong in plain words. test/fixtures/work-day-cases.ts is run against both,
 * so they cannot drift apart.
 *
 * Returns a message for the first problem found, or null when the day is fine.
 */
export function workDayProblem(day: WorkDay): string | null {
  if (!Number.isInteger(day.weekday) || day.weekday < 1 || day.weekday > 7)
    return 'That is not a day of the week.';
  if (!isTimeOfDay(day.start) || !isTimeOfDay(day.end)) return 'Use a time such as 08:30.';
  const start = toMinutes(day.start);
  const end = toMinutes(day.end);
  if (start >= end) return 'The day must end after it starts.';
  if (!Array.isArray(day.breaks) || day.breaks.length > MAX_BREAKS)
    return `Use at most ${MAX_BREAKS} breaks.`;

  let previousEnd = start;
  for (const item of day.breaks) {
    if (!isTimeOfDay(item.start) || !isTimeOfDay(item.end)) return 'Use a time such as 12:30 for the break.';
    const breakStart = toMinutes(item.start);
    const breakEnd = toMinutes(item.end);
    if (breakStart >= breakEnd) return 'A break must end after it starts.';
    if (breakStart < start || breakEnd > end) return 'A break must sit inside the working day.';
    if (breakStart < previousEnd) return 'Breaks must not overlap, and must be in order.';
    previousEnd = breakEnd;
  }
  return null;
}
