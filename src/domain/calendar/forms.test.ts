import { describe, expect, it } from 'vitest';
import { parseException, parsePlanningPercent, parseProfile, parseWorkWeek } from './forms';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

describe('parseWorkWeek', () => {
  it('reads ticked days and ignores the rest', () => {
    const result = parseWorkWeek(
      form({
        'works-1': 'on',
        'start-1': '08:30',
        'end-1': '17:00',
        'break-start-1': '12:30',
        'break-end-1': '13:30',
        'start-2': '09:00',
        'end-2': '12:00', // not ticked: ignored even though filled in
        'works-6': 'on',
        'start-6': '09:00',
        'end-6': '13:00',
      }),
    );
    expect(result).toEqual({
      ok: true,
      value: [
        { weekday: 1, start: '08:30', end: '17:00', breaks: [{ start: '12:30', end: '13:30' }] },
        { weekday: 6, start: '09:00', end: '13:00', breaks: [] },
      ],
    });
  });

  it('allows a week with no working days', () => {
    expect(parseWorkWeek(form({}))).toEqual({ ok: true, value: [] });
  });

  it('reports each problem against its own day', () => {
    const result = parseWorkWeek(
      form({
        'works-1': 'on',
        'start-1': '17:00',
        'end-1': '09:00',
        'works-2': 'on',
        'start-2': '09:00',
        'end-2': '17:00',
        'break-start-2': '12:00',
        'works-3': 'on',
        'start-3': '',
        'end-3': '17:00',
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors['day-1']).toBe('The day must end after it starts.');
      expect(result.errors['break-2']).toMatch(/both the start and the end/);
      expect(result.errors['day-3']).toBe('Use a time such as 08:30.');
    }
  });
});

describe('parseException', () => {
  it('reads a closed day', () => {
    expect(parseException(form({ day: '2026-11-13', kind: 'closed', reason: ' Holiday ' }))).toEqual({
      ok: true,
      value: { day: '2026-11-13', minutesAvailable: 0, reason: 'Holiday' },
    });
  });
  it('reads a shorter day in hours and minutes', () => {
    expect(
      parseException(form({ day: '2026-11-12', kind: 'shortened', hours: '3', minutes: '30', reason: '' })),
    ).toEqual({
      ok: true,
      value: { day: '2026-11-12', minutesAvailable: 210, reason: '' },
    });
  });
  it('treats a shorter day with no time as a mistake', () => {
    const result = parseException(
      form({ day: '2026-11-12', kind: 'shortened', hours: '0', minutes: '0', reason: '' }),
    );
    expect(result.ok).toBe(false);
  });
  it.each([
    [{ day: '', kind: 'closed', reason: '' }, 'day'],
    [{ day: '2026-02-30', kind: 'closed', reason: '' }, 'day'],
    [{ day: '2026-11-13', kind: 'maybe', reason: '' }, 'kind'],
    [{ day: '2026-11-13', kind: 'shortened', hours: '25', reason: '' }, 'hours'],
    [{ day: '2026-11-13', kind: 'shortened', hours: '2', minutes: '75', reason: '' }, 'minutes'],
    [{ day: '2026-11-13', kind: 'closed', reason: 'x'.repeat(201) }, 'reason'],
  ])('rejects %j on the %s field', (fields, field) => {
    const result = parseException(form(fields as Record<string, string>));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors)).toContain(field);
  });
});

describe('parsePlanningPercent', () => {
  it.each([
    ['70', 0.7],
    ['30', 0.3],
    ['100', 1],
  ])('reads %s as %f', (text, ratio) => {
    expect(parsePlanningPercent(form({ 'planning-percent': text }))).toEqual({ ok: true, value: ratio });
  });
  it.each(['29', '101', '70.5', '', 'seventy'])('rejects %j', (text) => {
    expect(parsePlanningPercent(form({ 'planning-percent': text })).ok).toBe(false);
  });
});

describe('parseProfile', () => {
  it('reads name, time zone and planning share', () => {
    expect(
      parseProfile(form({ name: ' Dagmawit ', timezone: 'Africa/Addis_Ababa', 'planning-percent': '70' })),
    ).toEqual({
      ok: true,
      value: { name: 'Dagmawit', timezone: 'Africa/Addis_Ababa', planningRatio: 0.7 },
    });
  });
  it('allows an empty name', () => {
    expect(parseProfile(form({ name: '', timezone: 'UTC', 'planning-percent': '100' })).ok).toBe(true);
  });
  it('reports every problem at once', () => {
    const result = parseProfile(
      form({ name: 'x'.repeat(121), timezone: 'Mars/Olympus_Mons', 'planning-percent': '5' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(Object.keys(result.errors).sort()).toEqual(['name', 'planning-percent', 'timezone']);
  });
});
