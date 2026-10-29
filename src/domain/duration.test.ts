import { describe, expect, it } from 'vitest';
import { formatMinutes } from './duration';

describe('formatMinutes', () => {
  it.each([
    [0, '0 min'],
    [45, '45 min'],
    [60, '1h 00m'],
    [180, '3h 00m'],
    [315, '5h 15m'],
    [450, '7h 30m'],
    [1440, '24h 00m'],
  ])('writes %i minutes as %s', (minutes, text) => expect(formatMinutes(minutes)).toBe(text));

  it.each([-1, 1.5, Number.NaN])('refuses %s', (value) =>
    expect(() => formatMinutes(value)).toThrow(RangeError),
  );
});
