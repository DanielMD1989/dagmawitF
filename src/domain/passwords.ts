import { type FieldErrors, type Result } from './form-input';

/**
 * Signing in with an email and a password, and changing the password (decision 0065). The same minimum is set in
 * Supabase (supabase/config.toml locally; the dashboard for her project), which has the last word.
 */

export const MIN_PASSWORD = 10;
/** Supabase keeps passwords with bcrypt, which reads at most 72 bytes; a longer one would be cut without a word. */
export const MAX_PASSWORD_BYTES = 72;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A password field, exactly as typed: spaces count, so they are never trimmed. */
function secret(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === 'string' ? value : '';
}

export interface SignInFields {
  email: string;
  password: string;
}

export function parseSignIn(data: FormData): Result<SignInFields> {
  const errors: FieldErrors = {};
  const raw = data.get('email');
  const email = (typeof raw === 'string' ? raw : '').trim().toLowerCase();
  const password = secret(data, 'password');
  if (!EMAIL.test(email)) errors.email = 'Enter the email address this account was made with.';
  if (password === '') errors.password = 'Enter your password.';
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: { email, password } };
}

/** What is wrong with a new password, or null when nothing is. */
export function newPasswordProblem(password: string): string | null {
  if ([...password].length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES)
    return 'Use a shorter password (at most 72 letters).';
  if (password.trim() === '') return 'Use letters or numbers, not only spaces.';
  return null;
}

export interface PasswordChange {
  current: string;
  next: string;
}

export function parsePasswordChange(data: FormData): Result<PasswordChange> {
  const errors: FieldErrors = {};
  const current = secret(data, 'current-password');
  const next = secret(data, 'new-password');
  const again = secret(data, 'repeat-password');
  if (current === '') errors['current-password'] = 'Enter the password you use now.';
  const problem = newPasswordProblem(next);
  if (problem) errors['new-password'] = problem;
  else if (next === current) errors['new-password'] = 'Choose a password different from the one you use now.';
  if (!errors['new-password'] && again !== next)
    errors['repeat-password'] = 'The two new passwords are not the same.';
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: { current, next } };
}
