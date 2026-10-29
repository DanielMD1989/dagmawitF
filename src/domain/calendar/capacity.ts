import { isoWeekday, type IsoDate } from '../dates';
import { toMinutes } from './time';
import type { CalendarException, WorkDay } from './types';

/** Minutes between start and end, less her breaks. */
export function workingMinutes(day: WorkDay): number {
  const total = toMinutes(day.end) - toMinutes(day.start);
  const breaks = day.breaks.reduce((sum, b) => sum + (toMinutes(b.end) - toMinutes(b.start)), 0);
  return total - breaks;
}

/**
 * The part of working time the planner may fill. Rounded down, so the plan never promises
 * a minute she does not have. Works in whole percent to avoid fractions creeping in.
 */
export function usableMinutes(working: number, planningRatio: number): number {
  const percent = Math.round(planningRatio * 100);
  return Math.floor((working * percent) / 100);
}

/**
 * Working minutes on a date. A listed exception wins over her usual week.
 * A weekday with no entry is a day off, so it has 0 minutes.
 */
export function workingMinutesOn(
  date: IsoDate,
  week: readonly WorkDay[],
  exceptions: readonly CalendarException[],
): number {
  const exception = exceptions.find((e) => e.day === date);
  if (exception) return exception.minutesAvailable;
  const day = week.find((d) => d.weekday === isoWeekday(date));
  return day ? workingMinutes(day) : 0;
}

export type DayKind = 'working' | 'closed-by-exception' | 'shortened-by-exception' | 'day-off';

/** Why a date has the working time it has, for the screen to explain. */
export function describeDay(
  date: IsoDate,
  week: readonly WorkDay[],
  exceptions: readonly CalendarException[],
) {
  const exception = exceptions.find((e) => e.day === date);
  const usual = week.find((d) => d.weekday === isoWeekday(date));
  const minutes = workingMinutesOn(date, week, exceptions);
  let kind: DayKind;
  if (exception) kind = exception.minutesAvailable === 0 ? 'closed-by-exception' : 'shortened-by-exception';
  else kind = usual ? 'working' : 'day-off';
  return { kind, minutes, reason: exception?.reason ?? '' };
}
