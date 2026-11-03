import { describe, expect, it } from 'vitest';
import { compared, orderNumbers, periodStart, SPAN, type Counted } from './numbers';

const TODAY = '2026-11-04'; // a Wednesday
const o = (over: Partial<Counted>): Counted => ({
  status: 'active',
  clientName: 'Selam',
  takenOn: '2026-11-02',
  deliveryOn: '2026-11-20',
  deliveredOn: null,
  ...over,
});

describe('weeks and months', () => {
  it('start on a Monday, and on the first of the month', () => {
    expect(periodStart('2026-11-04', 'week')).toBe('2026-11-02');
    expect(periodStart('2026-11-01', 'week')).toBe('2026-10-26');
    expect(periodStart('2026-11-04', 'month')).toBe('2026-11-01');
  });

  it('are the last twelve, oldest first, across a new year', () => {
    const months = orderNumbers([], '2027-02-10', 'month').buckets;
    expect(months).toHaveLength(SPAN);
    expect(months.map((b) => b.label).slice(-3)).toEqual(['Dec', 'Jan', 'Feb']);
    expect(months.at(-1)!.long).toBe('February 2027');
    const weeks = orderNumbers([], TODAY, 'week').buckets;
    expect(weeks.at(-1)).toMatchObject({ start: '2026-11-02', label: '2 Nov', long: 'Week of 2 Nov 2026' });
    expect(weeks[0]!.start).toBe('2026-08-17');
  });
});

describe('her orders, counted (decision 0091)', () => {
  const orders: Counted[] = [
    o({ takenOn: '2026-11-02' }),
    o({ takenOn: '2026-11-03', clientName: 'Hanna' }),
    o({
      takenOn: '2026-10-20',
      status: 'delivered',
      deliveryOn: '2026-11-03',
      deliveredOn: '2026-11-03',
      clientName: 'Hanna',
    }),
    o({ takenOn: '2026-10-21', status: 'delivered', deliveryOn: '2026-10-30', deliveredOn: '2026-11-02' }),
    o({ takenOn: '2026-10-28', status: 'active', deliveryOn: '2026-11-01' }),
    o({ takenOn: '2026-10-28', status: 'cancelled' }),
    o({ takenOn: '2026-10-29', status: 'draft' }),
    o({ takenOn: '2026-10-29', status: 'on_hold' }),
    // An event is not an order.
    o({ takenOn: '2026-11-02', clientName: null, status: 'delivered', deliveredOn: '2026-11-03' }),
    // Before the twelve weeks.
    o({ takenOn: '2026-01-05', status: 'delivered', deliveryOn: '2026-01-20', deliveredOn: '2026-01-25' }),
  ];

  it('counts orders taken and handed over in each week', () => {
    const weeks = orderNumbers(orders, TODAY, 'week').buckets;
    expect(weeks.at(-1)).toMatchObject({ taken: 2, delivered: 2 });
    expect(weeks.at(-2)).toMatchObject({ start: '2026-10-26', taken: 4, delivered: 0 });
    expect(weeks.reduce((n, b) => n + b.taken, 0)).toBe(8);
  });

  it('says how many were handed over on time, and how long an order takes', () => {
    const n = orderNumbers(orders, TODAY, 'week');
    expect(n.onTime).toEqual({ delivered: 2, onTime: 1 });
    // 14 days and 12 days.
    expect(n.averageDays).toBe(13);
    expect(n.cancelled).toBe(1);
  });

  it('says what is in hand now, and who ordered most', () => {
    const n = orderNumbers(orders, TODAY, 'month');
    expect(n.now).toEqual({ active: 3, late: 1, drafts: 1, onHold: 1 });
    // Over twelve months, January's order counts too.
    expect(n.topClients).toEqual([
      { name: 'Selam', orders: 7 },
      { name: 'Hanna', orders: 2 },
    ]);
  });

  it('says nothing about time taken when nothing was handed over', () => {
    expect(orderNumbers([o({})], TODAY, 'week').averageDays).toBeNull();
  });
});

describe('a number beside the last one', () => {
  it('is said in words', () => {
    expect(compared(5, 2, 'week')).toBe('3 more than last week');
    expect(compared(1, 2, 'month')).toBe('1 fewer than last month');
    expect(compared(2, 2, 'week')).toBe('the same as last week');
  });
});
