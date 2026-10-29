import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { inspect, open, settled, signedInContext, text, watchErrors } from './support/app';
import { orderId, value } from './support/db';
import { env } from './support/env';

// Stage 4 (docs/my-day.md): a day lived from the approved plan: start, done with the time it took, still going,
// hold, blocked, Quick Add, and the end-of-day review into tomorrow's plan.

test.describe.configure({ mode: 'serial' });

let ctx: BrowserContext;
let page: Page;
let errors: ReturnType<typeof watchErrors>;
let O1 = '';

interface Entry {
  id: string;
  title: string;
  state: string;
  kind: string;
}
let today: Entry[] = [];

/** Today's list as My Day kept it on the phone: the same entries, in the same order as on screen. */
const kept = async (): Promise<Entry[]> =>
  (
    JSON.parse(
      (await page.evaluate(() => localStorage.getItem('dagmawit.today.v1'))) ?? '{"entries":[]}',
    ) as { entries: Entry[] }
  ).entries;
/** An entry of today's list by its place (titles repeat across garments; places do not). */
const entry = (i: number): Locator => page.locator('main li.item').nth(i);
const chip = (i: number) => entry(i).locator('.item__head > .chip');
const taskStatus = (id: string) => value(`select status from public.task where id = $1`, [id]);

async function approveFresh(): Promise<void> {
  await page.goto(`/orders/${O1}/plan`);
  await page.getByRole('button', { name: /Make (a|a new) proposal/ }).click();
  await page.waitForURL(/\/plan\/\d+\?order=/);
  await page.getByRole('button', { name: /^Approve/ }).click();
  await page.waitForURL(`${env.baseURL}/orders/${O1}/plan`);
}

test.beforeAll(async ({ browser }) => {
  ctx = await signedInContext(browser);
  page = await ctx.newPage();
  errors = watchErrors(page);
  O1 = await orderId(1);
});
test.afterAll(async () => ctx.close());

test('a plan made on today’s facts is approved', async () => {
  await approveFresh();
});

test('My Day lists today’s work from the approved plan, with the time it takes', async () => {
  await page.goto('/');
  const t = await text(page);
  expect(t).toMatch(/planned of \d+h \d+m usable/);
  expect(t).toMatch(/From plan \d+\./);
  expect(t).not.toContain('Something has changed');
  expect(t).toMatch(/planned, in suggested order/i);
  await expect.poll(async () => (await kept()).length).toBeGreaterThanOrEqual(2);
  today = await kept();
  expect(
    today.filter((e) => e.state === 'ready').length,
    today.map((e) => `${e.title}:${e.state}`).join('|'),
  ).toBeGreaterThanOrEqual(2);
  await inspect(page, 'my day');
});

const ready = (n: number) =>
  today.findIndex(
    (e, i) => e.state === 'ready' && today.slice(0, i).filter((x) => x.state === 'ready').length === n,
  );

test('a task waiting for material shows as blocked, with the item and its day', async () => {
  // Before she starts anything: on the order's Plan tab she says the first task needs the lace, which is ordered,
  // not here.
  const i = ready(0);
  const task = today[i]!;
  await page.goto(`/orders/${O1}/plan`);
  const editor = page.locator(`#task-${task.id}`);
  if (!(await editor.evaluate((el) => (el as HTMLDetailsElement).open)))
    await editor.locator('summary').first().click();
  await editor.getByLabel('Lace', { exact: true }).check();
  await editor.getByRole('button', { name: 'Save what it waits for' }).click();
  await expect(editor.locator('.notice--success').last()).toBeVisible();
  await page.goto('/');
  await expect(chip(i)).toHaveText('Blocked');
  await expect(entry(i)).toContainText('Lace not received. Expected');
  await expect(entry(i)).toContainText('not counted today');
  await expect(entry(i).getByRole('link', { name: 'Update expected date' })).toHaveCount(1);
  await inspect(page, 'my day blocked');
  // It does not need the lace after all.
  await page.goto(`/orders/${O1}/plan`);
  if (!(await editor.evaluate((el) => (el as HTMLDetailsElement).open)))
    await editor.locator('summary').first().click();
  await editor.getByLabel('Lace', { exact: true }).uncheck();
  await editor.getByRole('button', { name: 'Save what it waits for' }).click();
  await expect(editor.locator('.notice--success').last()).toBeVisible();
  // Saying what a task waits for changes the plan; she approves a fresh one, the same day as before.
  await approveFresh();
  await page.goto('/');
  await expect(page.locator('main')).not.toContainText('Something has changed');
  await expect.poll(async () => (await kept()).map((e) => e.id)).toEqual(today.map((e) => e.id));
  await expect(chip(i)).toHaveText('Ready');
});

test('she starts a task, then marks it done with the time it really took', async () => {
  const i = ready(0);
  const { title } = today[i]!;
  await entry(i)
    .getByRole('button', { name: `Start ${title}` })
    .click();
  await expect(chip(i)).toHaveText('Started');
  const done = await open(entry(i), 'Done');
  await done.getByLabel('hours').fill('2');
  await done.getByLabel('minutes').fill('30');
  await done.getByRole('button', { name: 'Mark as done' }).click();
  await expect(entry(i)).toContainText('took 2h 30m');
  await expect(chip(i)).toHaveText('Done');
  expect(await taskStatus(today[i]!.id)).toBe('done');
});

test('progress does not make the approved plan out of date', async () => {
  await page.reload();
  expect(await text(page)).not.toContain('Something has changed');
});

test('a task still going keeps about how long is left', async () => {
  const i = ready(1);
  const going = await open(entry(i), 'Still going');
  await going.getByLabel('hours').fill('1');
  await going.getByLabel('minutes').fill('');
  await going.getByRole('button', { name: 'Save what is left' }).click();
  await expect(entry(i)).toContainText('about 1h 00m left');
  await expect(chip(i)).toHaveText('Started');
});

test('a done form with no time is refused where she typed', async () => {
  const i = ready(1);
  const done = await open(entry(i), 'Done');
  await done.getByLabel('hours').fill('');
  await done.getByLabel('minutes').fill('');
  await done.getByRole('button', { name: 'Mark as done' }).click();
  await expect(done.locator('.error')).toContainText('how long it took');
  await settled(page);
  await page.reload();
});

const plannedMinutes = (t: string) => {
  const m = /(?:(\d+)h (\d+)m|(\d+) min) planned/.exec(t);
  return m ? (m[3] ? Number(m[3]) : Number(m[1]) * 60 + Number(m[2])) : Number.NaN;
};

test('a task on hold is not counted, and the approved plan says it is out of date', async () => {
  const i = ready(1);
  const before = plannedMinutes(await text(page));
  const hold = await open(entry(i), 'Hold');
  await hold.getByLabel('Why is it on hold?').fill('Client asked to wait');
  await hold.getByRole('button', { name: 'Put on hold' }).click();
  await expect(chip(i)).toHaveText('On hold');
  const t = await text(page);
  expect(t).toContain('Client asked to wait');
  await expect(entry(i)).toContainText('not counted today');
  expect(plannedMinutes(t)).toBeLessThan(before);
  expect(t).toContain('Something has changed since plan');
  await entry(i)
    .getByRole('button', { name: `Release ${today[i]!.title}` })
    .click();
  await expect(chip(i)).toHaveText('Started');
});

test('Quick Add: studio work waits for a day, and can be removed', async () => {
  await page.goto('/');
  for (const [title, minutes] of [
    ['Sharpen the shears', '20'],
    ['Walk-in hem', '45'],
  ] as const) {
    await open(page.locator('main'), 'Quick add');
    await page.locator('#quick-title').fill(title);
    await page.locator('#quick-estimate-minutes').fill(minutes);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByText(`${title} added.`).waitFor();
    await settled(page);
  }
  expect(await text(page)).toMatch(/2 quick-added items waiting for a day/i);
  const shears = page.locator('main li.item').filter({ hasText: 'Sharpen the shears' });
  await shears.getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('button', { name: 'Yes, remove' }).click();
  await page.getByText(/1 quick-added item waiting for a day/i).waitFor();
  await inspect(page, 'my day after work');
});

test('a proposal made before work was marked cannot be approved', async () => {
  await page.goto(`/orders/${O1}/plan`);
  await page.getByRole('button', { name: /Make (a|a new) proposal/ }).click();
  await page.waitForURL(/\/plan\/\d+\?order=/);
  // Meanwhile, on her phone, she marks the task still going as done.
  const phone = await ctx.newPage();
  await phone.goto('/');
  const i = ready(1);
  const done = await open(phone.locator('main li.item').nth(i), 'Done');
  await done.getByLabel('hours').fill('1');
  await done.getByRole('button', { name: 'Mark as done' }).click();
  await expect(phone.locator('main li.item').nth(i)).toContainText('took 1h');
  await phone.close();
  await page.getByRole('button', { name: /^Approve/ }).click();
  await expect(page.locator('.notice--error')).toContainText('Work was marked since this proposal was made');
});

test('finishing the day: the review asks about what is open, then plans tomorrow', async () => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Finish the day' }).last().click();
  await page.waitForURL(`${env.baseURL}/today/review`);
  const t = await text(page);
  expect(t).toContain('How did today go?');
  expect(t).toContain('Done today:');
  await inspect(page, 'review');
  const first = page.locator('main li.item').first();
  const going = first.locator('details', { has: page.locator('summary', { hasText: /^Still going/ }) });
  if (await going.count()) {
    await going.locator('summary').click();
    await going.getByLabel('hours').fill('2');
    await going.getByRole('button', { name: 'Save what is left' }).click();
    await first.getByText('about 2h 00m left').waitFor();
  }
  await page.getByRole('button', { name: 'Make tomorrow’s proposal' }).click();
  await page.waitForURL(/\/plan\/\d+$/);
  expect(await text(page)).toContain('Review the proposed plan');
  await page.getByRole('button', { name: /^Approve/ }).click();
  await page.locator('.title-row .chip', { hasText: 'Approved' }).waitFor();
});

test('the walk-in hem has a day in the new plan, and the order shows the actual time', async () => {
  await page.goto('/');
  expect(await text(page)).not.toMatch(/quick-added item/i);
  await page.goto(`/orders/${O1}/plan`);
  expect(await text(page)).toMatch(/took 2h 30m \(estimate/);
  await page.goto(`/orders/${O1}/history`);
  expect(await text(page)).toMatch(/Done: .*, in 2h 30m \(estimate/);
});

test('desktop and night: every My Day screen', async ({ browser }) => {
  for (const look of ['desktop', 'phone-night'] as const) {
    const c = await signedInContext(browser, look);
    const p = await c.newPage();
    const seen = watchErrors(p);
    for (const path of ['/', '/today/review', `/orders/${O1}/plan`]) {
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
