import { describe, expect, it } from 'vitest';
import { describeDay, usableMinutes, workingMinutes, workingMinutesOn } from './capacity';
import type { CalendarException, WorkDay } from './types';

const weekday = (n: number, start = '08:30', end = '17:00', lunch = true): WorkDay => ({
  weekday: n,
  start,
  end,
  breaks: lunch ? [{ start: '12:30', end: '13:30' }] : [],
});
// Monday to Friday 08:30 to 17:00 with an hour's lunch is 7h 30m: the same day the design shows.
const week = [1, 2, 3, 4, 5].map((n) => weekday(n));

describe('workingMinutes', () => {
  it('subtracts breaks from the span of the day', () => {
    expect(workingMinutes(weekday(1))).toBe(450);
    expect(workingMinutes(weekday(1, '09:00', '15:00', false))).toBe(360);
  });
  it('subtracts every break', () => {
    expect(
      workingMinutes({
        weekday: 1,
        start: '08:00',
        end: '17:00',
        breaks: [
          { start: '10:00', end: '10:15' },
          { start: '12:00', end: '13:00' },
        ],
      }),
    ).toBe(465);
  });
});

describe('usableMinutes', () => {
  it('fills 70% of a 7h 30m day: 5h 15m', () => {
    expect(usableMinutes(450, 0.7)).toBe(315);
  });
  it('rounds down, never promising time she does not have', () => {
    expect(usableMinutes(435, 0.7)).toBe(304); // 304.5
    expect(usableMinutes(1, 0.99)).toBe(0);
  });
  it('is exact at the limits', () => {
    expect(usableMinutes(450, 1)).toBe(450);
    expect(usableMinutes(450, 0.3)).toBe(135);
    expect(usableMinutes(0, 0.7)).toBe(0);
  });
  it('is not thrown off by how 0.7 is stored as a binary fraction', () => {
    for (const working of [30, 60, 90, 150, 330, 450, 465]) {
      expect(usableMinutes(working, 0.7)).toBe(Math.floor((working * 70) / 100));
    }
  });
});

describe('workingMinutesOn', () => {
  const closed: CalendarException = { day: '2026-11-13', minutesAvailable: 0, reason: 'Holiday' };
  const half: CalendarException = { day: '2026-11-12', minutesAvailable: 240, reason: 'Half day' };
  const openedSunday: CalendarException = {
    day: '2026-11-01',
    minutesAvailable: 300,
    reason: 'Wedding rush',
  };

  it('uses her usual week', () => {
    expect(workingMinutesOn('2026-11-10', week, [])).toBe(450); // Tuesday
  });
  it('is zero on a weekday with no entry', () => {
    expect(workingMinutesOn('2026-11-07', week, [])).toBe(0); // Saturday
    expect(workingMinutesOn('2026-11-08', week, [])).toBe(0); // Sunday
  });
  it('lets an exception replace the week, shorter or closed', () => {
    expect(workingMinutesOn('2026-11-13', week, [closed])).toBe(0);
    expect(workingMinutesOn('2026-11-12', week, [half])).toBe(240);
  });
  it('lets an exception open a day that is normally off', () => {
    expect(workingMinutesOn('2026-11-01', week, [openedSunday])).toBe(300);
  });
});

describe('describeDay', () => {
  const closed: CalendarException = { day: '2026-11-13', minutesAvailable: 0, reason: 'Holiday' };
  it('says why a day is the way it is', () => {
    expect(describeDay('2026-11-10', week, [closed])).toEqual({ kind: 'working', minutes: 450, reason: '' });
    expect(describeDay('2026-11-13', week, [closed])).toEqual({
      kind: 'closed-by-exception',
      minutes: 0,
      reason: 'Holiday',
    });
    expect(describeDay('2026-11-07', week, [closed])).toEqual({ kind: 'day-off', minutes: 0, reason: '' });
    expect(
      describeDay('2026-11-12', week, [{ day: '2026-11-12', minutesAvailable: 240, reason: '' }]).kind,
    ).toBe('shortened-by-exception');
  });
});
