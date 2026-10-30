import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { inspect, item, open, settled, signedInContext, text, watchErrors } from './support/app';
import { orderId, value } from './support/db';
import { env, inDays, today } from './support/env';

// Her calendar (docs/calendar-first.md): Today and the days ahead, ticking steps done, her own work, appointments
// and their times, what is overdue, steps over several days, moving a job's day, templates, and the month. Runs on
// the jobs 01-jobs.spec.ts took: #1 a bridal gown in 60 days, #2 an evening dress in 16, #3 a fix in 2.

test.describe.configure({ mode: 'serial' });

let ctx: BrowserContext;
let page: Page;
let errors: ReturnType<typeof watchErrors>;
const ids: Record<string, string> = {};
const has = async (words: string) => (await text(page)).includes(words);
/** The section of Today (or of the month) headed `heading`. */
const section = (heading: string) =>
  page.locator('section', { has: page.locator('h2', { hasText: new RegExp(`^${heading}`) }) }).first();
const stepDay = (order: string, title: string) =>
  value(`select on_day::text from public.task where order_id = $1 and title = $2`, [order, title]);

test.beforeAll(async ({ browser }) => {
  ctx = await signedInContext(browser);
  page = await ctx.newPage();
  errors = watchErrors(page);
  for (const n of [1, 2, 3]) ids[`o${n}`] = await orderId(n);
});
test.afterAll(async () => ctx.close());

test('Today lists today’s steps with their jobs, then the days ahead that have any', async () => {
  await page.goto('/');
  const fix = item(section('Today'), 'Fix');
  await expect(fix).toContainText('#3 · Yonas Alemu · Fix');
  // The fix is delivered in two days: under that day, not today.
  await expect(item(page, 'Delivery').first()).toBeVisible();
  await expect(item(section('Today'), 'Delivery')).toHaveCount(0);
  await inspect(page, 'today');
});

test('she ticks a step done, it tells the job’s history, and she can open it again', async () => {
  await page.getByRole('button', { name: 'Mark Fix as done' }).click();
  await page.getByRole('button', { name: 'Fix: done. Mark as not done' }).waitFor();
  expect(
    await value(`select done_on::text from public.task where order_id = $1 and title = 'Fix'`, [ids.o3]),
  ).toBe(today());
  await page.goto(`/orders/${ids.o3}/history`);
  expect(await has('Done: Fix')).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: 'Fix: done. Mark as not done' }).click();
  await page.getByRole('button', { name: 'Mark Fix as done' }).waitFor();
  expect(await value(`select done_on from public.task where order_id = $1 and title = 'Fix'`, [ids.o3])).toBe(
    '',
  );
});

test('something of her own for today, at a time', async () => {
  const form = await open(section('Today'), 'Add something for yourself');
  await form.getByLabel('Step').fill('Sharpen the shears');
  await form.getByLabel('From (optional)').fill('10:00');
  await form.getByLabel('To (optional)').fill('10:30');
  await form.getByRole('button', { name: 'Add' }).click();
  const own = item(page, 'Sharpen the shears');
  await expect(own).toContainText('10:00–10:30');
  await expect(own).toContainText('Your own');
});

test('a refused step keeps what she typed and says why next to the field', async () => {
  await page.goto('/');
  const form = await open(section('Today'), 'Add something for yourself');
  await form.getByLabel('Step').fill('Press the veil');
  await form.getByLabel('From (optional)').fill('11:00');
  await form.getByLabel('To (optional)').fill('10:00');
  await form.getByRole('button', { name: 'Add' }).click();
  await expect(form.locator('#own-to-error')).toHaveText('The end comes after the start.');
  await expect(form.getByLabel('Step')).toHaveValue('Press the veil');
  await settled(page);
});

test('an appointment is a job at a time on its day; an overlap with another time is pointed out', async () => {
  await page.goto('/orders/new?kind=appointment');
  await page.getByLabel('Client', { exact: true }).selectOption({ label: 'Selam Bekele' });
  await page.getByLabel('Day', { exact: true }).fill(today());
  await page.getByLabel('Time (optional)').fill('10:15');
  await expect(page.locator('#template option:checked')).toHaveText(/^Appointment/);
  await page.getByRole('button', { name: 'Save the job' }).click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
  ids.o4 = /\/orders\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  await expect(page.locator('h1')).toContainText('Appointment #4');
  await page.goto('/');
  const appointment = item(section('Today'), 'Appointment');
  await expect(appointment).toContainText('10:15');
  await expect(appointment).toContainText('Another appointment overlaps this time.');
  await expect(item(page, 'Sharpen the shears')).toContainText('Another appointment overlaps this time.');
  // Timed steps come first, in time order.
  const titles = await section('Today').locator('.item__title').allInnerTexts();
  expect(titles.slice(0, 2)).toEqual(['Sharpen the shears', 'Appointment']);
  await inspect(page, 'today with a clash');
});

test('a step whose day has passed waits under “Not done yet”, and its job says so', async () => {
  await page.goto(`/orders/${ids.o1}`);
  const step = item(page, 'Design agreed with the client');
  const form = await open(step, 'Change');
  await form.getByLabel('Day', { exact: true }).fill(inDays(-2));
  await form.getByRole('button', { name: 'Save the step' }).click();
  await form.locator('.notice--success').waitFor();
  await expect(page.locator('.card--warn')).toContainText(
    '“Design agreed with the client” was due and is not done.',
  );
  await page.goto('/');
  await expect(item(section('Not done yet'), 'Design agreed with the client')).toContainText('not done yet');
});

test('a step over several days shows on each of them', async () => {
  await page.goto(`/orders/${ids.o1}`);
  const form = await open(page.locator('main'), 'Add a step');
  await form.getByLabel('Step').fill('Beading');
  await form.getByLabel('Day', { exact: true }).fill(today());
  await form.getByLabel('Last day (optional)').fill(inDays(2));
  await form.getByRole('button', { name: 'Add' }).click();
  await item(page, 'Beading').waitFor();
  await expect(item(page, 'Beading')).toContainText('–');
  await page.goto('/');
  await expect(item(section('Today'), 'Beading')).toContainText('Day 1 of 3');
  await expect(item(section('Tomorrow'), 'Beading')).toContainText('Day 2 of 3');
});

test('moving a job’s day moves its steps not done yet by as many days', async () => {
  const fitting = await stepDay(ids.o1!, 'First fitting');
  expect(fitting).toBe(inDays(32));
  await page.goto(`/orders/${ids.o1}`);
  // Done steps stay where they were.
  await page.getByRole('button', { name: 'Mark Beading as done' }).click();
  await page.getByRole('button', { name: 'Beading: done. Mark as not done' }).waitFor();
  await page.getByLabel('Delivery day').fill(inDays(67));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.notice--success').last()).toHaveText(/^Saved\. 11 steps moved with the day\.$/);
  expect(await stepDay(ids.o1!, 'First fitting')).toBe(inDays(39));
  expect(await stepDay(ids.o1!, 'Delivery')).toBe(inDays(67));
  expect(await stepDay(ids.o1!, 'Design agreed with the client')).toBe(inDays(5));
  expect(await stepDay(ids.o1!, 'Beading')).toBe(today());
});

test('a step after the job’s day is pointed out', async () => {
  await page.goto(`/orders/${ids.o3}`);
  const form = await open(page.locator('main'), 'Add a step');
  await form.getByLabel('Step').fill('Press');
  await form.getByLabel('Day', { exact: true }).fill(inDays(5));
  await form.getByRole('button', { name: 'Add' }).click();
  await item(page, 'Press').waitFor();
  await expect(page.locator('.card--warn')).toContainText('“Press” is after the job’s day.');
  await expect(item(page, 'Press')).toContainText('After the job’s day.');
  // Removed again.
  const press = item(page, 'Press');
  await open(press, 'Change');
  await press.getByRole('button', { name: 'Remove this step' }).click();
  await press.getByRole('button', { name: 'Yes, remove' }).click();
  await press.waitFor({ state: 'detached' });
});

test('a job taken with no steps gets a template’s steps afterwards', async () => {
  await page.goto('/orders/new?kind=sketch');
  await page.getByLabel('Client', { exact: true }).selectOption({ label: 'Hanna Tesfaye' });
  await page.getByLabel('Show the client on').fill(inDays(10));
  await page.getByLabel('Start with the steps of').selectOption({ label: 'No steps yet: I will add them' });
  await page.getByRole('button', { name: 'Save the job' }).click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
  expect(await has('No steps yet.')).toBe(true);
  await expect(page.getByLabel('Steps of')).toHaveValue(/[0-9a-f-]{36}/);
  await page.getByRole('button', { name: 'Add these steps' }).click();
  // The steps take the place of the empty card.
  await expect(page.locator('li.item .item__title')).toHaveText(['Sketch', 'Show the client']);
  expect(await has('No steps yet.')).toBe(false);
});

test('library: she changes when a step starts, and makes a template a new job then starts with', async () => {
  await page.goto('/library');
  await inspect(page, 'library');
  await page.getByRole('link', { name: /^Dress/ }).click();
  const buy = item(page, 'Buy fabric');
  const form = await open(buy, 'Change');
  await form.getByLabel('Days before the job’s day').fill('30');
  await form.getByRole('button', { name: 'Save the step' }).click();
  await expect(item(page, 'Buy fabric')).toContainText('30 days before');
  await inspect(page, 'template');

  await page.goto('/library/new');
  await page.getByLabel('Name').fill('Habesha kemis');
  await page.getByRole('button', { name: 'Create template' }).click();
  await page.waitForURL(/\/library\/[0-9a-f-]{36}$/);
  for (const [title, before, span] of [
    ['Weave the tibeb', '20', '10'],
    ['Delivery', '0', '1'],
  ] as const) {
    const add = await open(page.locator('main'), 'Add a step');
    await add.getByLabel('Step').fill(title);
    await add.getByLabel('Days before the job’s day').fill(before);
    await add.getByLabel('For how many days').fill(span);
    await add.getByRole('button', { name: 'Add' }).click();
    await item(page, title).waitFor();
    await settled(page);
  }
  await expect(item(page, 'Weave the tibeb')).toContainText('20 days before, for 10 days');

  await page.goto('/orders/new');
  await page.getByLabel('Garment', { exact: true }).fill('Habesha kemis');
  await expect(page.locator('#template option:checked')).toHaveText(/^Habesha kemis \(2 steps\)/);
});

test('the month: how many steps each day holds, and the list of the day she picks', async () => {
  await page.goto('/calendar');
  await inspect(page, 'month');
  const todayCell = page.locator('.month__day--today');
  await expect(todayCell).toHaveAttribute('aria-current', 'date');
  await expect(todayCell.locator('.month__count')).toHaveText(/^\d+$/);
  await expect(
    section(new Date().toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Africa/Addis_Ababa' })),
  ).toContainText('Appointment');
  await page.getByRole('link', { name: 'Next month' }).click();
  await page.waitForURL(/month=\d{4}-\d{2}$/);
  await page.getByRole('link', { name: 'This month' }).click();
  await page.waitForURL(`${env.baseURL}/calendar`);
});

test('desktop and night: every calendar screen', async ({ browser }) => {
  const template = await value(
    `select t.id from public.template t join auth.users u on u.id = t.owner_id where u.email = $1 and t.name = 'Dress'`,
    [env.email],
  );
  const screens = ['/', '/calendar', '/library', `/library/${template}`, '/orders/new', `/orders/${ids.o4}`];
  for (const look of ['desktop', 'phone-night'] as const) {
    const c = await signedInContext(browser, look);
    const p = await c.newPage();
    const seen = watchErrors(p);
    for (const path of screens) {
      const r = await p.goto(path);
      expect(r?.status(), `${look} ${path}`).toBe(200);
      await inspect(p, `${look} ${path}`);
    }
    expect(seen.list).toEqual([]);
    await c.close();
  }
});

test('no browser errors along the way', async () => {
  expect(errors.list).toEqual([]);
});
