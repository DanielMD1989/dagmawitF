import { describe, expect, it } from 'vitest';
import { parseOrderDefaults } from './preferences';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

describe('parseOrderDefaults', () => {
  it('reads the buffer and the unit', () => {
    expect(parseOrderDefaults(form({ 'default-buffer-days': '3', 'measurement-unit': 'in' }))).toEqual({
      ok: true,
      value: { defaultBufferDays: 3, measurementUnit: 'in' },
    });
  });

  it('accepts no buffer at all and the longest one', () => {
    expect(parseOrderDefaults(form({ 'default-buffer-days': '0', 'measurement-unit': 'cm' })).ok).toBe(true);
    expect(parseOrderDefaults(form({ 'default-buffer-days': '30', 'measurement-unit': 'cm' })).ok).toBe(true);
  });

  it.each(['', '-1', '31', '2.5', 'two', '1e1'])('refuses a buffer of %j, and says which field', (value) => {
    const result = parseOrderDefaults(form({ 'default-buffer-days': value, 'measurement-unit': 'cm' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors)).toEqual(['default-buffer-days']);
  });

  it.each(['', 'mm', 'CM', 'inches'])('refuses a unit of %j', (value) => {
    const result = parseOrderDefaults(form({ 'default-buffer-days': '2', 'measurement-unit': value }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors)).toEqual(['measurement-unit']);
  });

  it('reports both problems at once', () => {
    const result = parseOrderDefaults(form({}));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(Object.keys(result.errors).sort()).toEqual(['default-buffer-days', 'measurement-unit']);
  });
});
