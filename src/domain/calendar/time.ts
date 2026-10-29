import type { TimeOfDay } from './types';

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isTimeOfDay(value: string): value is TimeOfDay {
  return HHMM.test(value);
}

/** Minutes since midnight. Callers check the format first; 24:00 is handled by the database only. */
export function toMinutes(time: TimeOfDay): number {
  const m = HHMM.exec(time);
  if (!m) throw new RangeError(`Not a time of day: ${time}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Postgres returns times as 'HH:MM:SS'. We keep 'HH:MM'. */
export function fromDatabaseTime(value: string): TimeOfDay {
  return value.slice(0, 5);
}
