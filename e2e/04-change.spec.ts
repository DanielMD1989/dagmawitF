import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { inspect, item, open, signedInContext, text, watchErrors } from './support/app';
import { orderId, value } from './support/db';
import { addDays, env, inDays, mondayOf, today } from './support/env';

// Stage 5 (docs/change.md): the lace delay by hand with Save and see impact, a task pinned to a day, and the
// Planner's week board.

test.describe.configure({ mode: 'serial' });

let ctx: BrowserContext;
let page: Page;
let errors: ReturnType<typeof watchErrors>;
let O1 = '';

/** The days the approved plan gives a task of order 1 (titles repeat across garments: all of them). */
const planned = (title: string) =>
  value(
    `select coalesce(string_agg(distinct s.day::text, ',' order by s.day::text), '')
     from public.plan_slot s
     join public.plan_version v on v.id = s.plan_id and v.status = 'approved'
     join public.task k on k.id = s.task_id
     where k.title = $1 and k.order_id = $2`,
    [title, O1],
  );

test.beforeAll(async ({ browser }) => {
  ctx = await signedInContext(browser);
  page = await ctx.newPage();
  errors = watchErrors(page);
  O1 = await orderId(1);
});
test.afterAll(async () => ctx.close());

test('a plan made on today’s facts is approved', async () => {
  await page.goto(`/orders/${O1}/plan`);
  await page.getByRole('button', { name: /Make (a|a new) proposal/ }).click();
  await page.waitForURL(/\/plan\/\d+\?order=/);
  await page.getByRole('button', { name: /^Approve/ }).click();
  await page.waitForURL(`${env.baseURL}/orders/${O1}/plan`);
});

test('the phone bar: My Day, Orders, Planner, Library, Settings; Clients from Orders', async () => {
  expect(await page.locator('.nav__link:visible').allInnerTexts()).toEqual([
    'My Day',
    'Orders',
    'Planner',
    'Library',
    'Settings',
  ]);
  await page.goto('/orders');
  await page.getByRole('link', { name: 'Clients' }).first().click();
  await page.waitForURL(`${env.baseURL}/clients`);
});

test('the Planner shows this week of the approved plan', async () => {
  await page.getByRole('link', { name: 'Planner' }).first().click();
  await page.waitForURL(`${env.baseURL}/planner`);
  const t = await text(page);
  expect(t).toContain('Week of');
  expect(t).toMatch(/planned this week, of/);
  await expect(page.locator('.board__day')).toHaveCount(7);
  await expect(page.locator('.board__day--today')).toHaveCount(1);
  expect(await page.locator('.board__task').count()).toBeGreaterThan(0);
  await inspect(page, 'planner');
  await page.getByRole('link', { name: 'Next week' }).click();
  await page.waitForURL(/week=/);
  const nextMonday = new Date(`${addDays(mondayOf(today()), 7)}T00:00:00Z`).getUTCDate().toString();
  await expect(page.locator('h1')).toContainText(nextMonday);
});

let laceBefore = '';
test('the lace is late: Save and see impact shows what moves', async () => {
  laceBefore = await planned('Apply the lace');
  await page.goto(`/orders/${O1}/preparation`);
  const lace = item(page, 'Lace');
  await open(lace, 'Update');
  await lace.getByLabel('Where it stands').selectOption('ordered');
  await lace.getByLabel('Expected to arrive').fill(inDays(25));
  await lace.getByRole('button', { name: 'Save and see impact' }).click();
  await page.waitForURL(/\/plan\/\d+\?order=/);
  const t = await text(page);
  expect(t).toContain('What moves');
  const moves = t.slice(t.indexOf('What moves'), t.indexOf('What moves') + 600);
  expect(moves).toMatch(/Apply the lace .*→|Apply the lace .*no longer planned/);
  await inspect(page, 'impact review');
});

test('approving it moves the work on the Planner too', async () => {
  await page.getByRole('button', { name: /^Approve/ }).click();
  await page.waitForURL(`${env.baseURL}/orders/${O1}/plan`);
  const after = (await planned('Apply the lace')).split(',')[0]!;
  expect(after > inDays(24), `lace work ${laceBefore} → ${after}`).toBe(true);
  expect(after).not.toBe(laceBefore.split(',')[0]);
  await page.goto(`/planner?week=${after}`);
  expect(await text(page)).toContain('Apply the lace');
});

test('a piece of work pinned to a day, with its impact', async () => {
  await page.goto(`/orders/${O1}/plan`);
  const target = inDays(30);
  const finishing = item(page, 'Hand finishing and pressing');
  await open(finishing, 'Edit');
  await finishing.getByLabel('Pin to a day (optional)').fill(target);
  await finishing.getByRole('button', { name: 'Save and see impact' }).click();
  await page.waitForURL(/\/plan\/\d+\?order=/);
  const t = await text(page);
  expect(t.slice(t.indexOf('What moves'))).toMatch(/Hand finishing and pressing .*→/);
  await page.getByRole('button', { name: /^Approve/ }).click();
  await page.waitForURL(`${env.baseURL}/orders/${O1}/plan`);
  // The bridal gown's finishing is pinned; the bridesmaid dress has a task of the same name, planned as usual.
  const id = await value(
    `select id from public.task where order_id = $1 and title = 'Hand finishing and pressing' and pinned_on = $2`,
    [O1, target],
  );
  expect(
    await value(
      `select string_agg(distinct s.day::text, ',') from public.plan_slot s
       join public.plan_version v on v.id = s.plan_id and v.status = 'approved' where s.task_id = $1`,
      [id],
    ),
  ).toBe(target);
  expect(await text(page)).toContain('pinned to');
});

test('a change the engine cannot plan stays saved and says why', async () => {
  await page.goto(`/orders/${O1}/plan`);
  const fitting = item(page, 'First fitting (toile)');
  const before = await value(
    `select fixed_on::text from public.task where order_id = $1 and title = 'First fitting (toile)'`,
    [O1],
  );
  await open(fitting, 'Edit');
  await fitting.getByLabel('Day', { exact: true }).fill(inDays(-1));
  await fitting.getByRole('button', { name: 'Save and see impact' }).click();
  const notice = fitting.locator('.notice--error');
  await expect(notice).toContainText('has passed');
  expect(await notice.innerText()).toMatch(/^Saved\./);
  // She puts the fitting back on its day.
  await fitting.getByLabel('Day', { exact: true }).fill(before);
  await fitting.getByRole('button', { name: 'Save task' }).click();
  await expect(fitting.locator('.notice--success')).toBeVisible();
});

test('desktop and night: the change screens, and the sidebar keeps Clients', async ({ browser }) => {
  for (const look of ['desktop', 'phone-night'] as const) {
    const c = await signedInContext(browser, look);
    const p = await c.newPage();
    const seen = watchErrors(p);
    for (const path of ['/planner', `/orders/${O1}/preparation`, '/orders']) {
      expect((await p.goto(path))?.status(), `${look} ${path}`).toBe(200);
      await inspect(p, `${look} ${path}`);
    }
    if (look === 'desktop') {
      const names = await p.locator('.nav__link:visible').allInnerTexts();
      expect(names).toContain('Clients');
      expect(names).toContain('Planner');
    }
    expect(seen.list).toEqual([]);
    await c.close();
  }
});

test('no browser errors along the way', async () => {
  expect(errors.list).toEqual([]);
});
