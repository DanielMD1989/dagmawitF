import { isoWeekday, type IsoDate } from '../dates';

/**
 * Whether she works on a day: her usual week, unless a day off or a shorter day says otherwise for that date.
 * Used only to suggest days for steps (decision 0066); nothing is ever refused on a closed day.
 */
export function openDayRule(
  weekdays: readonly number[],
  exceptions: readonly { day: IsoDate; minutesAvailable: number }[],
): (day: IsoDate) => boolean {
  const working = new Set(weekdays);
  const special = new Map(exceptions.map((e) => [e.day, e.minutesAvailable > 0]));
  return (day) => special.get(day) ?? working.has(isoWeekday(day));
}
