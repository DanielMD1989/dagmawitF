import { describe, expect, it } from 'vitest';
import { buildCalendar } from './calendar';
import { DEFAULT_WEEK } from './fixtures/build';

describe('buildCalendar', () => {
  const start = '2026-10-26'; // a Monday
  const settings = { week: DEFAULT_WEEK, exceptions: [], planningRatio: 0.7 };

  it('turns her week into planner minutes: 7h 30m at 70% is 5h 15m', () => {
    const c = buildCalendar(settings, start, 7);
    expect(c.start).toBe(start);
    expect(c.usable).toEqual([315, 315, 315, 315, 315, 0, 0]);
  });

  it('is exactly what My Day shows for a day, because both use the same rules', () => {
    expect(buildCalendar(settings, start, 1).usable[0]).toBe(315);
  });

  it('lets a day off close a working day and a shorter day replace it', () => {
    const c = buildCalendar(
      {
        ...settings,
        exceptions: [
          { day: '2026-10-27', minutesAvailable: 0, reason: 'Holiday' },
          { day: '2026-10-28', minutesAvailable: 180, reason: 'Half day' },
        ],
      },
      start,
      3,
    );
    expect(c.usable).toEqual([315, 0, 126]); // 3h at 70% is 2h 06m
  });

  it('can open a day that is normally off', () => {
    const c = buildCalendar(
      { ...settings, exceptions: [{ day: '2026-10-31', minutesAvailable: 240, reason: 'Extra shift' }] },
      start,
      6,
    );
    expect(c.usable[5]).toBe(168);
  });

  it('follows the planning ratio', () => {
    expect(buildCalendar({ ...settings, planningRatio: 1 }, start, 1).usable[0]).toBe(450);
    expect(buildCalendar({ ...settings, planningRatio: 0.3 }, start, 1).usable[0]).toBe(135);
  });

  it('gives a day count of zero an empty calendar', () => {
    expect(buildCalendar(settings, start, 0).usable).toEqual([]);
  });
});
