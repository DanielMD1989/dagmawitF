import { describe, expect, it } from 'vitest';
import { parseDone, parseHold, parseQuickAdd, parseRemaining } from './forms';

const TODAY = '2026-10-27';
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe('done', () => {
  it('is today unless she says otherwise, with the time it took for her own work', () => {
    expect(parseDone(form({ 'actual-hours': '2', 'actual-minutes': '30' }), TODAY, true)).toEqual({
      ok: true,
      value: { doneOn: TODAY, actualMinutes: 150 },
    });
    expect(parseDone(form({ 'done-on': '2026-10-26', 'actual-hours': '1' }), TODAY, true)).toMatchObject({
      value: { doneOn: '2026-10-26' },
    });
    expect(parseDone(form({}), TODAY, false)).toEqual({
      ok: true,
      value: { doneOn: TODAY, actualMinutes: null },
    });
  });

  it('refuses a day to come and a missing time', () => {
    const r = parseDone(form({ 'done-on': '2026-10-28' }), TODAY, true);
    expect(r.ok ? {} : r.errors).toEqual({
      'done-on': 'Choose today or an earlier day.',
      'actual-hours': 'Say how long it took, in total.',
    });
  });
});

describe('still going', () => {
  it('takes about how long is left', () => {
    expect(parseRemaining(form({ 'remaining-hours': '1', 'remaining-minutes': '' }))).toEqual({
      ok: true,
      value: 60,
    });
    const r = parseRemaining(form({}));
    expect(r.ok ? null : r.errors['remaining-hours']).toBe('Say about how long is left.');
  });
});

describe('a hold', () => {
  it('needs a reason', () => {
    expect(parseHold(form({ reason: 'Client away' }))).toEqual({ ok: true, value: 'Client away' });
    expect(parseHold(form({ reason: '  ' })).ok).toBe(false);
    expect(parseHold(form({ reason: 'x'.repeat(201) })).ok).toBe(false);
  });
});

describe('quick add', () => {
  const known = (id: string) => id === 'o1';
  it('takes studio work, or work for an order she has', () => {
    expect(
      parseQuickAdd(form({ title: 'Walk-in hem', 'estimate-minutes': '40', 'order-id': '' }), known),
    ).toEqual({
      ok: true,
      value: { title: 'Walk-in hem', minutes: 40, orderId: null },
    });
    expect(
      parseQuickAdd(form({ title: 'Extra button', 'estimate-minutes': '10', 'order-id': 'o1' }), known),
    ).toMatchObject({
      value: { orderId: 'o1' },
    });
  });
  it('says what is missing', () => {
    const r = parseQuickAdd(form({ title: '', 'order-id': 'x' }), known);
    expect(r.ok ? [] : Object.keys(r.errors).sort()).toEqual(['estimate-hours', 'order-id', 'title']);
  });
});
