import type { z } from 'zod';

/**
 * How every form's input is read. One way, so a message always appears next to the field it is about
 * and a form never answers in a different shape from another. (docs/architecture.md, rule 1.)
 */

/** Messages shown next to fields, by field name. Plain words, no codes. */
export type FieldErrors = Record<string, string>;

export type Result<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

/** A text field, trimmed. A field that was not sent reads as empty. */
export function text(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * An id sent by a form (a hidden field). Null when it is missing or not an id, so a damaged or made-up
 * request is refused before it reaches the database.
 */
export function idField(data: FormData, key: string): string | null {
  return asId(text(data, key));
}

/** An id from anywhere else a person can reach (the address of a page): null unless it really is one. */
export function asId(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return isUuid(trimmed) ? trimmed.toLowerCase() : null;
}

/** A checkbox: true when it was ticked. */
export function ticked(data: FormData, key: string): boolean {
  return data.get(key) === 'on';
}

/** The first problem zod found with each field, keyed by the field's name. */
export function issuesByField(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    errors[key] ??= issue.message;
  }
  return errors;
}

/** Whole-number text such as "12": digits only, no sign, no decimals. */
export function parseWholeNumber(raw: string): number | null {
  return /^\d{1,9}$/.test(raw) ? Number(raw) : null;
}

/** Characters as a person counts them (and as the database does), not UTF-16 units: an emoji is one. */
export function chars(value: string): number {
  return [...value].length;
}

/**
 * Reads a number she typed: digits with a point or a comma ("92.5" or "92,5"). No sign, no spaces, no
 * exponent. Returns null for anything else, including the empty string.
 */
export function parseDecimal(raw: string): number | null {
  const normal = raw.trim().replace(',', '.');
  if (!/^\d{1,6}(\.\d{1,6})?$/.test(normal)) return null;
  return Number(normal);
}
