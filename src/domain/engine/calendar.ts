import { addDays, type IsoDate } from '../dates';
import { usableMinutes, workingMinutesOn } from '../calendar/capacity';
import type { CalendarException, WorkDay } from '../calendar/types';
import type { Calendar } from './types';

/**
 * Turns her working week, days off and planning ratio into the minutes the planner may fill on
 * each day. This is the only place the engine's calendar is made, so My Day and the engine can
 * never disagree about how much time a day has.
 */
export function buildCalendar(
  settings: { week: readonly WorkDay[]; exceptions: readonly CalendarException[]; planningRatio: number },
  start: IsoDate,
  days: number,
): Calendar {
  const usable: number[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    usable.push(
      usableMinutes(workingMinutesOn(date, settings.week, settings.exceptions), settings.planningRatio),
    );
  }
  return { start, usable };
}
