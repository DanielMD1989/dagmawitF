import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { PASSWORD_FILE, STATE } from './support/app';
import { assertLocal, env, ZONE } from './support/env';

/**
 * Before the suite: a fresh account for her (deleting the last run's, and with it all its data) with a new random
 * password, then one sign-in, saved for every spec. The password is kept beside the session for the spec that
 * changes it.
 */
export default async function globalSetup(): Promise<void> {
  try {
    await prepare();
  } catch (error) {
    // On GitHub, say why as an annotation on the run: a setup failure is not a test failure, so no reporter shows it.
    if (process.env.GITHUB_ACTIONS) {
      const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
      console.log(
        `::error title=Browser suite setup failed::${message.replace(/%/g, '%25').replace(/\r?\n/g, '%0A')}`,
      );
    }
    throw error;
  }
}

async function prepare(): Promise<void> {
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
  const password = randomBytes(18).toString('base64url');
  const created = await admin.createUser({
    email: env.email,
    password,
    email_confirm: true,
    user_metadata: { name: 'Dagmawit' },
  });
  if (created.error) throw new Error(`Could not create the account: ${created.error.message}`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL: env.baseURL, timezoneId: ZONE, locale: 'en-GB' });
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(env.email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(`${env.baseURL}/`);
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(PASSWORD_FILE, password, { mode: 0o600 });
  await page.context().storageState({ path: STATE });
  await browser.close();
}
