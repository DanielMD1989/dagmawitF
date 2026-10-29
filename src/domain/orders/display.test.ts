import { describe, expect, it } from 'vitest';
import { describeHandover, orderLabel, orderTitle } from './display';

describe('what an order is called', () => {
  it('uses its number and what is being made', () => {
    expect(orderLabel(105, ['Bridal gown'])).toBe('Order #105, bridal gown');
    expect(orderLabel(105, [])).toBe('Order #105');
    expect(orderLabel(105, ['Bridal gown', 'Veil', 'Bolero'])).toBe('Order #105, bridal gown and 2 more');
    expect(orderTitle(105, ['Bridal gown'])).toBe('#105 · Bridal gown');
    expect(orderTitle(105, ['Bridal gown', 'Veil'])).toBe('#105 · Bridal gown + 1 more');
    expect(orderTitle(7, [])).toBe('#7');
  });
});

describe('how far off the handover is', () => {
  const today = '2026-10-25';
  it.each([
    ['2026-10-25', 'today', 0, false],
    ['2026-10-26', 'tomorrow', 1, false],
    ['2026-11-06', 'in 12 days', 12, false],
    ['2026-10-24', 'yesterday', -1, true],
    ['2026-10-22', '3 days ago', -3, true],
  ])('%s is %s', (day, text, days, past) => {
    expect(describeHandover(day, today)).toEqual({ text, days, past });
  });
});
