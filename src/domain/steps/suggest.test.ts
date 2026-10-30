import { describe, expect, it } from 'vitest';
import { openDayRule } from '../calendar/open';
import { suggestDays, type TemplateStep } from './suggest';

// 2026-11-02 is a Monday. She works Monday to Saturday.
const TODAY = '2026-11-02';
const sixDays = openDayRule([1, 2, 3, 4, 5, 6], []);
const everyDay = () => true;

const DRESS: TemplateStep[] = [
  { title: 'Buy fabric', daysBefore: 28, spanDays: 1, withClient: false },
  { title: 'Sewing', daysBefore: 21, spanDays: 7, withClient: false },
  { title: 'First fitting', daysBefore: 13, spanDays: 1, withClient: true },
  { title: 'Delivery', daysBefore: 0, spanDays: 1, withClient: true },
];

describe('suggested days for a new job', () => {
  it('count back from the due day when there is room', () => {
    const s = suggestDays(DRESS, '2026-12-14', TODAY, everyDay);
    expect(s.squeezed).toBe(false);
    expect(s.steps).toEqual([
      { title: 'Buy fabric', onDay: '2026-11-16', untilDay: null, withClient: false },
      { title: 'Sewing', onDay: '2026-11-23', untilDay: '2026-11-29', withClient: false },
      { title: 'First fitting', onDay: '2026-12-01', untilDay: null, withClient: true },
      { title: 'Delivery', onDay: '2026-12-14', untilDay: null, withClient: true },
    ]);
  });

  it('move a step off a day she does not work, to the working day before', () => {
    // 28 days before Monday 14 December is Monday 16 November; 21 before is Monday 23rd. With the due day on
    // Sunday 13 December, they would fall on Sundays.
    const s = suggestDays(DRESS, '2026-12-13', TODAY, sixDays);
    expect(s.steps.map((x) => [x.title, x.onDay, x.untilDay])).toEqual([
      ['Buy fabric', '2026-11-14', null],
      ['Sewing', '2026-11-21', '2026-11-27'],
      ['First fitting', '2026-11-30', null],
      // The due day is agreed with the client: it stays, even on a Sunday.
      ['Delivery', '2026-12-13', null],
    ]);
  });

  it('draw every step in, in the same order, when the due day is too near', () => {
    const s = suggestDays(DRESS, '2026-11-16', TODAY, everyDay);
    expect(s.squeezed).toBe(true);
    // 14 days of room for a template of 28: each step at half its distance, spans halved.
    expect(s.steps.map((x) => [x.title, x.onDay, x.untilDay])).toEqual([
      ['Buy fabric', '2026-11-02', null],
      ['Sewing', '2026-11-05', '2026-11-08'],
      ['First fitting', '2026-11-09', null],
      ['Delivery', '2026-11-16', null],
    ]);
    const days = s.steps.map((x) => x.onDay);
    expect(days).toEqual([...days].sort());
  });

  it('never start a step before today, and never run one into the due day', () => {
    const s = suggestDays(
      [{ title: 'Sewing', daysBefore: 3, spanDays: 10, withClient: false }],
      '2026-11-05',
      TODAY,
      everyDay,
    );
    expect(s.steps).toEqual([
      { title: 'Sewing', onDay: '2026-11-02', untilDay: '2026-11-04', withClient: false },
    ]);
  });

  it('put everything on the due day when it is today', () => {
    const s = suggestDays(DRESS, TODAY, TODAY, everyDay);
    expect(new Set(s.steps.map((x) => x.onDay))).toEqual(new Set([TODAY]));
    expect(s.steps.every((x) => x.untilDay === null)).toBe(true);
  });

  it('look for a later working day when there is none before', () => {
    // Today is Sunday 1 November, a day off; the step would start today.
    const s = suggestDays(
      [{ title: 'Cutting', daysBefore: 5, spanDays: 1, withClient: false }],
      '2026-11-06',
      '2026-11-01',
      sixDays,
    );
    expect(s.steps[0]!.onDay).toBe('2026-11-02');
  });

  it('end a run of days on a day she works', () => {
    // Sewing from Thursday 5 November for 4 days would end on Sunday 8th.
    const s = suggestDays(
      [{ title: 'Sewing', daysBefore: 10, spanDays: 4, withClient: false }],
      '2026-11-15',
      TODAY,
      sixDays,
    );
    expect(s.steps[0]).toMatchObject({ onDay: '2026-11-05', untilDay: '2026-11-07' });
  });

  it('suggest nothing for an empty template', () => {
    expect(suggestDays([], '2026-12-01', TODAY, everyDay)).toEqual({ steps: [], squeezed: false });
  });
});
