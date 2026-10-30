import { describe, expect, it } from 'vitest';
import { openDayRule } from './open';

describe('whether she works on a day', () => {
  // 2026-11-02 is a Monday.
  const isOpen = openDayRule(
    [1, 2, 3, 4, 5, 6],
    [
      { day: '2026-11-03', minutesAvailable: 0 },
      { day: '2026-11-08', minutesAvailable: 240 },
    ],
  );

  it('follows her usual week', () => {
    expect(isOpen('2026-11-02')).toBe(true);
    expect(isOpen('2026-11-07')).toBe(true);
    expect(isOpen('2026-11-15')).toBe(false);
  });

  it('lets a day off close a working day, and a shorter day open a day off', () => {
    expect(isOpen('2026-11-03')).toBe(false);
    expect(isOpen('2026-11-08')).toBe(true);
  });

  it('is never open with no working days', () => {
    expect(openDayRule([], [])('2026-11-02')).toBe(false);
  });
});
