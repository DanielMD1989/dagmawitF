import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { inspect, item, open, settled, signedInContext, text, watchErrors } from './support/app';
import { orderId, sql } from './support/db';
import { env, inDays } from './support/env';

// Stage 3 (docs/planning.md): her library of templates, an order's tasks from a template, proposals, review,
// approve and reject. Runs on the orders the capture spec entered.

test.describe.configure({ mode: 'serial' });

let ctx: BrowserContext;
let page: Page;
let errors: ReturnType<typeof watchErrors>;
let O1 = '';
let O2 = '';
const titles = () => page.locator('ul.items').first().locator('.item__title').allInnerTexts();
const garment = (name: string) =>
  page.locator('section', { has: page.locator('h2', { hasText: new RegExp(`^${name}$`) }) });

test.beforeAll(async ({ browser }) => {
  ctx = await signedInContext(browser);
  page = await ctx.newPage();
  errors = watchErrors(page);
  O1 = await orderId(1);
  O2 = await orderId(2);
});
test.afterAll(async () => ctx.close());

// ---------------------------------------------------------------- the library
test('library: three starting templates, reached from the navigation', async () => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Library' }).first().click();
  await page.waitForURL(`${env.baseURL}/library`);
  expect(await page.locator('.row-link__title').allInnerTexts()).toEqual([
    'Bridal gown',
    'Evening dress',
    'Suit alteration',
  ]);
  expect(await text(page)).toContain('13 tasks');
  await inspect(page, 'library');
});

test('library: a template lists its tasks in the order of the work', async () => {
  await page.getByRole('link', { name: /Bridal gown/ }).click();
  await page.waitForURL(/\/library\/[0-9a-f-]{36}$/);
  const t = await titles();
  expect(t[0]).toBe('Confirm design and neckline with the client');
  expect(t.at(-1)).toBe('Ready for handover');
  expect(t.indexOf('First fitting (toile)')).toBeGreaterThan(t.indexOf('Make the toile'));
  await expect(item(page, 'Apply the lace')).toContainText('Waits for Lace');
  await inspect(page, 'template');
});

test('library: she changes a duration to her own, and the template counts a new version', async () => {
  const pattern = item(page, 'Draft the pattern');
  await open(pattern, 'Edit');
  await pattern.getByLabel('hours').fill('5');
  await pattern.getByLabel('minutes').fill('30');
  await pattern.getByRole('button', { name: 'Save task' }).click();
  await pattern.locator('.notice--success').waitFor();
  await page.reload();
  await expect(item(page, 'Draft the pattern')).toContainText('5h 30m');
  expect(await text(page)).toContain('version 2');
});

test('library: a task with no name or no length is refused where she typed', async () => {
  await page.getByText('Add a task', { exact: true }).click();
  await page.locator('#new-task-title').fill('');
  await page.getByRole('button', { name: 'Add task' }).click();
  await page.locator('#new-task-title-error').waitFor();
  await expect(page.locator('#new-task-estimate-error')).toContainText('how long');
  await settled(page);
});

test('library: a new task, linked after another, waiting for an item', async () => {
  await page.locator('#new-task-title').fill('Make the bustle');
  await page.locator('#new-task-estimate-hours').fill('2');
  await page.getByRole('button', { name: 'Add task' }).click();
  const bustle = item(page, 'Make the bustle');
  await bustle.waitFor();
  await open(bustle, 'Edit');
  const after = bustle.getByLabel('Add a task it comes after');
  expect(await after.locator('option').allInnerTexts()).toContain('Hand finishing and pressing');
  await after.selectOption({ label: 'Hand finishing and pressing' });
  await bustle.getByRole('button', { name: 'Link' }).click();
  await bustle.getByText('After Hand finishing and pressing').waitFor();
  const t = await titles();
  expect(t.indexOf('Make the bustle')).toBeGreaterThan(t.indexOf('Hand finishing and pressing'));
  // What comes after it cannot be offered as what it comes after: that would be a loop.
  const finish = item(page, 'Hand finishing and pressing');
  await open(finish, 'Edit');
  const offered = await finish.getByLabel('Add a task it comes after').locator('option').allInnerTexts();
  expect(offered).not.toContain('Make the bustle');
  expect(offered).not.toContain('Ready for handover');
  await open(bustle, 'Edit');
  await bustle.getByLabel('Lace', { exact: true }).check();
  await bustle.getByRole('button', { name: 'Save what it waits for' }).click();
  await bustle.getByText('Waits for Lace').waitFor();
});

test('library: a link and a task can be removed', async () => {
  const bustle = item(page, 'Make the bustle');
  await open(bustle, 'Edit');
  await bustle.getByRole('button', { name: 'No longer after Hand finishing and pressing' }).click();
  await bustle.locator('.item__head', { hasText: 'After Hand finishing' }).waitFor({ state: 'detached' });
  await open(bustle, 'Edit');
  await bustle.getByRole('button', { name: 'Remove this task' }).click();
  await bustle.getByRole('button', { name: 'Yes, remove' }).click();
  await bustle.waitFor({ state: 'detached' });
});

test('library: what a garment waits for can be added; a repeated name is refused', async () => {
  await page.getByText('Add something it waits for').click();
  await page.locator('#new-item-label').fill('lace');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('#new-item-label-error')).toContainText('already waits');
  await settled(page);
  await page.locator('#new-item-label').fill('Veil');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await item(page, 'Veil').waitFor();
});

test('library: a template of her own, from nothing; a taken name is refused', async () => {
  await page.goto('/library/new');
  await page.getByLabel('Name').fill('Habesha kemis');
  await page.getByLabel('For which garment').fill('Habesha kemis');
  await page.getByRole('button', { name: 'Create template' }).click();
  await page.waitForURL(/\/library\/[0-9a-f-]{36}$/);
  for (const [title, hours] of [
    ['Weave the tibeb border', '6'],
    ['Sew the dress', '8'],
  ] as const) {
    await open(page.locator('main'), 'Add a task');
    await page.locator('#new-task-title').fill(title);
    await page.locator('#new-task-estimate-hours').fill(hours);
    await page.getByRole('button', { name: 'Add task' }).click();
    await item(page, title).waitFor();
    await settled(page);
  }
  const sew = item(page, 'Sew the dress');
  await open(sew, 'Edit');
  await sew.getByLabel('Add a task it comes after').selectOption({ label: 'Weave the tibeb border' });
  await sew.getByRole('button', { name: 'Link' }).click();
  await sew.getByText('After Weave the tibeb border').waitFor();
  await page.goto('/library/new');
  await page.getByLabel('Name').fill('BRIDAL GOWN');
  await page.getByLabel('For which garment').fill('x');
  await page.getByRole('button', { name: 'Create template' }).click();
  await expect(page.locator('#name-error')).toContainText('already have a template');
});

// ---------------------------------------------------------------- an order's plan
test('order 1: the Plan tab offers the template that matches each garment', async () => {
  await page.goto(`/orders/${O1}/plan`);
  expect(await text(page)).toContain('Not in an approved plan yet');
  const chosen = await garment('Bridal gown')
    .getByLabel('Template for Bridal gown')
    .evaluate((s: HTMLSelectElement) => s.selectedOptions[0]?.textContent);
  expect(chosen).toBe('Bridal gown');
  await inspect(page, 'plan tab empty');
});

test('order 1: applying copies the tasks and joins what the order already waits for', async () => {
  const gown = garment('Bridal gown');
  await gown.getByRole('button', { name: 'Apply template' }).click();
  await gown.getByText(/Planned from “Bridal gown”, version \d+\./).waitFor();
  const dress = garment('Bridesmaid dress');
  await dress.getByLabel('Template for Bridesmaid dress').selectOption({ label: 'Evening dress' });
  await dress.getByRole('button', { name: 'Apply template' }).click();
  await dress.getByText('Planned from “Evening dress”').waitFor();
  const labels = (
    await sql<{ label: string }>(`select label from public.prerequisite where order_id = $1 order by label`, [
      O1,
    ])
  ).map((r) => r.label);
  // Lace, Main fabric, Measurements taken and Design approved were entered in Stage 2: not repeated.
  expect(labels).toEqual([
    'Design approved by client',
    'Lace',
    'Lining',
    'Main fabric',
    'Measurements taken',
    'Veil',
    'Zip, buttons and trims',
  ]);
  expect(await text(page)).toContain('3 appointments have no day yet');
  await inspect(page, 'plan tab with tasks');
});

test('order 1: a first proposal says which fittings need a day, with a way to fix each', async () => {
  await page.getByRole('button', { name: 'Make a proposal' }).click();
  await page.waitForURL(/\/plan\/1\?order=/);
  const t = await text(page);
  expect(t).toContain('Review the proposed plan');
  expect(t).toContain('At risk');
  expect(t).toContain('"First fitting (toile)" has no day yet');
  expect(await page.getByRole('link', { name: 'Change the task' }).count()).toBeGreaterThanOrEqual(3);
  expect(t).toContain('Needs a day');
  await inspect(page, 'review at risk');
});

test('order 1: approving the first plan records it on the order', async () => {
  await page.getByRole('button', { name: /^Approve/ }).click();
  await page.waitForURL(`${env.baseURL}/orders/${O1}/plan`);
  expect(await text(page)).toContain('At risk in plan 1');
  await page.goto(`/orders/${O1}/history`);
  const t = await text(page);
  expect(t).toContain('Plan 1 approved: at risk');
  expect(t).toMatch(/Bridal gown planned from the template “Bridal gown” \(version \d+\): 13 tasks/);
});

test('order 1: the fittings get their days; the approved plan says it is out of date', async () => {
  await page.goto(`/orders/${O1}/plan`);
  for (const [title, days, time] of [
    ['First fitting (toile)', 7, '10:30'],
    ['Second fitting', 21, '10:30'],
    ['Fitting', 14, '11:00'],
  ] as const) {
    const f = item(page, title);
    await open(f, 'Edit');
    await f.getByLabel('Day', { exact: true }).fill(inDays(days));
    await f.getByLabel('Time', { exact: true }).fill(time);
    await f.getByRole('button', { name: 'Save task' }).click();
    await f.locator('.notice--success').waitFor();
    await settled(page);
  }
  const t = await text(page);
  expect(t).not.toContain('no day yet');
  expect(t).toContain('Something has changed since plan 1 was approved');
});

test('order 1: on the Preparation tab, what it waits for gets its arrivals and dates', async () => {
  await page.goto(`/orders/${O1}/preparation`);
  const set = async (label: string, state: 'received' | 'ordered', expected?: string) => {
    const it = item(page, label);
    await open(it, 'Update');
    await it.getByLabel('Where it stands').selectOption(state);
    if (expected) await it.getByLabel(/Expected to arrive|Answer expected/).fill(expected);
    await it.getByRole('button', { name: 'Save', exact: true }).click();
    await it.locator('.notice--success').waitFor();
    await settled(page);
  };
  await set('Measurements taken', 'received');
  await set('Design approved by client', 'received');
  for (const label of ['Lining', 'Zip, buttons and trims', 'Lace']) await set(label, 'ordered', inDays(3));
  const veil = item(page, 'Veil');
  await open(veil, 'Update');
  await veil.getByLabel('Work cannot start without it').uncheck();
  await veil.getByRole('button', { name: 'Save', exact: true }).click();
  await veil.locator('.notice--success').waitFor();
  await expect(veil).toContainText('Reminder');
});

test('order 1: a half-set appointment is refused', async () => {
  await page.goto(`/orders/${O1}/plan`);
  const f = item(page, 'First fitting (toile)');
  await open(f, 'Edit');
  await f.getByLabel('Time', { exact: true }).fill('');
  await f.getByRole('button', { name: 'Save task' }).click();
  await expect(f.locator('.error').first()).toContainText('time too');
  await page.reload();
});

test('order 1: the second proposal shows what changes and her shared weeks, and is approved', async () => {
  await page.getByRole('button', { name: 'Make a proposal' }).click();
  await page.waitForURL(/\/plan\/2\?order=/);
  const t = await text(page);
  expect(t).toContain('built on approved plan 1');
  expect(t).toContain('What changes, compared with plan 1');
  expect(t).toContain('Week of');
  expect(t).toMatch(/This order \d+h/);
  await inspect(page, 'review second');
  await page.getByRole('button', { name: /^Approve/ }).click();
  await page.waitForURL(`${env.baseURL}/orders/${O1}/plan`);
  expect(await text(page)).toMatch(/(On track|At risk|Cannot be made in time) in plan 2/);
  await expect(item(page, 'Draft the pattern')).toContainText('Planned ');
});

test('a stale proposal cannot be approved, even from a page opened before the change', async () => {
  await page.getByRole('button', { name: 'Make a proposal' }).click();
  await page.waitForURL(/\/plan\/3\?order=/);
  const other = await ctx.newPage();
  await other.goto(`/orders/${O1}/plan`);
  const cut = item(other, 'Cut fabric and lining');
  await open(cut, 'Edit');
  await cut.getByLabel('hours').fill('4');
  await cut.getByRole('button', { name: 'Save task' }).click();
  await cut.locator('.notice--success').waitFor();
  await other.close();
  await page.getByRole('button', { name: /^Approve/ }).click();
  await expect(page.locator('.notice--error')).toContainText(
    'Something has changed since this proposal was made',
  );
  await page.reload();
  expect(await text(page)).toContain('can no longer be approved');
  await expect(page.getByRole('button', { name: /^Approve/ })).toHaveCount(0);
});

test('a proposal can be rejected; the plans list shows each plan’s fate', async () => {
  await page.getByRole('button', { name: 'Make a new proposal' }).click();
  await page.waitForURL(/\/plan\/4\?order=/);
  await page.getByRole('button', { name: 'Reject proposal' }).click();
  await page.waitForURL(`${env.baseURL}/orders/${O1}/plan`);
  await page.goto('/plan');
  const t = await text(page);
  expect(t).toMatch(/Plan 2 .*Approved/);
  expect(t).toMatch(/Plan 4 .*Rejected/);
  expect(t).toMatch(/Plan 3 .*Proposed/);
  expect(t).toMatch(/Plan 1 .*Replaced/);
  await inspect(page, 'plans');
});

test('the whole-atelier view lists every active order', async () => {
  await page.goto('/plan/2');
  expect(await page.locator('.row-link__title').allInnerTexts()).toHaveLength(3);
  await inspect(page, 'plan overview');
});

test('order 2 has no tasks: it is in the plan, with nothing to place', async () => {
  await page.goto(`/plan/2?order=${O2}`);
  const t = await text(page);
  expect(t).toContain('Order #2');
  expect(t).toContain('No tasks yet');
});

test('My Day says which plan is approved', async () => {
  await page.goto('/');
  expect(await text(page)).toContain('From plan 2.');
});

test('desktop and night: every planning screen', async ({ browser }) => {
  for (const look of ['desktop', 'phone-night'] as const) {
    const c = await signedInContext(browser, look);
    const p = await c.newPage();
    const seen = watchErrors(p);
    for (const path of ['/library', `/orders/${O1}/plan`, `/plan/2?order=${O1}`, '/plan']) {
      expect((await p.goto(path))?.status(), `${look} ${path}`).toBe(200);
      await inspect(p, `${look} ${path}`);
    }
    expect(seen.list).toEqual([]);
    await c.close();
  }
});

test('no browser errors along the way', async () => {
  expect(errors.list).toEqual([]);
});
