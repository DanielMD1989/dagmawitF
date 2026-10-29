import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  formatDay,
  formatDayLong,
  hourIn,
  isIsoDate,
  isoWeekday,
  isValidTimeZone,
  todayIn,
  wallClockOf,
  weekdayName,
} from './dates';

describe('isIsoDate', () => {
  it.each(['2026-10-25', '2028-02-29', '2026-12-31'])('accepts %s', (v) => expect(isIsoDate(v)).toBe(true));
  it.each([
    '2026-02-30',
    '2027-02-29',
    '2026-13-01',
    '2026-00-10',
    '26-10-25',
    '2026-1-5',
    '',
    'tomorrow',
    '2026-10-25T00:00',
  ])('rejects %j', (v) => expect(isIsoDate(v)).toBe(false));
});

describe('isoWeekday', () => {
  it('numbers Monday 1 to Sunday 7', () => {
    expect(isoWeekday('2026-10-26')).toBe(1); // Monday
    expect(isoWeekday('2026-10-31')).toBe(6); // Saturday
    expect(isoWeekday('2026-11-01')).toBe(7); // Sunday
  });
  it('throws on something that is not a date', () => {
    expect(() => isoWeekday('2026-02-30')).toThrow(RangeError);
  });
});

describe('todayIn and hourIn', () => {
  // 21:30 UTC on 25 Oct is already 00:30 on 26 Oct in Addis Ababa (UTC+3, no daylight saving).
  const instant = new Date('2026-10-25T21:30:00Z');
  it("gives her calendar date, not the server's", () => {
    expect(todayIn('Africa/Addis_Ababa', instant)).toBe('2026-10-26');
    expect(todayIn('UTC', instant)).toBe('2026-10-25');
    expect(todayIn('America/Los_Angeles', instant)).toBe('2026-10-25');
  });
  it('gives her hour of the day', () => {
    expect(hourIn('Africa/Addis_Ababa', instant)).toBe(0);
    expect(hourIn('UTC', instant)).toBe(21);
  });
  it('reads midnight as hour 0, never 24', () => {
    expect(hourIn('UTC', new Date('2026-10-25T00:05:00Z'))).toBe(0);
  });
});

describe('labels', () => {
  it('writes short and long day labels', () => {
    expect(formatDay('2026-11-13')).toBe('Fri 13 Nov');
    expect(formatDayLong('2026-10-26')).toBe('Monday 26 October');
  });
  it('names weekdays', () => {
    expect(weekdayName(1)).toBe('Monday');
    expect(weekdayName(7)).toBe('Sunday');
    expect(() => weekdayName(0)).toThrow(RangeError);
  });
});

describe('isValidTimeZone', () => {
  it.each(['Africa/Addis_Ababa', 'UTC', 'Europe/London'])('accepts %s', (z) =>
    expect(isValidTimeZone(z)).toBe(true),
  );
  it.each(['', 'Mars/Olympus_Mons', 'Addis'])('rejects %j', (z) => expect(isValidTimeZone(z)).toBe(false));
});

describe('addDays and daysBetween', () => {
  it('moves across month, year and leap-day boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-10-25', 0)).toBe('2026-10-25');
  });

  it('counts days between dates, negative when going back', () => {
    expect(daysBetween('2026-10-25', '2026-10-25')).toBe(0);
    expect(daysBetween('2026-10-25', '2026-11-01')).toBe(7);
    expect(daysBetween('2026-11-01', '2026-10-25')).toBe(-7);
    expect(daysBetween('2027-12-31', '2028-03-01')).toBe(61);
  });

  it('agrees with itself: adding the distance lands on the date', () => {
    for (const [a, b] of [
      ['2026-01-01', '2026-12-31'],
      ['2028-02-29', '2029-02-28'],
      ['2026-10-26', '2026-10-01'],
    ] as const) {
      expect(addDays(a, daysBetween(a, b))).toBe(b);
    }
  });

  it('refuses a fraction of a day and a date that is not real', () => {
    expect(() => addDays('2026-10-25', 1.5)).toThrow(RangeError);
    expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
    expect(() => daysBetween('2026-02-30', '2026-03-01')).toThrow(RangeError);
  });
});

describe('wallClockOf', () => {
  it("gives the day and time on her clock, not the server's", () => {
    // 21:03 in Addis Ababa (UTC+3) is 18:03 in UTC.
    expect(wallClockOf('2026-10-25T21:03:55+03:00', 'Africa/Addis_Ababa')).toEqual({
      day: '2026-10-25',
      time: '21:03',
    });
    expect(wallClockOf('2026-10-25T21:03:55+03:00', 'UTC')).toEqual({ day: '2026-10-25', time: '18:03' });
  });

  it('moves to the next day when her clock is already there', () => {
    expect(wallClockOf('2026-10-25T22:30:00Z', 'Africa/Addis_Ababa')).toEqual({
      day: '2026-10-26',
      time: '01:30',
    });
  });

  it('writes midnight as 00:00, never 24:00', () => {
    expect(wallClockOf('2026-10-25T21:00:00Z', 'Africa/Addis_Ababa')).toEqual({
      day: '2026-10-26',
      time: '00:00',
    });
  });

  it('is null for something that is not a moment', () => {
    expect(wallClockOf('yesterday', 'UTC')).toBeNull();
    expect(wallClockOf('', 'UTC')).toBeNull();
  });
});
