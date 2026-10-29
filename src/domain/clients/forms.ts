import { chars, text, type FieldErrors, type Result } from '../form-input';

export interface ClientFields {
  name: string;
  phone: string;
  notes: string;
}

const PHONE = /^[0-9+() .-]{5,30}$/;

/**
 * What is wrong with a client's details, by field. Takes tidied input (trimmed text). The database holds
 * the same limits, and test/fixtures/capture-cases.ts runs against both.
 */
export function clientProblems(c: ClientFields): FieldErrors {
  const errors: FieldErrors = {};
  if (chars(c.name) === 0) errors.name = 'Enter her name.';
  else if (chars(c.name) > 120) errors.name = 'Keep the name under 120 characters.';
  if (c.phone !== '' && !PHONE.test(c.phone))
    errors.phone = 'A phone number has 5 to 30 digits, spaces or + ( ) . - signs.';
  if (chars(c.notes) > 2000) errors.notes = 'Keep the notes under 2000 characters.';
  return errors;
}

/** Reads the client form: name, phone, notes. */
export function parseClient(data: FormData): Result<ClientFields> {
  const fields: ClientFields = {
    name: text(data, 'name'),
    phone: text(data, 'phone'),
    notes: text(data, 'notes'),
  };
  const errors = clientProblems(fields);
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: fields };
}
