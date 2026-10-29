import type { IsoDate } from '../../dates';
import type { CalendarException, WorkDay } from '../../calendar/types';
import { buildCalendar } from '../calendar';
import { addDays } from '../../dates';
import type { Calendar, Edge, PlanInput, Task } from '../types';

/**
 * Small builders so a fixture reads like the story it tells. Fixtures are plain data: the same
 * input that the tests run is the one the print command shows her.
 */

/** Monday to Friday, 08:30 to 17:00 with an hour's break. 7h30 a day, 5h15m once the ratio is applied. */
export const DEFAULT_WEEK: WorkDay[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  start: '08:30',
  end: '17:00',
  breaks: [{ start: '12:30', end: '13:30' }],
}));

export const DEFAULT_RATIO = 0.7;

export function herCalendar(start: IsoDate, days = 120, exceptions: CalendarException[] = []): Calendar {
  return buildCalendar({ week: DEFAULT_WEEK, exceptions, planningRatio: DEFAULT_RATIO }, start, days);
}

/**
 * A calendar for tests: `pattern` is repeated from `start`. [300] means every day has 300
 * minutes; [300, 300, 300, 300, 300, 0, 0] from a Monday is a Monday to Friday week.
 */
export function flatCalendar(start: IsoDate, pattern: number[] | number, days = 60): Calendar {
  const repeat = Array.isArray(pattern) ? pattern : [pattern];
  return {
    start: addDays(start, 0),
    usable: Array.from({ length: days }, (_, i) => repeat[i % repeat.length] ?? 0),
  };
}

type Extra = Partial<Omit<Task, 'id' | 'orderId' | 'title' | 'kind' | 'minutes' | 'days'>>;

export const work = (
  id: string,
  orderId: string | null,
  title: string,
  minutes: number,
  extra: Extra = {},
): Task => ({
  id,
  orderId,
  title,
  kind: 'work',
  minutes,
  ...extra,
});

export const wait = (
  id: string,
  orderId: string | null,
  title: string,
  days: number,
  extra: Extra = {},
): Task => ({
  id,
  orderId,
  title,
  kind: 'wait',
  days,
  ...extra,
});

export const fixed = (
  id: string,
  orderId: string | null,
  title: string,
  day: IsoDate,
  time: string,
  minutes: number,
  extra: Extra = {},
): Task => ({ id, orderId, title, kind: 'fixed', minutes, fixedAt: { day, time }, ...extra });

export const milestone = (id: string, orderId: string | null, title: string, extra: Extra = {}): Task => ({
  id,
  orderId,
  title,
  kind: 'milestone',
  ...extra,
});

export const follows = (from: string, to: string, lagDays = 0): Edge => ({ from, to, lagDays });

export interface Fixture {
  name: string;
  title: string;
  /** A sentence or two on what this fixture shows. */
  story: string;
  input: PlanInput;
}
