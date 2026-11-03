import { text, type Result } from './form-input';

/** Her name as she types it in Settings; up to 120 characters, as the database allows. Empty is allowed. */
export function parseName(data: FormData): Result<string> {
  const name = text(data, 'name');
  if (name.length > 120) return { ok: false, errors: { name: 'Keep the name under 120 characters.' } };
  return { ok: true, value: name };
}
