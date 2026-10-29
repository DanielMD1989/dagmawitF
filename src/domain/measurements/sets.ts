import { formatDay, isIsoDate, type IsoDate } from '../dates';
import { chars, parseDecimal, text, type FieldErrors, type Result } from '../form-input';
import type { MeasurementField } from './fields';

export type MeasurementUnit = 'cm' | 'in';

export function isMeasurementUnit(value: unknown): value is MeasurementUnit {
  return value === 'cm' || value === 'in';
}

/** One client's measurements on one day, as saved. Never edited: a change is the next version. */
export interface MeasurementSet {
  id: string;
  clientId: string;
  version: number;
  takenOn: IsoDate;
  unit: MeasurementUnit;
  measures: Record<string, number>;
  note: string;
  createdAt: string;
}

export interface NewMeasurementSet {
  takenOn: IsoDate;
  unit: MeasurementUnit;
  measures: Record<string, number>;
  note: string;
}

export const MAX_MEASURE = 500;

/** Kept to a tenth, as the database keeps them. */
export function toTenth(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Why one typed measurement is not acceptable, or null when it is fine. */
export function measureProblem(raw: string): string | null {
  const n = parseDecimal(raw);
  if (n === null) return 'Use a number such as 92 or 92.5.';
  if (toTenth(n) <= 0) return 'A measurement must be more than zero.';
  if (toTenth(n) > MAX_MEASURE) return `A measurement cannot be more than ${MAX_MEASURE}.`;
  return null;
}

/**
 * Whether a saved set of measurements is well formed: an object with at least one entry, each key a
 * lower-case name and each value a number above zero, at most 500, in tenths. The database holds the
 * same rule (app.measurements_valid), and test/fixtures/capture-cases.ts runs against both.
 */
export function measuresValid(measures: unknown): boolean {
  if (typeof measures !== 'object' || measures === null || Array.isArray(measures)) return false;
  const entries = Object.entries(measures);
  if (entries.length === 0) return false;
  return entries.every(
    ([key, value]) =>
      /^[a-z][a-z0-9_]{0,39}$/.test(key) &&
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value > 0 &&
      value <= MAX_MEASURE &&
      toTenth(value) === value,
  );
}

/** The form field for a measurement: m-bust. */
export const measureFieldName = (key: string) => `m-${key}`;

/**
 * Reads the "record measurements" form. The form shows her visible fields; a field left empty is simply
 * not measured this time, and at least one must be given. A saved value is rounded to a tenth.
 */
export function parseMeasurementSet(
  data: FormData,
  shown: MeasurementField[],
  today: IsoDate,
): Result<NewMeasurementSet> {
  const errors: FieldErrors = {};

  const takenOn = text(data, 'taken-on');
  if (!isIsoDate(takenOn)) errors['taken-on'] = 'Choose the day she was measured.';
  else if (takenOn > today) errors['taken-on'] = 'That day has not come yet.';

  const unit = text(data, 'unit');
  if (!isMeasurementUnit(unit)) errors.unit = 'Choose centimetres or inches.';

  const note = text(data, 'note');
  if (chars(note) > 300) errors.note = 'Keep the note under 300 characters.';

  const measures: Record<string, number> = {};
  for (const field of shown) {
    const name = measureFieldName(field.key);
    const raw = text(data, name);
    if (raw === '') continue;
    const problem = measureProblem(raw);
    if (problem) errors[name] = problem;
    else measures[field.key] = toTenth(parseDecimal(raw)!);
  }
  if (Object.keys(errors).length === 0 && Object.keys(measures).length === 0) {
    errors.form = 'Enter at least one measurement.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { takenOn, unit: unit as MeasurementUnit, measures, note } };
}

export interface MeasureLine {
  key: string;
  label: string;
  value: number;
}

/**
 * The values of one version as lines to show: in the order of her list, with any measurement she no longer
 * shows (a hidden field, an old version) after them under its key rather than lost.
 */
export function measureLines(measures: Record<string, number>, fields: MeasurementField[]): MeasureLine[] {
  const known = new Set(fields.map((f) => f.key));
  const listed = fields
    .filter((f) => f.key in measures)
    .map((f) => ({ key: f.key, label: f.label, value: measures[f.key]! }));
  const rest = Object.keys(measures)
    .filter((key) => !known.has(key))
    .sort()
    .map((key) => ({ key, label: key, value: measures[key]! }));
  return [...listed, ...rest];
}

export interface MeasureChange {
  key: string;
  label: string;
  from: number | null;
  to: number | null;
}

/**
 * What differs between an earlier set and a later one, in the order of her list. Fields she no longer
 * shows still appear (by their key) when an old set used them. Only meaningful when both are in the same unit.
 */
export function changesBetween(
  earlier: Record<string, number> | null,
  later: Record<string, number>,
  fields: MeasurementField[],
): MeasureChange[] {
  const labels = new Map(fields.map((f) => [f.key, f.label]));
  const order = new Map(fields.map((f, i) => [f.key, i]));
  const keys = new Set([...Object.keys(earlier ?? {}), ...Object.keys(later)]);
  return [...keys]
    .filter((key) => (earlier?.[key] ?? null) !== (later[key] ?? null))
    .sort((a, b) => (order.get(a) ?? 9999) - (order.get(b) ?? 9999) || a.localeCompare(b))
    .map((key) => ({
      key,
      label: labels.get(key) ?? key,
      from: earlier?.[key] ?? null,
      to: later[key] ?? null,
    }));
}

/** "92.5 cm", "34 in". */
export function formatMeasure(value: number, unit: MeasurementUnit): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)} ${unit}`;
}

/** "+2.5 cm", "-1 cm". */
export function formatDelta(from: number, to: number, unit: MeasurementUnit): string {
  const delta = toTenth(to - from);
  const sign = delta > 0 ? '+' : delta < 0 ? '-' : '';
  return `${sign}${formatMeasure(Math.abs(delta), unit)}`;
}

export type GarmentMeasurementKind = 'none-recorded' | 'not-chosen' | 'current' | 'outdated';

/**
 * Which version of the client's measurements a garment is made to, in words, and whether a newer one exists.
 * `sets` is the client's versions, newest first. A garment keeps the version it was planned with, because it
 * may already be cut to those numbers; a newer version is offered, never applied by itself.
 */
export function garmentMeasurementStatus(
  setId: string | null,
  sets: readonly MeasurementSet[],
): { kind: GarmentMeasurementKind; text: string } {
  const latest = sets[0];
  if (!latest)
    return { kind: 'none-recorded', text: 'No measurements have been recorded for this client yet.' };
  const chosen = setId === null ? undefined : sets.find((s) => s.id === setId);
  if (!chosen) return { kind: 'not-chosen', text: 'No measurements chosen for this garment yet.' };
  const made = `Made to measurements version ${chosen.version}, taken ${formatDay(chosen.takenOn)}.`;
  if (chosen.id === latest.id) return { kind: 'current', text: made };
  return {
    kind: 'outdated',
    text: `${made} A newer version, ${latest.version}, was taken ${formatDay(latest.takenOn)}.`,
  };
}
