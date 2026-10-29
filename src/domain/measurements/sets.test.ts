import { describe, expect, it } from 'vitest';
import { MEASURES_CASES } from '../../../test/fixtures/capture-cases';
import type { MeasurementField } from './fields';
import {
  changesBetween,
  formatDelta,
  formatMeasure,
  garmentMeasurementStatus,
  measureLines,
  measureProblem,
  measuresValid,
  parseMeasurementSet,
  toTenth,
} from './sets';

const fields: MeasurementField[] = [
  { id: '1', key: 'bust', label: 'Bust', sort: 10, archived: false },
  { id: '2', key: 'waist', label: 'Waist', sort: 20, archived: false },
  { id: '3', key: 'hip', label: 'Hip', sort: 30, archived: false },
];

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

const base = { 'taken-on': '2026-10-20', unit: 'cm' };

describe('measurements as saved', () => {
  // The same cases the database's constraints are tested with, so the two cannot drift apart.
  it.each(MEASURES_CASES)('agree with the database on $label', ({ measures, valid }) => {
    expect(measuresValid(measures)).toBe(valid);
  });
});

describe('one typed measurement', () => {
  it.each(['92', '92.5', '92,5', '0.1', '500'])('accepts %s', (raw) =>
    expect(measureProblem(raw)).toBeNull(),
  );
  it.each(['', '0', '0.04', '-3', 'abc', '500.1', '1e2'])('refuses %j', (raw) =>
    expect(measureProblem(raw)).not.toBeNull(),
  );
  it('keeps a tenth', () => {
    expect(toTenth(92.25)).toBe(92.3);
    expect(toTenth(92.24)).toBe(92.2);
    expect(toTenth(34.125)).toBe(34.1);
  });
});

describe('the record-measurements form', () => {
  const today = '2026-10-25';

  it('reads the ones filled in and skips the rest', () => {
    expect(
      parseMeasurementSet(
        form({ ...base, 'm-bust': '92,5', 'm-waist': '70', 'm-hip': '', note: ' After diet ' }),
        fields,
        today,
      ),
    ).toEqual({
      ok: true,
      value: { takenOn: '2026-10-20', unit: 'cm', measures: { bust: 92.5, waist: 70 }, note: 'After diet' },
    });
  });

  it('rounds to a tenth so the database accepts it', () => {
    const r = parseMeasurementSet(form({ ...base, unit: 'in', 'm-bust': '34.25' }), fields, today);
    expect(r).toMatchObject({ ok: true, value: { measures: { bust: 34.3 } } });
    if (r.ok) expect(measuresValid(r.value.measures)).toBe(true);
  });

  it('ignores a measurement for a field that was not shown', () => {
    expect(
      parseMeasurementSet(form({ ...base, 'm-bust': '90', 'm-wingspan': '180' }), fields, today),
    ).toMatchObject({
      ok: true,
      value: { measures: { bust: 90 } },
    });
  });

  it('needs at least one measurement', () => {
    expect(parseMeasurementSet(form({ ...base }), fields, today)).toEqual({
      ok: false,
      errors: { form: 'Enter at least one measurement.' },
    });
  });

  it('puts each problem next to its own field', () => {
    const r = parseMeasurementSet(
      form({
        'taken-on': '2026-10-26',
        unit: 'ft',
        'm-bust': 'abc',
        'm-waist': '0',
        'm-hip': '90',
        note: 'n'.repeat(301),
      }),
      fields,
      today,
    );
    expect(r).toEqual({
      ok: false,
      errors: {
        'taken-on': 'That day has not come yet.',
        unit: 'Choose centimetres or inches.',
        note: 'Keep the note under 300 characters.',
        'm-bust': 'Use a number such as 92 or 92.5.',
        'm-waist': 'A measurement must be more than zero.',
      },
    });
  });

  it('accepts today and refuses a day that is not a date', () => {
    expect(parseMeasurementSet(form({ ...base, 'taken-on': today, 'm-bust': '90' }), fields, today).ok).toBe(
      true,
    );
    expect(
      parseMeasurementSet(form({ ...base, 'taken-on': '2026-02-30', 'm-bust': '90' }), fields, today),
    ).toMatchObject({
      ok: false,
      errors: { 'taken-on': 'Choose the day she was measured.' },
    });
  });
});

describe('what changed between two versions', () => {
  it('lists what differs, in the order of her list', () => {
    const changes = changesBetween(
      { bust: 90, waist: 70, hip: 98 },
      { bust: 90, waist: 72.5, hip: 97 },
      fields,
    );
    expect(changes).toEqual([
      { key: 'waist', label: 'Waist', from: 70, to: 72.5 },
      { key: 'hip', label: 'Hip', from: 98, to: 97 },
    ]);
  });

  it('shows a measurement that is new or no longer taken', () => {
    expect(changesBetween({ bust: 90 }, { bust: 90, waist: 70 }, fields)).toEqual([
      { key: 'waist', label: 'Waist', from: null, to: 70 },
    ]);
    expect(changesBetween({ bust: 90, waist: 70 }, { bust: 90 }, fields)).toEqual([
      { key: 'waist', label: 'Waist', from: 70, to: null },
    ]);
  });

  it('shows every measurement of a first version', () => {
    expect(changesBetween(null, { waist: 70, bust: 90 }, fields).map((c) => c.key)).toEqual([
      'bust',
      'waist',
    ]);
  });

  it('still names a measurement she has since hidden or removed from the screen, by its key', () => {
    expect(changesBetween({ wingspan: 180 }, { wingspan: 181 }, fields)).toEqual([
      { key: 'wingspan', label: 'wingspan', from: 180, to: 181 },
    ]);
  });

  it('says nothing when nothing changed', () => {
    expect(changesBetween({ bust: 90 }, { bust: 90 }, fields)).toEqual([]);
  });
});

describe('writing measurements', () => {
  it('shows whole numbers plainly and others to a tenth', () => {
    expect(formatMeasure(92, 'cm')).toBe('92 cm');
    expect(formatMeasure(92.5, 'cm')).toBe('92.5 cm');
    expect(formatMeasure(34, 'in')).toBe('34 in');
  });

  it('shows a difference with its sign', () => {
    expect(formatDelta(70, 72.5, 'cm')).toBe('+2.5 cm');
    expect(formatDelta(98, 97, 'cm')).toBe('-1 cm');
    expect(formatDelta(70, 70, 'cm')).toBe('0 cm');
    expect(formatDelta(0.1, 0.3, 'in')).toBe('+0.2 in');
  });
});

describe('measureLines', () => {
  it('lists the values in the order of her list, leaving out what was not measured', () => {
    expect(measureLines({ hip: 98, bust: 92 }, fields)).toEqual([
      { key: 'bust', label: 'Bust', value: 92 },
      { key: 'hip', label: 'Hip', value: 98 },
    ]);
  });

  it('keeps a measurement she no longer lists, after the rest, under its key', () => {
    expect(measureLines({ neck: 36, bust: 92, ankle: 22 }, fields)).toEqual([
      { key: 'bust', label: 'Bust', value: 92 },
      { key: 'ankle', label: 'ankle', value: 22 },
      { key: 'neck', label: 'neck', value: 36 },
    ]);
  });

  it('still shows a field she has hidden, with its label', () => {
    const hidden = fields.map((f) => (f.key === 'waist' ? { ...f, archived: true } : f));
    expect(measureLines({ waist: 70 }, hidden)).toEqual([{ key: 'waist', label: 'Waist', value: 70 }]);
  });

  it('is empty for nothing', () => {
    expect(measureLines({}, fields)).toEqual([]);
  });
});

describe('garmentMeasurementStatus', () => {
  const set = (id: string, version: number, takenOn: string) => ({
    id,
    clientId: 'c',
    version,
    takenOn,
    unit: 'cm' as const,
    measures: { bust: 90 },
    note: '',
    createdAt: `${takenOn}T10:00:00Z`,
  });
  const sets = [set('v3', 3, '2026-10-20'), set('v2', 2, '2026-10-12'), set('v1', 1, '2026-09-01')];

  it('says when there are no measurements at all', () => {
    expect(garmentMeasurementStatus(null, [])).toMatchObject({ kind: 'none-recorded' });
    expect(garmentMeasurementStatus('v1', [])).toMatchObject({ kind: 'none-recorded' });
  });

  it('says when measurements exist but this garment has none chosen', () => {
    expect(garmentMeasurementStatus(null, sets)).toMatchObject({ kind: 'not-chosen' });
    expect(garmentMeasurementStatus('gone', sets)).toMatchObject({ kind: 'not-chosen' });
  });

  it('names the version of a garment made to the latest measurements', () => {
    expect(garmentMeasurementStatus('v3', sets)).toEqual({
      kind: 'current',
      text: 'Made to measurements version 3, taken Tue 20 Oct.',
    });
  });

  it('points out that a newer version exists, without applying it', () => {
    expect(garmentMeasurementStatus('v2', sets)).toEqual({
      kind: 'outdated',
      text: 'Made to measurements version 2, taken Mon 12 Oct. A newer version, 3, was taken Tue 20 Oct.',
    });
    expect(garmentMeasurementStatus('v1', sets).kind).toBe('outdated');
  });
});
