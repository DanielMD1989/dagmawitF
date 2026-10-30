import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { PASSWORD_FILE, inspect, open, signedInContext, watchErrors } from './support/app';
import { env, ZONE } from './support/env';

// Last, because changing the password and signing out touch the one session every spec shares (decision 0065).

test.describe.configure({ mode: 'serial' });

const signInWith = async (page: Page, password: string) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(env.email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
};

test('the sign-in page asks for an email and a password, and passes axe', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: env.baseURL });
  const page = await ctx.newPage();
  await page.goto('/sign-in');
  await expect(page.getByLabel('Email')).toHaveAttribute('autocomplete', 'username');
  await expect(page.getByLabel('Password')).toHaveAttribute('type', 'password');
  await inspect(page, 'sign-in', true);
  // Empty: asked for both, next to each field.
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#email-error')).toContainText('Enter the email address');
  await expect(page.locator('#password-error')).toContainText('Enter your password.');
  // A wrong password and an unknown email get the same answer.
  await signInWith(page, 'not her password at all');
  await expect(page.locator('.notice--error')).toHaveText(
    'That email and password do not match. Check both, then try again.',
  );
  await expect(page.getByLabel('Email')).toHaveValue(env.email);
  await expect(page.getByLabel('Password')).toHaveValue('');
  await page.getByLabel('Email').fill('nobody.at.all@example.test');
  await page.getByLabel('Password').fill('whatever password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.notice--error')).toHaveText(
    'That email and password do not match. Check both, then try again.',
  );
  await ctx.close();
});

test('she changes her password: the old one stops working, the new one works', async ({ browser }) => {
  const old = readFileSync(PASSWORD_FILE, 'utf8');
  const next = `${old}-new`;
  const ctx = await signedInContext(browser);
  const page = await ctx.newPage();
  const errors = watchErrors(page);
  await page.goto('/settings');
  const form = await open(page.locator('main'), 'Change the password');
  // The password she uses now is checked first.
  await form.getByLabel('Password you use now').fill('a wrong password');
  await form.getByLabel('New password', { exact: true }).fill(next);
  await form.getByLabel('New password again').fill(next);
  await form.getByRole('button', { name: 'Change the password' }).click();
  await expect(form.locator('#current-password-error')).toHaveText('That is not the password you use now.');
  // Too short, and two that differ.
  await form.getByLabel('Password you use now').fill(old);
  await form.getByLabel('New password', { exact: true }).fill('short');
  await form.getByRole('button', { name: 'Change the password' }).click();
  await expect(form.locator('#new-password-error')).toHaveText('Use at least 10 characters.');
  await form.getByLabel('Password you use now').fill(old);
  await form.getByLabel('New password', { exact: true }).fill(next);
  await form.getByLabel('New password again').fill(`${next}x`);
  await form.getByRole('button', { name: 'Change the password' }).click();
  await expect(form.locator('#repeat-password-error')).toHaveText('The two new passwords are not the same.');
  // Right.
  await form.getByLabel('Password you use now').fill(old);
  await form.getByLabel('New password', { exact: true }).fill(next);
  await form.getByLabel('New password again').fill(next);
  await form.getByRole('button', { name: 'Change the password' }).click();
  await expect(form.locator('.notice--success')).toHaveText(
    'Password changed. Use the new one next time you sign in.',
  );
  writeFileSync(PASSWORD_FILE, next, { mode: 0o600 });
  await inspect(page, 'settings after a password change');
  expect(errors.list).toEqual([]);
  await ctx.close();

  const fresh = await browser.newContext({ baseURL: env.baseURL });
  const p = await fresh.newPage();
  await signInWith(p, old);
  await expect(p.locator('.notice--error')).toContainText('do not match');
  await signInWith(p, next);
  await p.waitForURL(`${env.baseURL}/`);
  await fresh.close();
});

test('signing out removes what Today kept on the phone, and ends the session', async ({ browser }) => {
  // A fresh sign-in with the new password: whether a password change ends other sessions is Supabase's to decide.
  const ctx = await browser.newContext({ baseURL: env.baseURL, timezoneId: ZONE });
  const page = await ctx.newPage();
  const errors = watchErrors(page);
  await signInWith(page, readFileSync(PASSWORD_FILE, 'utf8'));
  await page.waitForURL(`${env.baseURL}/`);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('dagmawit.today.v2'))).not.toBeNull();
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(`${env.baseURL}/sign-in`);
  expect(
    await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('dagmawit'))),
  ).toEqual([]);
  await page.goto('/orders');
  await page.waitForURL(`${env.baseURL}/sign-in`);
  expect(errors.list).toEqual([]);
  await ctx.close();
});
