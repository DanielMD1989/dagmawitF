/**
 * Dates in this app are plain calendar dates written 'YYYY-MM-DD'. They are never turned into
 * instants, so a working day cannot slide to the day before or after because of a time zone.
 * Anything that needs "today" asks todayIn() with her time zone.
 */

export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: string): value is IsoDate {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

function toUtcDate(iso: IsoDate): Date {
  if (!isIsoDate(iso)) throw new RangeError(`Not a calendar date: ${iso}`);
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

const MS_PER_DAY = 86_400_000;

function toIso(date: Date): IsoDate {
  const y = String(date.getUTCFullYear()).padStart(4, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The date `days` calendar days after `iso` (before it, if negative). */
export function addDays(iso: IsoDate, days: number): IsoDate {
  if (!Number.isInteger(days)) throw new RangeError(`Not a whole number of days: ${days}`);
  return toIso(new Date(toUtcDate(iso).getTime() + days * MS_PER_DAY));
}

/** Whole calendar days from `from` to `to`. Positive when `to` is later. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtcDate(to).getTime() - toUtcDate(from).getTime()) / MS_PER_DAY);
}

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(iso: IsoDate): number {
  const day = toUtcDate(iso).getUTCDay();
  return day === 0 ? 7 : day;
}

/** True when the name is an IANA time zone this runtime knows, such as Africa/Addis_Ababa. */
export function isValidTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: name });
    return name.length > 0;
  } catch {
    return false;
  }
}

/** The calendar date it is right now in the given IANA time zone. */
export function todayIn(timeZone: string, now: Date = new Date()): IsoDate {
  // The en-CA locale writes dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** The hour (0 to 23) it is right now in the given IANA time zone. */
export function hourIn(timeZone: string, now: Date = new Date()): number {
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now);
  return Number(hour);
}

/** Short label such as "Fri 13 Nov". */
export function formatDay(iso: IsoDate): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
    .format(toUtcDate(iso))
    .replace(',', '');
}

/** Long label such as "Monday 26 October". */
export function formatDayLong(iso: IsoDate): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' })
    .format(toUtcDate(iso))
    .replace(',', '');
}

export const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

export function weekdayName(weekday: number): string {
  const name = WEEKDAY_NAMES[weekday - 1];
  if (!name) throw new RangeError(`Not an ISO weekday: ${weekday}`);
  return name;
}

/**
 * The day and the time of day, on her wall clock, of a moment such as the database's "2026-10-25T21:03:55+03:00".
 * Returns null for something that is not a moment.
 */
export function wallClockOf(moment: string, timeZone: string): { day: IsoDate; time: string } | null {
  const at = new Date(moment);
  if (Number.isNaN(at.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    day: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  };
}
