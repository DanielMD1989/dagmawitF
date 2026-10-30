import { chars, text, type FieldErrors, type Result } from '../form-input';

/**
 * Her saved lists of steps (decision 0068): a name and the titles of its steps, in order. The days are given on each
 * job. The database holds the same limits.
 */

export interface TemplateFields {
  name: string;
  notes: string;
}

export function parseTemplate(data: FormData): Result<TemplateFields> {
  const errors: FieldErrors = {};
  const name = text(data, 'name');
  if (chars(name) === 0) errors.name = 'Give it a name, for example “Bridal gown”.';
  else if (chars(name) > 80) errors.name = 'Keep the name under 80 characters.';
  const notes = text(data, 'notes');
  if (chars(notes) > 2000) errors.notes = 'Keep the notes under 2000 characters.';
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: { name, notes } };
}

/** One step of a list: its title. */
export function parseTemplateStep(data: FormData): Result<string> {
  const title = text(data, 'title');
  if (chars(title) === 0)
    return { ok: false, errors: { title: 'Say what the step is, for example “Cutting”.' } };
  if (chars(title) > 120) return { ok: false, errors: { title: 'Keep this under 120 characters.' } };
  return { ok: true, value: title };
}
