import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { STATE } from './support/app';
import { assertLocal, env, ZONE } from './support/env';
import { signInCode } from './support/mailbox';

/**
 * Before the suite: a fresh account for her (deleting the last run's, and with it all its data), then one sign-in
 * by emailed code, saved for every spec. One sign-in, because Supabase sends at most one code a minute.
 */
export default async function globalSetup(): Promise<void> {
  assertLocal();
  if (!env.serviceRoleKey) {
    throw new Error(
      'Set SUPABASE_SERVICE_ROLE_KEY (from `supabase status`): the suite creates its account with it.',
    );
  }
  const admin = createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false } }).auth
    .admin;
  const { data, error } = await admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(`Could not list accounts: ${error.message}`);
  for (const u of data.users.filter((u) => u.email?.toLowerCase() === env.email.toLowerCase())) {
    const removed = await admin.deleteUser(u.id);
    if (removed.error) throw new Error(`Could not delete the last run's account: ${removed.error.message}`);
  }
  const created = await admin.createUser({
    email: env.email,
    email_confirm: true,
    user_metadata: { name: 'Dagmawit' },
  });
  if (created.error) throw new Error(`Could not create the account: ${created.error.message}`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL: env.baseURL, timezoneId: ZONE, locale: 'en-GB' });
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(env.email);
  const asked = new Date();
  await page.getByRole('button', { name: 'Send me a code' }).click();
  await page.locator('#code').waitFor();
  await page.locator('#code').fill(await signInCode(env.email, asked));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(`${env.baseURL}/`);
  mkdirSync(dirname(STATE), { recursive: true });
  await page.context().storageState({ path: STATE });
  await browser.close();
}
