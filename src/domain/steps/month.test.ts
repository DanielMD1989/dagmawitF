import { describe, expect, it } from 'vitest';
import { monthGrid } from './month';

describe('a month on her calendar', () => {
  it('runs from the Monday before the first to the Sunday after the last', () => {
    const g = monthGrid('2026-11', '2026-10-29');
    expect(g).toMatchObject({
      month: '2026-11',
      title: 'November 2026',
      first: '2026-11-01',
      last: '2026-11-30',
      from: '2026-10-26',
      to: '2026-12-06',
      previous: '2026-10',
      next: '2026-12',
    });
    expect(g.days).toHaveLength(42);
    expect(g.days.filter((d) => d.inMonth)).toHaveLength(30);
  });

  it('knows February in a leap year, and a month that starts on a Monday', () => {
    const g = monthGrid('2028-02', '2026-10-29');
    expect(g.last).toBe('2028-02-29');
    const june = monthGrid('2026-06', '2026-10-29');
    expect(june.from).toBe('2026-06-01');
  });

  it('shows the month of today when the name is missing or not a month', () => {
    for (const name of [undefined, '', '2026-13', 'soon', '1999-01']) {
      expect(monthGrid(name, '2026-10-29').month, String(name)).toBe('2026-10');
    }
  });
});
