import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { fillNewJob, inspect, item, open, settled, signedInContext, text, watchErrors } from './support/app';
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
  // The work comes first, the step under it (her Task 7).
  const fix = item(section('Today'), 'Fix', 'Yonas Alemu · Suit alteration');
  await expect(fix.locator('.item__step')).toHaveText('Fix');
  await expect(fix).toContainText('#3');
  // The fix is delivered in two days: under that day, not today.
  await expect(item(page, 'Delivery').first()).toBeVisible();
  await expect(item(section('Today'), 'Delivery')).toHaveCount(0);
  await inspect(page, 'today');
});

test('she ticks a step done, it tells the job’s history, and she can open it again', async () => {
  await page.getByRole('button', { name: 'Mark Fix, Yonas Alemu · Suit alteration as done' }).click();
  await page
    .getByRole('button', { name: 'Fix, Yonas Alemu · Suit alteration: done. Mark as not done' })
    .waitFor();
  expect(
    await value(`select done_on::text from public.task where order_id = $1 and title = 'Fix'`, [ids.o3]),
  ).toBe(today());
  await page.goto(`/orders/${ids.o3}/history`);
  expect(await has('Done: Fix')).toBe(true);
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Fix, Yonas Alemu · Suit alteration: done. Mark as not done' })
    .click();
  await page.getByRole('button', { name: 'Mark Fix, Yonas Alemu · Suit alteration as done' }).waitFor();
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
  await expect(own).toContainText('10:00–10:30 AM');
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

test('an appointment is a step at a time on its day; a time already taken is refused, by name', async () => {
  await fillNewJob(page, {
    client: 'Selam Bekele',
    title: 'Wedding guest dress',
    due: inDays(20),
    steps: [{ title: 'Appointment', day: today(), from: '10:15', to: '11:00' }],
  });
  await page.getByRole('button', { name: 'Save the job' }).click();
  // 10:00 to 10:30 is already hers: sharpening the shears.
  const error = page.locator('#step-0-from-error');
  await expect(error).toContainText('10:00–10:30 AM on ');
  await expect(error).toContainText('is taken by “Sharpen the shears” (your own).');
  await expect(page.getByLabel('For', { exact: true })).toHaveValue(/[0-9a-f-]{36}/);
  await expect(page.getByLabel('What it is (optional)')).toHaveValue('Wedding guest dress');
  await settled(page);
  // Right after it is free: the end of one is the start of the next.
  await page.locator('.step-row').getByLabel('From (optional)').fill('10:30');
  await page.getByRole('button', { name: 'Save the job' }).click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
  ids.o4 = /\/orders\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  await expect(page.locator('h1')).toHaveText('Selam Bekele · Wedding guest dress');
  await expect(page.locator('.lede')).toContainText('#4');
  await page.goto('/');
  const appointment = item(section('Today'), 'Appointment', 'Selam Bekele · Wedding guest dress');
  await expect(appointment.locator('.item__time')).toHaveText('10:30–11:00 AM');
  await expect(page.getByText('Its time crosses another step’s.')).toHaveCount(0);
  // Timed steps come first, in time order; each headed by its work.
  const titles = await section('Today').locator('.item__title').allInnerTexts();
  expect(titles.slice(0, 2)).toEqual(['Sharpen the shears', 'Selam Bekele · Wedding guest dress']);
  await inspect(page, 'today with timed steps');
});

test('a step’s time already taken is refused there too', async () => {
  const form = await open(section('Today'), 'Add something for yourself');
  await form.getByLabel('Step').fill('Call the lace supplier');
  await form.getByLabel('From (optional)').fill('10:45');
  await form.getByRole('button', { name: 'Add' }).click();
  await expect(form.locator('#own-from-error')).toContainText(
    'is taken by “Appointment” (Selam Bekele · Wedding guest dress, #4).',
  );
  await settled(page);
  await form.getByLabel('From (optional)').fill('11:00');
  await form.getByRole('button', { name: 'Add' }).click();
  await expect(item(page, 'Call the lace supplier')).toContainText('11:00 AM');
});

test('a step whose day has passed waits under “Not done yet”, and its job says so', async () => {
  await page.goto(`/orders/${ids.o1}`);
  const step = item(page, 'Sketch');
  const form = await open(step, 'Change');
  await form.getByLabel('Day', { exact: true }).fill(inDays(-2));
  await form.getByRole('button', { name: 'Save the step' }).click();
  await form.locator('.notice--success').waitFor();
  await expect(page.locator('.card--warn')).toContainText('“Sketch” was due and is not done.');
  await page.goto('/');
  await expect(item(section('Not done yet'), 'Sketch', 'Selam Bekele · Bridal gown')).toContainText(
    'not done yet',
  );
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
  const fitting = await stepDay(ids.o1!, 'Fitting');
  expect(fitting).toBe(inDays(32));
  await page.goto(`/orders/${ids.o1}`);
  // Done steps stay where they were.
  await page.getByRole('button', { name: 'Mark Beading as done' }).click();
  await page.getByRole('button', { name: 'Beading: done. Mark as not done' }).waitFor();
  await page.getByLabel('Delivery day').fill(inDays(67));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  // Seven: the eight steps with a day, less Beading, done. Lace work has no day and stays without one.
  await expect(page.locator('.notice--success').last()).toHaveText(/^Saved\. 7 steps moved with the day\.$/);
  expect(await stepDay(ids.o1!, 'Fitting')).toBe(inDays(39));
  expect(await stepDay(ids.o1!, 'Delivery')).toBe(inDays(67));
  expect(await stepDay(ids.o1!, 'Sketch')).toBe(inDays(5));
  expect(await stepDay(ids.o1!, 'Beading')).toBe(today());
  expect(await stepDay(ids.o1!, 'Lace work')).toBe('');
});

test('the same step twice on the same day of a job is refused: she changes the one there is', async () => {
  const form = await open(page.locator('main'), 'Add a step');
  await form.getByLabel('Step').fill('Fitting');
  await form.getByLabel('Day', { exact: true }).fill(inDays(39));
  await form.getByRole('button', { name: 'Add' }).click();
  await expect(form).toContainText('This job already has “Fitting” on that day. Change that one instead.');
  expect(
    await value(`select count(*)::text from public.task where order_id = $1 and title = 'Fitting'`, [ids.o1]),
  ).toBe('1');
  await settled(page);
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

test('a job taken with no steps gets the steps of a list afterwards', async () => {
  await fillNewJob(page, { client: 'Hanna Tesfaye', title: 'Party dress', due: inDays(10) });
  await page.getByRole('button', { name: 'Save the job' }).click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
  expect(await has('No steps yet.')).toBe(true);
  // With no steps yet, the lists are offered at once.
  // Each list shows its steps, so she knows what she adds.
  await page
    .getByLabel('List')
    .selectOption({ label: 'Dress: Buy fabric, Cutting, Sewing, Fitting, Finishing and pressing, Delivery' });
  await page.getByRole('button', { name: 'Add these steps' }).click();
  // The steps take the place of the empty card, with no days: she gives each its own.
  await expect(page.locator('li.item .item__title')).toHaveText([
    'Buy fabric',
    'Cutting',
    'Sewing',
    'Fitting',
    'Finishing and pressing',
    'Delivery',
  ]);
  expect(await has('No steps yet.')).toBe(false);
});

test('library: she makes a list of her own, puts it in order, and a new job takes it in one tap', async () => {
  await page.goto('/library');
  await inspect(page, 'library');
  await page.goto('/library/new');
  await page.getByLabel('Name').fill('Habesha kemis');
  await page.getByRole('button', { name: 'Create the list' }).click();
  await page.waitForURL(/\/library\/[0-9a-f-]{36}$/);
  for (const title of ['Delivery', 'Weave the tibeb']) {
    await page.getByLabel('Add a step').fill(title);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await item(page, title).waitFor();
    // Emptied once added. (The first step's ↑ stays disabled, so the page is never “settled”.)
    await expect(page.getByLabel('Add a step')).toHaveValue('');
  }
  await page.getByRole('button', { name: 'Move Weave the tibeb earlier' }).click();
  await expect(page.locator('li.item .item__title')).toHaveText(['Weave the tibeb', 'Delivery']);
  await inspect(page, 'list');

  await page.goto('/orders/new');
  await page.getByLabel('Or all the steps of a list').selectOption({ label: 'Habesha kemis (2 steps)' });
  await page.getByRole('button', { name: 'Add them' }).click();
  const rows = page.locator('.step-row').getByRole('combobox');
  await expect(rows).toHaveCount(2);
  expect(await rows.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toEqual([
    'Weave the tibeb',
    'Delivery',
  ]);
});

test('an event, such as a bazaar or a show, is its name and its day, counted down on Today however far', async () => {
  await page.goto('/');
  await page.getByRole('link', { name: 'New event' }).click();
  await page.waitForURL(/\/orders\/new\?event=1$/);
  await expect(page.locator('h1')).toHaveText('New event');
  await expect(page.getByLabel('For', { exact: true })).toHaveValue('none');
  // None of a client's job: no brief, no tailoring steps, no lists.
  await expect(page.getByLabel('Design brief (optional)')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Your usual steps' })).toHaveCount(0);
  await expect(page.getByLabel('Or all the steps of a list')).toHaveCount(0);
  await page.getByLabel('Name of the event').fill('Fashion show at the Sheraton');
  await page.getByLabel('Event day').fill(inDays(70));
  await expect(page.getByText('That is 70 days left.')).toBeVisible();
  await page.getByRole('button', { name: 'Save the event' }).click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
  await expect(page.locator('h1')).toHaveText('Fashion show at the Sheraton');
  await expect(page.locator('.lede')).toContainText('70 days left');
  await expect(page.getByRole('navigation', { name: 'This event' }).getByRole('link')).toHaveText([
    'To prepare',
    'History',
  ]);
  await inspect(page, 'event');
  // What she prepares, if she wants it on her calendar: on its days.
  const form = await open(page.locator('main'), 'Add something to prepare');
  await form.getByLabel('Step').fill('Sew twenty pieces');
  await form.getByLabel('Day', { exact: true }).fill(inDays(1));
  await form.getByLabel('Last day (optional)').fill(inDays(30));
  await form.getByRole('button', { name: 'Add' }).click();
  await item(page, 'Sew twenty pieces').waitFor();
  await page.goto('/');
  // More than 30 days away, still in sight: an event needs her attention long before.
  const coming = section('Coming up');
  await expect(coming).toContainText('Fashion show at the Sheraton');
  await expect(coming).toContainText('70 days left');
  await expect(item(section('Tomorrow'), 'Sew twenty pieces', 'Fashion show at the Sheraton')).toBeVisible();
  await inspect(page, 'today with an event coming up');
});

test('a step she typed once is not offered as a usual one', async () => {
  await page.goto('/orders/new');
  const usual = page.getByRole('group', { name: 'Your usual steps' });
  for (const once of ['Sew twenty pieces', 'Beading', 'Lace work'])
    await expect(usual.getByRole('button', { name: `+ ${once}` })).toHaveCount(0);
  await expect(usual.getByRole('button', { name: '+ Fitting', exact: true })).toBeVisible();
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

test('the month marks the days jobs and events are due, steps or none, and lists them on the day', async () => {
  // The fashion show, 70 days ahead, has its own day marked though its only step is weeks earlier.
  const show = inDays(70);
  await page.goto(`/calendar?day=${show}`);
  const cell = page.locator(`a[href$="day=${show}"]`);
  await expect(cell.locator('.month__mark--event')).toHaveText('Event');
  await expect(cell).toHaveClass(/month__day--busy/);
  await expect(cell.locator('.sr-only')).toContainText('1 event');
  const due = page.getByRole('list', { name: 'Due this day' });
  await expect(due).toContainText('Fashion show at the Sheraton');
  await expect(due).toContainText('Event · #');
  // The party dress, whose steps have no days yet, is still marked on its delivery day.
  const party = inDays(10);
  await page.goto(`/calendar?day=${party}`);
  await expect(page.locator(`a[href$="day=${party}"] .month__mark`).first()).toHaveText('Due');
  await expect(page.getByRole('list', { name: 'Due this day' })).toContainText('Hanna Tesfaye · Party dress');
  await expect(page.getByRole('list', { name: 'Due this day' })).toContainText('Delivery');
  // The suit alteration has its Delivery step on its day: listed once, by that step, not again as due.
  const fix = inDays(2);
  await page.goto(`/calendar?day=${fix}`);
  await expect(page.locator(`a[href$="day=${fix}"] .month__mark`).first()).toHaveText('Due');
  await expect(item(page, 'Delivery', 'Yonas Alemu · Suit alteration')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Due this day' })).toHaveCount(0);
  await inspect(page, 'month with due days');
});

test('desktop, and a phone in dark mode: every calendar screen', async ({ browser }) => {
  const template = await value(
    `select t.id from public.template t join auth.users u on u.id = t.owner_id where u.email = $1 and t.name = 'Dress'`,
    [env.email],
  );
  const screens = ['/', '/calendar', '/library', `/library/${template}`, '/orders/new', `/orders/${ids.o4}`];
  for (const look of ['desktop', 'phone-dark'] as const) {
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
