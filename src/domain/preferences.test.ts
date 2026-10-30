import { describe, expect, it } from 'vitest';
import { parseMeasurementDefaults } from './preferences';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

describe('parseMeasurementDefaults', () => {
  it.each(['cm', 'in'])('reads %s', (unit) => {
    expect(parseMeasurementDefaults(form({ 'measurement-unit': unit }))).toEqual({
      ok: true,
      value: { measurementUnit: unit },
    });
  });

  it.each(['', 'ft', 'CM'])('refuses %j, and says which field', (value) => {
    const result = parseMeasurementDefaults(form({ 'measurement-unit': value }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors)).toEqual(['measurement-unit']);
  });
});
