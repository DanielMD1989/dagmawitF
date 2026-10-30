import { describe, expect, it } from 'vitest';
import { parseTemplate, parseTemplateStep } from './forms';

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe('a list of steps', () => {
  it('has a name, and maybe notes', () => {
    expect(parseTemplate(form({ name: ' Habesha kemis ' }))).toEqual({
      ok: true,
      value: { name: 'Habesha kemis', notes: '' },
    });
  });

  it('refuses no name, a long one, and long notes', () => {
    const r = parseTemplate(form({ name: '', notes: 'n'.repeat(2001) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['name', 'notes']);
    expect(parseTemplate(form({ name: 'x'.repeat(81) })).ok).toBe(false);
  });

  it('has steps with a title, of at most 120 letters', () => {
    expect(parseTemplateStep(form({ title: ' Cutting ' }))).toEqual({ ok: true, value: 'Cutting' });
    expect(parseTemplateStep(form({ title: '' })).ok).toBe(false);
    expect(parseTemplateStep(form({ title: 'x'.repeat(121) })).ok).toBe(false);
  });
});
