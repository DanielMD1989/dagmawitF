import { chars, text, type Result } from '../form-input';

/** One line of her own list of measurements. The key never changes; the label can. */
export interface MeasurementField {
  id: string;
  key: string;
  label: string;
  sort: number;
  archived: boolean;
}

const MAX_KEY = 40;

/**
 * A stable key for a new field, made from its label: lower case letters, digits and underscores, starting
 * with a letter, and different from every key she already has (hidden ones too, because saved measurements
 * still use them). A label with no Latin letters (Amharic, say) gets a plain key; only the label is shown.
 */
export function keyFromLabel(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let base = label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (base === '') base = 'measurement';
  if (!/^[a-z]/.test(base)) base = `m_${base}`;
  base = base.slice(0, MAX_KEY).replace(/_+$/, '');

  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, MAX_KEY - suffix.length).replace(/_+$/, '')}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** The label of a measurement, as she typed it. */
export function parseFieldLabel(data: FormData, name = 'label'): Result<string> {
  const label = text(data, name);
  if (chars(label) === 0) return { ok: false, errors: { [name]: 'Enter a name for the measurement.' } };
  if (chars(label) > 60) return { ok: false, errors: { [name]: 'Keep the name under 60 characters.' } };
  return { ok: true, value: label };
}

/** Whether another visible field already has this label, in any capitals. The database refuses it too. */
export function labelTaken(label: string, fields: MeasurementField[], exceptId?: string): boolean {
  const wanted = label.toLowerCase();
  return fields.some((f) => !f.archived && f.id !== exceptId && f.label.toLowerCase() === wanted);
}

export type Direction = 'up' | 'down';

export function isDirection(value: string): value is Direction {
  return value === 'up' || value === 'down';
}

/**
 * The ids in a new order after one moves a place up or down. Null when it cannot move (it is not in the list,
 * or it is already first or last), so nothing is written for a tap that changes nothing.
 */
export function moveField(order: readonly string[], id: string, direction: Direction): string[] | null {
  const at = order.indexOf(id);
  if (at < 0) return null;
  const to = direction === 'up' ? at - 1 : at + 1;
  if (to < 0 || to >= order.length) return null;
  const next = [...order];
  [next[at], next[to]] = [order[to]!, order[at]!];
  return next;
}

/** The place a new field takes: after everything she has, hidden fields included. */
export function nextSort(fields: readonly Pick<MeasurementField, 'sort'>[]): number {
  return Math.min(10_000, fields.reduce((highest, f) => Math.max(highest, f.sort), 0) + 10);
}
