import { text, type Result } from '../form-input';

/**
 * Adding a person to her workspace (decision 0081): the email of an account already made for them.
 */
export function parsePersonEmail(data: FormData): Result<string> {
  const email = text(data, 'email');
  if (email === '') return { ok: false, errors: { email: 'Type the email of their account.' } };
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { ok: false, errors: { email: 'That does not look like an email.' } };
  return { ok: true, value: email };
}

/** What the database's refusal of an addition means, in her words. */
export function addPersonRefusal(code: string | undefined, message: string): string {
  if (code === 'P0002') return 'No account has that email yet. Make the account first, then add it here.';
  if (code === '23505') return 'That account already works in a workspace.';
  if (code === '42501') return 'Only the owner of this workspace can add people.';
  if (/your own account/.test(message)) return 'That is your own account.';
  if (/people of its own/.test(message))
    return 'That account has people of its own, so it cannot join yours.';
  return 'That person could not be added. Try again.';
}
