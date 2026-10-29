import type { IsoDate } from '../dates';

/** A time of day written 'HH:MM' on her wall clock. */
export type TimeOfDay = string;

export interface Break {
  start: TimeOfDay;
  end: TimeOfDay;
}

/** One working day of her week. A weekday with no WorkDay is a day off. */
export interface WorkDay {
  /** ISO weekday: 1 = Monday ... 7 = Sunday. */
  weekday: number;
  start: TimeOfDay;
  end: TimeOfDay;
  breaks: Break[];
}

/** A date that differs from her usual week: a holiday, a half day, leave. */
export interface CalendarException {
  day: IsoDate;
  /** Working minutes that date, replacing the usual week. 0 means closed. */
  minutesAvailable: number;
  reason: string;
}

export interface Profile {
  name: string;
  timezone: string;
  /** Share of working time the planner may fill, between 0.30 and 1.00. */
  planningRatio: number;
}
