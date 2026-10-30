import { describe, expect, it } from 'vitest';
import { parseStep, parseStepRows } from './forms';

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe('a step as she types it', () => {
  it('needs only a title', () => {
    expect(parseStep(form({ title: ' Cutting ' }))).toEqual({
      ok: true,
      value: { title: 'Cutting', onDay: null, untilDay: null, startsAt: null, endsAt: null },
    });
  });

  it('takes a day, a last day and a time, and a browser’s seconds', () => {
    expect(
      parseStep(
        form({ title: 'Sewing', day: '2026-11-10', until: '2026-11-13', from: '09:00:00', to: '13:00' }),
      ),
    ).toEqual({
      ok: true,
      value: {
        title: 'Sewing',
        onDay: '2026-11-10',
        untilDay: '2026-11-13',
        startsAt: '09:00',
        endsAt: '13:00',
      },
    });
  });

  it.each([
    [{ title: '' }, 'title', 'Say what the step is'],
    [{ title: 'x'.repeat(121) }, 'title', 'under 120'],
    [{ title: 'A', day: '2026-02-30' }, 'day', 'Choose a day.'],
    [{ title: 'A', until: '2026-11-10' }, 'until', 'first day too'],
    [{ title: 'A', day: '2026-11-10', until: '2026-11-10' }, 'until', 'after the first'],
    [{ title: 'A', from: '09:00' }, 'from', 'Choose a day'],
    [{ title: 'A', day: '2026-11-10', from: '9am' }, 'from', 'such as 09:30'],
    [{ title: 'A', day: '2026-11-10', to: '10:00' }, 'to', 'start time too'],
    [{ title: 'A', day: '2026-11-10', from: '10:00', to: '09:00' }, 'to', 'after the start'],
  ])('refuses %o, next to its field', (fields, field, words) => {
    const r = parseStep(form(fields));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[field]).toContain(words);
  });
});

describe('the rows of steps on a new job', () => {
  it('are read in order, each keyed by its row', () => {
    const r = parseStepRows(
      form({
        steps: '2',
        'step-0-title': 'Appointment',
        'step-0-day': '2026-11-03',
        'step-0-from': '14:00',
        'step-1-title': 'Sketch',
      }),
    );
    expect(r).toEqual({
      ok: true,
      value: [
        { title: 'Appointment', onDay: '2026-11-03', untilDay: null, startsAt: '14:00', endsAt: null },
        { title: 'Sketch', onDay: null, untilDay: null, startsAt: null, endsAt: null },
      ],
    });
    expect(parseStepRows(form({}))).toEqual({ ok: true, value: [] });
  });

  it('say what is wrong next to the field of its own row', () => {
    const r = parseStepRows(
      form({ steps: '2', 'step-0-title': 'A', 'step-1-title': '', 'step-1-to': '10:00' }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['step-1-title', 'step-1-to']);
  });

  it('refuse the same step twice on the same day, in any capitals', () => {
    const r = parseStepRows(
      form({
        steps: '3',
        'step-0-title': 'Fitting',
        'step-0-day': '2026-11-03',
        'step-1-title': 'fitting',
        'step-1-day': '2026-11-03',
        'step-2-title': 'Fitting',
        'step-2-day': '2026-11-10',
      }),
    );
    expect(r).toEqual({
      ok: false,
      errors: { 'step-1-title': '“fitting” is already in the list for that day.' },
    });
  });

  it('refuse a count that is not a count', () => {
    for (const steps of ['x', '-1', '101', '1.5'])
      expect(parseStepRows(form({ steps })).ok, steps).toBe(false);
  });
});
