import { describe, expect, it } from 'vitest';
import { addPersonRefusal, parsePersonEmail } from './forms';

const form = (email: string) => {
  const d = new FormData();
  d.set('email', email);
  return d;
};

describe('adding a person', () => {
  it('takes an email, trimmed', () => {
    expect(parsePersonEmail(form('  hanna@example.com '))).toEqual({ ok: true, value: 'hanna@example.com' });
  });

  it.each([
    ['', 'Type the email of their account.'],
    ['hanna', 'That does not look like an email.'],
    ['hanna@example', 'That does not look like an email.'],
  ])('refuses %j', (email, message) => {
    expect(parsePersonEmail(form(email))).toEqual({ ok: false, errors: { email: message } });
  });

  it('says why the database refused, in her words', () => {
    expect(addPersonRefusal('P0002', '')).toMatch(/^No account has that email/);
    expect(addPersonRefusal('23505', '')).toBe('That account already works in a workspace.');
    expect(addPersonRefusal('22023', 'that is your own account')).toBe('That is your own account.');
    expect(addPersonRefusal('22023', 'that account has people of its own')).toMatch(/people of its own/);
    expect(addPersonRefusal('42501', '')).toMatch(/Only the owner/);
  });
});
