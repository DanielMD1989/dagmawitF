import { describe, expect, it } from 'vitest';
import { byDueDay, comingUp, daysLeft, dueNotShown, dueWord, jobHeadline, jobLabel } from './words';

describe('what a job is called', () => {
  it('is who it is for and what it is; an event by its name', () => {
    expect(jobHeadline({ number: 3, title: 'Bridal gown', clientName: 'Megan' })).toBe('Megan · Bridal gown');
    expect(jobHeadline({ number: 3, title: '', clientName: 'Megan' })).toBe('Megan');
    expect(jobHeadline({ number: 7, title: 'Bazaar at the Hyatt', clientName: null })).toBe(
      'Bazaar at the Hyatt',
    );
    expect(jobLabel({ number: 3, title: 'Bridal gown', clientName: 'Megan' })).toBe(
      '#3 · Megan · Bridal gown',
    );
  });
});

describe('a job’s own day', () => {
  it('groups jobs by the day they are due, keeping their order', () => {
    const days = byDueDay([
      { n: 1, dueOn: '2026-11-14' },
      { n: 2, dueOn: '2026-11-20' },
      { n: 3, dueOn: '2026-11-14' },
    ]);
    expect([...days].map(([day, jobs]) => [day, jobs.map((j) => j.n)])).toEqual([
      ['2026-11-14', [1, 3]],
      ['2026-11-20', [2]],
    ]);
  });

  it('is listed as due only when no step of it shows that day', () => {
    const due = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(dueNotShown(due, ['b', null, 'b'])).toEqual([{ id: 'a' }, { id: 'c' }]);
    expect(dueNotShown(due, [])).toEqual(due);
  });

  it('is a delivery for a client and an event for nobody', () => {
    expect(dueWord({ clientName: 'Megan' })).toBe('Delivery');
    expect(dueWord({ clientName: null })).toBe('Event');
  });
});

describe('days left', () => {
  it.each([
    ['2026-11-02', 'today'],
    ['2026-11-03', 'tomorrow'],
    ['2026-11-14', '12 days left'],
    ['2026-11-01', 'yesterday'],
    ['2026-10-30', '3 days ago'],
  ])('to %s: %s', (day, words) => {
    expect(daysLeft(day, '2026-11-02')).toBe(words);
  });

  it('lists confirmed deliveries due within the coming days, and every event ahead, soonest first', () => {
    const job = (number: number, dueOn: string, status = 'active') => ({
      number,
      dueOn,
      status,
      title: `Job ${number}`,
      clientName: number === 2 ? null : 'Megan',
    });
    const list = comingUp(
      [
        job(1, '2026-11-20'),
        job(2, '2026-11-14'),
        job(3, '2026-12-30'),
        job(4, '2026-11-10', 'draft'),
        job(5, '2026-11-01'),
        { ...job(6, '2027-02-14'), clientName: null },
      ],
      '2026-11-02',
    );
    expect(list.map((u) => [u.job.number, u.day, u.left])).toEqual([
      [2, 'Sat 14 Nov', '12 days left'],
      [1, 'Fri 20 Nov', '18 days left'],
      [6, 'Sun 14 Feb', '104 days left'],
    ]);
  });
});
