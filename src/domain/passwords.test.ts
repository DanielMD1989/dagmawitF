import { describe, expect, it } from 'vitest';
import { MIN_PASSWORD, newPasswordProblem, parsePasswordChange, parseSignIn } from './passwords';

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe('signing in', () => {
  it('takes the email, cleaned, and the password exactly as typed', () => {
    expect(parseSignIn(form({ email: '  Her@Example.com ', password: ' spaces count ' }))).toEqual({
      ok: true,
      value: { email: 'her@example.com', password: ' spaces count ' },
    });
  });

  it('asks for what is missing, next to its field', () => {
    expect(parseSignIn(form({ email: 'not an email', password: '' }))).toEqual({
      ok: false,
      errors: {
        email: 'Enter the email address this account was made with.',
        password: 'Enter your password.',
      },
    });
  });
});

describe('a new password', () => {
  it.each([
    ['a'.repeat(MIN_PASSWORD), null],
    ['correct horse battery', null],
    ['a'.repeat(MIN_PASSWORD - 1), 'Use at least 10 characters.'],
    ['ééééééééééééééééééééééééééééééééééééé', 'Use a shorter password (at most 72 letters).'],
    [' '.repeat(12), 'Use letters or numbers, not only spaces.'],
  ])('%j: %s', (password, problem) => {
    expect(newPasswordProblem(password)).toBe(problem);
  });
});

describe('changing the password', () => {
  const change = (current: string, next: string, again = next) =>
    parsePasswordChange(
      form({ 'current-password': current, 'new-password': next, 'repeat-password': again }),
    );

  it('takes the current password and a new one typed twice', () => {
    expect(change('old password', 'a new long password')).toEqual({
      ok: true,
      value: { current: 'old password', next: 'a new long password' },
    });
  });

  it('refuses a missing current password, a short new one, or two that differ', () => {
    expect(change('', 'short')).toEqual({
      ok: false,
      errors: {
        'current-password': 'Enter the password you use now.',
        'new-password': 'Use at least 10 characters.',
      },
    });
    expect(change('old password', 'a new long password', 'a new long passw0rd')).toEqual({
      ok: false,
      errors: { 'repeat-password': 'The two new passwords are not the same.' },
    });
  });

  it('refuses the same password again', () => {
    expect(change('the same password', 'the same password')).toEqual({
      ok: false,
      errors: { 'new-password': 'Choose a password different from the one you use now.' },
    });
  });
});
