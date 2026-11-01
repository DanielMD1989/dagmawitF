import { describe, expect, it } from 'vitest';
import type { JobRef, Step } from './agenda';
import { dayMarks, monthGrid } from './month';

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

const DAY = '2026-11-20';
const YONAS: JobRef = {
  id: 'j1',
  number: 7,
  title: 'Hem trousers',
  clientName: 'Yonas Alemu',
  dueOn: DAY,
  status: 'active',
};
const SELAM: JobRef = { ...YONAS, id: 'j2', number: 4, title: 'Bridal gown', clientName: 'Selam Bekele' };
const BAZAAR = { id: 'e1', number: 9, title: 'Holiday bazaar', clientName: null };
let k = 0;
const step = (over: Partial<Step>): Step => ({
  id: `s${++k}`,
  title: 'Fitting',
  onDay: DAY,
  untilDay: null,
  startsAt: null,
  endsAt: null,
  doneOn: null,
  job: SELAM,
  ...over,
});

describe('the labels of a day in the month', () => {
  it('names the orders due by first name, then the events, then the steps in the day’s order', () => {
    const marks = dayMarks(
      [
        step({ title: 'Sewing', startsAt: '14:00' }),
        step({ title: 'Call the lace supplier', job: null, startsAt: '09:00' }),
      ],
      [BAZAAR, YONAS],
      DAY,
    );
    expect(marks).toEqual([
      { kind: 'due', text: 'Yonas', full: 'Yonas Alemu · Hem trousers due' },
      { kind: 'event', text: 'Holiday bazaar', full: 'Holiday bazaar' },
      { kind: 'step', text: 'Call the lace supplier', full: 'Call the lace supplier' },
      { kind: 'step', text: 'Sewing', full: 'Sewing · Selam Bekele' },
    ]);
  });

  it('shows an order once on its day: its Delivery step is its due mark', () => {
    const marks = dayMarks([step({ title: 'Delivery', job: YONAS, startsAt: '16:00' })], [YONAS], DAY);
    expect(marks).toEqual([{ kind: 'due', text: 'Yonas', full: 'Yonas Alemu · Hem trousers due' }]);
  });

  it('leaves out what is done, and steps on other days; a step over several days is on each', () => {
    const marks = dayMarks(
      [
        step({ title: 'Cutting', doneOn: DAY }),
        step({ title: 'Sketch', onDay: '2026-11-21' }),
        step({ title: 'Beading', onDay: '2026-11-19', untilDay: '2026-11-21' }),
      ],
      [],
      DAY,
    );
    expect(marks.map((m) => m.text)).toEqual(['Beading']);
  });
});
