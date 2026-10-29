import { expect, test } from '@playwright/test';
import { signedInContext, watchErrors } from './support/app';
import { env } from './support/env';

// Last, because signing out ends every session of hers (Supabase's default), the suite's shared one included.

test('signing out removes what My Day kept on the phone, and ends the session', async ({ browser }) => {
  const ctx = await signedInContext(browser);
  const page = await ctx.newPage();
  const errors = watchErrors(page);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('dagmawit.today.v1'))).not.toBeNull();
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
