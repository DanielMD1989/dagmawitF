import { describe, expect, it } from 'vitest';
import {
  MAX_TASK_MINUTES,
  estimateFields,
  parseLink,
  parseOrderTask,
  parseTemplate,
  parseTemplateItem,
  parseTemplateTask,
  readEstimate,
  readNeeds,
} from './forms';

const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) data.append(k, x);
  return data;
};

describe('an estimate in hours and minutes', () => {
  it.each([
    [{ 'estimate-hours': '1', 'estimate-minutes': '30' }, 90],
    [{ 'estimate-hours': '8', 'estimate-minutes': '' }, 480],
    [{ 'estimate-hours': '', 'estimate-minutes': '45' }, 45],
    [{ 'estimate-hours': ' 2 ', 'estimate-minutes': '0' }, 120],
    [{ 'estimate-hours': '100', 'estimate-minutes': '0' }, MAX_TASK_MINUTES],
  ])('%j is %i minutes', (fields, minutes) => {
    const errors = {};
    expect(readEstimate(form(fields), 'estimate', errors)).toBe(minutes);
    expect(errors).toEqual({});
  });

  it.each([
    [{ 'estimate-hours': '', 'estimate-minutes': '' }, 'Say how long'],
    [{ 'estimate-hours': '0', 'estimate-minutes': '0' }, 'Say how long'],
    [{ 'estimate-hours': '1.5', 'estimate-minutes': '' }, 'whole hours'],
    [{ 'estimate-hours': '1', 'estimate-minutes': '60' }, 'from 0 to 59'],
    [{ 'estimate-hours': '-1', 'estimate-minutes': '' }, 'whole hours'],
    [{ 'estimate-hours': '100', 'estimate-minutes': '1' }, 'under 100 hours'],
  ])('refuses %j', (fields, words) => {
    const errors: Record<string, string> = {};
    expect(readEstimate(form(fields), 'estimate', errors)).toBeNull();
    expect(errors['estimate-hours']).toContain(words);
  });

  it('shows a saved estimate in the two fields', () => {
    expect(estimateFields(90)).toEqual({ hours: '1', minutes: '30' });
    expect(estimateFields(45)).toEqual({ hours: '0', minutes: '45' });
    expect(estimateFields(null)).toEqual({ hours: '', minutes: '' });
  });
});

describe('a task of a template', () => {
  it('reads each kind with what it needs, and nothing else', () => {
    expect(parseTemplateTask(form({ title: 'Cut', kind: 'work', 'estimate-hours': '3' }))).toEqual({
      ok: true,
      value: { title: 'Cut', kind: 'work', minutes: 180, days: null },
    });
    expect(parseTemplateTask(form({ title: 'Dry', kind: 'wait', days: '1', 'estimate-hours': '3' }))).toEqual(
      {
        ok: true,
        value: { title: 'Dry', kind: 'wait', minutes: null, days: 1 },
      },
    );
    expect(parseTemplateTask(form({ title: 'Fitting', kind: 'fixed', 'estimate-minutes': '45' }))).toEqual({
      ok: true,
      value: { title: 'Fitting', kind: 'fixed', minutes: 45, days: null },
    });
    expect(parseTemplateTask(form({ title: 'Ready', kind: 'milestone', days: 'x' }))).toEqual({
      ok: true,
      value: { title: 'Ready', kind: 'milestone', minutes: null, days: null },
    });
  });

  it('says what is wrong, field by field', () => {
    const r = parseTemplateTask(form({ title: ' ', kind: 'sewing', 'estimate-hours': '' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['estimate-hours', 'kind', 'title']);
    const wait = parseTemplateTask(form({ title: 'Dry', kind: 'wait', days: '61' }));
    expect(wait.ok ? null : wait.errors.days).toContain('from 1 to 60');
    const long = parseTemplateTask(form({ title: 'x'.repeat(121), kind: 'milestone' }));
    expect(long.ok ? null : long.errors.title).toContain('120');
  });
});

describe('a task of an order', () => {
  const fitting = (more: Record<string, string>) =>
    parseOrderTask(form({ title: 'First fitting', kind: 'fixed', 'estimate-hours': '1', ...more }));

  it('lets an appointment wait for its day, or takes the day and the time together', () => {
    expect(fitting({})).toMatchObject({ ok: true, value: { fixedOn: null, fixedTime: null } });
    expect(fitting({ 'fixed-on': '2026-11-03', 'fixed-time': '10:30' })).toMatchObject({
      ok: true,
      value: { fixedOn: '2026-11-03', fixedTime: '10:30', minutes: 60 },
    });
  });

  it('refuses half an appointment, and says which half is missing', () => {
    const day = fitting({ 'fixed-on': '2026-11-03' });
    expect(day.ok ? null : day.errors['fixed-time']).toContain('time too');
    const time = fitting({ 'fixed-time': '10:30' });
    expect(time.ok ? null : time.errors['fixed-on']).toContain('day too');
    const bad = fitting({ 'fixed-on': '2026-11-03', 'fixed-time': '25:00' });
    expect(bad.ok ? null : bad.errors['fixed-time']).toContain('Choose a time');
  });

  it('keeps a day only on an appointment', () => {
    const work = parseOrderTask(
      form({
        title: 'Cut',
        kind: 'work',
        'estimate-hours': '2',
        'fixed-on': '2026-11-03',
        'fixed-time': '10:30',
      }),
    );
    expect(work).toMatchObject({ ok: true, value: { fixedOn: null, fixedTime: null } });
  });

  it('takes a day it may not start before', () => {
    expect(
      parseOrderTask(form({ title: 'Cut', kind: 'work', 'estimate-hours': '2', 'not-before': '2026-11-01' })),
    ).toMatchObject({
      ok: true,
      value: { notBefore: '2026-11-01' },
    });
    const bad = parseOrderTask(
      form({ title: 'Cut', kind: 'work', 'estimate-hours': '2', 'not-before': '1999-01-01' }),
    );
    expect(bad.ok ? null : bad.errors['not-before']).toBe('Choose a day.');
  });
});

describe('a link', () => {
  const known = (id: string) => id === 'cut';
  it('reads the task before and the days of rest, none by default', () => {
    expect(parseLink(form({ from: 'cut', 'lag-days': '' }), known)).toEqual({
      ok: true,
      value: { from: 'cut', lagDays: 0 },
    });
    expect(parseLink(form({ from: 'cut', 'lag-days': '2' }), known)).toEqual({
      ok: true,
      value: { from: 'cut', lagDays: 2 },
    });
  });
  it('refuses a task it does not know and a rest out of range', () => {
    const r = parseLink(form({ from: 'other', 'lag-days': '31' }), known);
    expect(r.ok ? [] : Object.keys(r.errors).sort()).toEqual(['from', 'lag-days']);
  });
});

describe('a template and what it waits for', () => {
  it('reads the template', () => {
    expect(
      parseTemplate(form({ name: 'Bridal gown, lace', 'garment-type': 'Bridal gown', notes: '' })),
    ).toEqual({
      ok: true,
      value: { name: 'Bridal gown, lace', garmentType: 'Bridal gown', notes: '' },
    });
    const r = parseTemplate(form({ name: '', 'garment-type': '', notes: 'x'.repeat(2001) }));
    expect(r.ok ? [] : Object.keys(r.errors).sort()).toEqual(['garment-type', 'name', 'notes']);
  });

  it('reads an item', () => {
    expect(parseTemplateItem(form({ kind: 'material', label: 'Lace', blocking: 'on' }))).toEqual({
      ok: true,
      value: { kind: 'material', label: 'Lace', blocking: true },
    });
    expect(parseTemplateItem(form({ kind: 'approval', label: 'Shoes' }))).toMatchObject({
      value: { blocking: false },
    });
    const r = parseTemplateItem(form({ kind: 'thing', label: '' }));
    expect(r.ok ? [] : Object.keys(r.errors).sort()).toEqual(['kind', 'label']);
  });

  it('keeps only the items it knows, once each', () => {
    const known = (id: string) => id === 'lace' || id === 'silk';
    expect(readNeeds(form({ needs: ['lace', 'lace', 'nope', 'silk'] }), known)).toEqual(['lace', 'silk']);
    expect(readNeeds(form({}), known)).toEqual([]);
  });
});

describe('pinning work to a day', () => {
  it('keeps the day for work, and ignores it for anything else', () => {
    expect(
      parseOrderTask(
        form({ title: 'Bodice', kind: 'work', 'estimate-hours': '4', 'pinned-on': '2026-11-05' }),
      ),
    ).toMatchObject({ ok: true, value: { pinnedOn: '2026-11-05' } });
    expect(
      parseOrderTask(
        form({ title: 'Fitting', kind: 'fixed', 'estimate-hours': '1', 'pinned-on': '2026-11-05' }),
      ),
    ).toMatchObject({ ok: true, value: { pinnedOn: null } });
    const bad = parseOrderTask(
      form({ title: 'Bodice', kind: 'work', 'estimate-hours': '4', 'pinned-on': 'soon' }),
    );
    expect(bad.ok ? null : bad.errors['pinned-on']).toBe('Choose a day.');
  });
});
