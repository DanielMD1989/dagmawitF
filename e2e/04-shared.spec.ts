import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { inspect, item, open, ready, signedInContext, text, watchErrors } from './support/app';
import { orderId, ownerId, sql, value } from './support/db';
import { env } from './support/env';
import { smallSwatch } from './support/pictures';

// A shared workspace (decision 0081): she adds Hanna's account in Settings; Hanna then sees and changes the same jobs,
// her changes are hers on the history, and when Hanna is removed she sees nothing of it. Runs on the jobs the earlier
// specs took.

test.describe.configure({ mode: 'serial' });

let herCtx: BrowserContext;
let helperCtx: BrowserContext;
let her: Page;
let helper: Page;
let herErrors: ReturnType<typeof watchErrors>;
let helperErrors: ReturnType<typeof watchErrors>;
let o1: string;

test.beforeAll(async ({ browser }) => {
  herCtx = await signedInContext(browser);
  helperCtx = await signedInContext(browser, 'phone', 'helper');
  her = await herCtx.newPage();
  helper = await helperCtx.newPage();
  herErrors = watchErrors(her);
  helperErrors = watchErrors(helper);
  o1 = await orderId(1);
});
test.afterAll(async () => {
  await herCtx.close();
  await helperCtx.close();
});

test('before she adds her, the second account sees nothing of hers', async () => {
  await helper.goto('/orders');
  expect(await text(helper)).not.toContain('Selam Bekele');
});

test('she adds the second account in Settings, by its email', async () => {
  await her.goto('/settings');
  const people = her.getByRole('list', { name: 'People of this workspace' });
  await expect(people).toContainText('Dagmawit (you)');
  const form = await open(her.locator('main'), 'Add a person');
  // An email with no account is refused in plain words.
  await form.getByLabel('Their email').fill('nobody.e2e@example.test');
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(her.locator('#email-error')).toHaveText(/^No account has that email/);
  await form.getByLabel('Their email').fill(env.helperEmail.toUpperCase());
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(people).toContainText('Hanna');
  await expect(people).toContainText(env.helperEmail);
  await inspect(her, 'settings with people');
});

test('the second account sees her jobs and works on them; what it does is hers', async () => {
  await helper.goto('/orders');
  await expect(helper.locator('main')).toContainText('Selam Bekele · Bridal gown');
  await helper.goto(`/orders/${o1}`);
  await ready(helper);
  const form = await open(helper.locator('main'), 'Add a step');
  await form.getByLabel('Step').fill('Embroidery');
  await form.getByLabel('Day', { exact: true }).fill(await value(`select (current_date + 3)::text`));
  await form.getByRole('button', { name: 'Add' }).click();
  await item(helper, 'Embroidery').waitFor();
  // In her workspace: she sees it too.
  await her.goto(`/orders/${o1}`);
  await expect(item(her, 'Embroidery')).toBeVisible();
  expect(await value(`select owner_id::text from public.task where title = 'Embroidery'`)).toBe(
    await ownerId(),
  );
});

test('a picture the second account adds is kept in her folder, and she sees it', async () => {
  await helper.goto(`/orders/${o1}/brief`);
  const group = helper.getByRole('group', { name: 'Fabric' });
  const form = await open(group, 'Add a fabric photo');
  await form.getByLabel('Picture').setInputFiles(await smallSwatch(helper));
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await group.locator('.photo', { hasText: 'Fabric 2' }).waitFor();
  const path = await value(
    `select storage_path from public.attachment where kind = 'fabric' and version = 2`,
  );
  expect(path.startsWith(`${await ownerId()}/`)).toBe(true);
  await her.goto(`/orders/${o1}/brief`);
  await expect(her.getByRole('group', { name: 'Fabric' }).locator('.photo__name')).toContainText([
    'Fabric 2',
  ]);
});

test('the history keeps who made each change', async () => {
  const lines = await sql<{ action: string; who: string }>(
    `select l.action, coalesce(p.name, '') as who from public.activity_log l
     left join public.profile p on p.owner_id = l.actor_id
     where l.order_id = $1 and l.action = 'file_added' order by l.seq desc limit 1`,
    [o1],
  );
  expect(lines).toEqual([{ action: 'file_added', who: 'Hanna' }]);
});

test('the second account’s Settings say whose workspace it is, without her download', async () => {
  await helper.goto('/settings');
  expect(await text(helper)).toContain('You work in Dagmawit’s workspace');
  await expect(helper.getByRole('link', { name: 'Download everything' })).toHaveCount(0);
  await expect(helper.getByText('Add a person')).toHaveCount(0);
  await inspect(helper, 'settings as a member');
});

test('she removes the second account: it sees nothing of hers again', async () => {
  await her.goto('/settings');
  const people = her.getByRole('list', { name: 'People of this workspace' });
  const row = people.locator('li', { hasText: 'Hanna' });
  await row.getByRole('button', { name: 'Remove' }).click();
  await row.getByRole('button', { name: 'Yes, remove' }).click();
  await expect(people).not.toContainText('Hanna');
  await helper.goto('/orders');
  expect(await text(helper)).not.toContain('Selam Bekele');
});

test('no browser errors along the way', async () => {
  expect(herErrors.list).toEqual([]);
  expect(helperErrors.list).toEqual([]);
});
