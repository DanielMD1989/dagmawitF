import { describe, expect, it } from 'vitest';
import { parseTemplate, parseTemplateStep, whenLabel } from './forms';

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe('a template', () => {
  it('has a name and a kind of job', () => {
    expect(parseTemplate(form({ name: ' Habesha kemis ', kind: 'new_order' }))).toEqual({
      ok: true,
      value: { name: 'Habesha kemis', kind: 'new_order', notes: '' },
    });
  });

  it('refuses no name, a long one, an unknown kind and long notes', () => {
    const r = parseTemplate(form({ name: '', kind: 'repair', notes: 'n'.repeat(2001) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['kind', 'name', 'notes']);
    expect(parseTemplate(form({ name: 'x'.repeat(81), kind: 'fix' })).ok).toBe(false);
  });
});

describe('a step of a template', () => {
  it('starts some days before the job’s day, runs one day unless she says more', () => {
    expect(parseTemplateStep(form({ title: 'Cutting', 'days-before': '24' }))).toEqual({
      ok: true,
      value: { title: 'Cutting', daysBefore: 24, spanDays: 1, withClient: false },
    });
    expect(
      parseTemplateStep(
        form({ title: 'Fitting', 'days-before': '0', 'span-days': '2', 'with-client': 'on' }),
      ),
    ).toEqual({ ok: true, value: { title: 'Fitting', daysBefore: 0, spanDays: 2, withClient: true } });
  });

  it.each([
    [{ title: '', 'days-before': '1' }, 'title'],
    [{ title: 'A', 'days-before': '' }, 'days-before'],
    [{ title: 'A', 'days-before': '-1' }, 'days-before'],
    [{ title: 'A', 'days-before': '366' }, 'days-before'],
    [{ title: 'A', 'days-before': '1', 'span-days': '0' }, 'span-days'],
    [{ title: 'A', 'days-before': '1', 'span-days': '61' }, 'span-days'],
  ])('refuses %o', (fields, field) => {
    const r = parseTemplateStep(form(fields));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors)).toEqual([field]);
  });

  it('says when, in words', () => {
    expect(whenLabel(0, 1)).toBe('On the day');
    expect(whenLabel(1, 1)).toBe('The day before');
    expect(whenLabel(21, 7)).toBe('21 days before, for 7 days');
  });
});
