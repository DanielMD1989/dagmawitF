import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  addSteps,
  listedNames,
  work,
  fillNewJob,
  inspect,
  item,
  open,
  ready,
  settled,
  signedInContext,
  text,
  watchErrors,
} from './support/app';
import { orderId, value } from './support/db';
import { env, inDays, today } from './support/env';

// Her calendar (docs/calendar-first.md): Today and the days ahead, ticking steps done, her own work, appointments
// and their times, what is overdue, steps over several days, moving a job's day, events, and the month. Runs on
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

test('Today lists today’s steps with their orders, then the days ahead that have any', async () => {
  await page.goto('/');
  // The work comes first, its steps of the day under it (her Task 7; decision 0098).
  const card = work(section('Today'), 'Yonas Alemu · Suit alteration');
  await expect(card.locator('.item__title--step')).toHaveText(['Fix']);
  await expect(card.locator('.work__head')).toContainText('#3');
  // The fix is delivered in two days: under that day, not today.
  await expect(item(page, 'Delivery').first()).toBeVisible();
  await expect(item(section('Today'), 'Delivery')).toHaveCount(0);
  await inspect(page, 'today');
});

test('she ticks a step done, it tells the order’s history, and she can open it again', async () => {
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
    steps: [{ title: 'Appointment', day: today(), from: '10:15' }],
  });
  await page.getByRole('button', { name: 'Save the order' }).click();
  // 10:00 to 10:30 is already hers: sharpening the shears.
  const error = page.locator('#step-0-from-error');
  await expect(error).toContainText('10:00–10:30 AM on ');
  await expect(error).toContainText('is taken by “Sharpen the shears” (your own).');
  await expect(page.getByLabel('For', { exact: true })).toHaveValue(/[0-9a-f-]{36}/);
  await expect(page.getByLabel('What it is (optional)')).toHaveValue('Wedding guest dress');
  await settled(page);
  // Right after it is free: the end of one is the start of the next.
  await page.locator('.step-row').getByLabel('Time (optional)').fill('10:30');
  await page.getByRole('button', { name: 'Save the order' }).click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
  ids.o4 = /\/orders\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  await expect(page.locator('h1')).toHaveText('Selam Bekele · Wedding guest dress');
  await expect(page.locator('.lede')).toContainText('#4');
  await page.goto('/');
  const appointment = item(section('Today'), 'Appointment', 'Selam Bekele · Wedding guest dress');
  await expect(appointment.locator('.item__time')).toHaveText('10:30 AM');
  await expect(page.getByText('Its time crosses another step’s.')).toHaveCount(0);
  // Timed steps come first, in time order; an order shown once, by its name (decision 0098).
  const names = await listedNames(section('Today'));
  expect(names.slice(0, 2)).toEqual(['Sharpen the shears', 'Selam Bekele · Wedding guest dress']);
  await inspect(page, 'today with timed steps');
});

test('a step’s time already taken is refused there too', async () => {
  const form = await open(section('Today'), 'Add something for yourself');
  await form.getByLabel('Step').fill('Call the lace supplier');
  // The appointment is at 10:30.
  await form.getByLabel('From (optional)').fill('10:30');
  await form.getByRole('button', { name: 'Add' }).click();
  await expect(form.locator('#own-from-error')).toContainText(
    'is taken by “Appointment” (Selam Bekele · Wedding guest dress, #4).',
  );
  await settled(page);
  await form.getByLabel('From (optional)').fill('11:00');
  await form.getByRole('button', { name: 'Add' }).click();
  await expect(item(page, 'Call the lace supplier')).toContainText('11:00 AM');
});

test('a step not done on its day moves to today, and says the day it was for', async () => {
  await page.goto(`/orders/${ids.o1}`);
  const step = item(page, 'Sketch');
  const form = await open(step, 'Change');
  await form.getByLabel('Day', { exact: true }).fill(inDays(-2));
  await form.getByRole('button', { name: 'Save the step' }).click();
  await form.locator('.notice--success').waitFor();
  // The next morning, so to speak: opening the app moves it to today (decision 0080).
  await page.goto('/');
  const moved = item(section('Today'), 'Sketch', 'Selam Bekele · Bridal gown');
  await expect(moved.locator('.item__note--moved')).toContainText('Moved from ');
  expect(await stepDay(ids.o1!, 'Sketch')).toBe(today());
  expect(
    await value(`select moved_from::text from public.task where order_id = $1 and title = 'Sketch'`, [
      ids.o1,
    ]),
  ).toBe(inDays(-2));
  await expect(section('Not done yet')).toHaveCount(0);
  // Its job no longer calls it late, and still says where it came from.
  await page.goto(`/orders/${ids.o1}`);
  await expect(page.getByText('“Sketch” was due and is not done.')).toHaveCount(0);
  await expect(item(page, 'Sketch')).toContainText('Moved from ');
});

test('a step over several days shows on each of them', async () => {
  await page.goto(`/orders/${ids.o1}`);
  // Added with the step buttons on its day; its last day is given when she changes it.
  await addSteps(page, [{ title: 'Beading', day: today() }]);
  await settled(page);
  const beading = item(page, 'Beading');
  const change = await open(beading, 'Change');
  await change.getByLabel('Last day (optional)').fill(inDays(2));
  await change.getByRole('button', { name: 'Save the step' }).click();
  await change.locator('.notice--success').waitFor();
  await expect(item(page, 'Beading')).toContainText('–');
  await page.goto('/');
  await expect(item(section('Today'), 'Beading')).toContainText('Day 1 of 3');
  await expect(item(section('Tomorrow'), 'Beading')).toContainText('Day 2 of 3');
});

test('moving an order’s day moves its steps not done yet by as many days', async () => {
  const fitting = await stepDay(ids.o1!, 'Fitting');
  expect(fitting).toBe(inDays(32));
  await page.goto(`/orders/${ids.o1}`);
  // Done steps stay where they were.
  await page.getByRole('button', { name: 'Mark Beading as done' }).click();
  await page.getByRole('button', { name: 'Beading: done. Mark as not done' }).waitFor();
  await open(page.locator('main'), 'Change the order details');
  await page.getByLabel('Delivery day').fill(inDays(67));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  // Seven: the eight steps with a day, less Beading, done. Lace work has no day and stays without one.
  // Its Delivery moves with the day by itself (decision 0096); the other steps by as many days.
  await expect(page.locator('.notice--success').last()).toHaveText(/^Saved\. 6 steps moved with the day\.$/);
  expect(await stepDay(ids.o1!, 'Fitting')).toBe(inDays(39));
  expect(await stepDay(ids.o1!, 'Delivery')).toBe(inDays(67));
  expect(await stepDay(ids.o1!, 'Sketch')).toBe(inDays(7));
  expect(await stepDay(ids.o1!, 'Beading')).toBe(today());
  expect(await stepDay(ids.o1!, 'Lace work')).toBe('');
});

test('the same step twice on the same day of an order is refused: she changes the one there is', async () => {
  const form = await addSteps(page, [{ title: 'Fitting', day: inDays(39) }], false);
  await expect(form).toContainText('This order already has “Fitting” on that day. Change that one instead.');
  // Her row stays as she left it, to change.
  await expect(form.locator('.step-row')).toHaveCount(1);
  expect(
    await value(`select count(*)::text from public.task where order_id = $1 and title = 'Fitting'`, [ids.o1]),
  ).toBe('1');
  await settled(page);
});

test('a step after the order’s day is pointed out', async () => {
  await page.goto(`/orders/${ids.o3}`);
  await addSteps(page, [{ title: 'Press', day: inDays(5) }]);
  await expect(page.locator('.card--warn')).toContainText('“Press” is after the order’s day.');
  await expect(item(page, 'Press')).toContainText('After the order’s day.');
  // Removed again.
  const press = item(page, 'Press');
  await open(press, 'Change');
  await press.getByRole('button', { name: 'Remove this step' }).click();
  await press.getByRole('button', { name: 'Yes, remove' }).click();
  await press.waitFor({ state: 'detached' });
});

test('an order taken with no steps gets its steps afterwards, each on its day', async () => {
  await fillNewJob(page, { client: 'Hanna Tesfaye', title: 'Party dress', due: inDays(10) });
  await page.getByRole('button', { name: 'Save the order' }).click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
  expect(await has('No steps yet.')).toBe(true);
  // The same step buttons as a new order, open by themselves (decision 0085): several at once, with a time if any.
  const form = page.getByRole('form', { name: 'Add steps' });
  await expect(form.getByRole('group', { name: 'Your usual steps' })).toBeVisible();
  await expect(form.getByRole('button', { name: '+ Delivery' })).toHaveCount(0);
  await inspect(page, 'order with no steps');
  await addSteps(page, [
    { title: 'Buy fabric', day: inDays(2) },
    { title: 'Sewing', day: inDays(5), from: '10:00' },
  ]);
  await expect(form.locator('.notice--success')).toHaveText('Added 2 steps.');
  // The builder is empty again, for more.
  await expect(page.locator('.step-row')).toHaveCount(0);
  const party = /\/orders\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  expect(await stepDay(party, 'Sewing')).toBe(inDays(5));
  await settled(page);
  // The steps take the place of the empty card.
  await expect(page.locator('li.item .item__title')).toHaveText(['Buy fabric', 'Sewing', 'Delivery']);
  expect(await has('No steps yet.')).toBe(false);
});

test('there is no Library: her steps are the same each time, so the step buttons are all there is', async () => {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link')).toHaveText([
    'Today',
    'Calendar',
    'Orders',
    'Clients',
    'Settings',
  ]);
  await page.goto('/orders/new');
  await expect(page.getByText('Or all the steps of a list')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Your usual steps' })).toBeVisible();
  await page.goto(`/orders/${ids.o1}`);
  await expect(page.getByText('Add the steps of a list')).toHaveCount(0);
  errors.allow(/status of 404/);
  expect((await page.goto('/library'))?.status()).toBe(404);
  errors.allow(null);
});

test('an event, such as a bazaar or a show, is its name and its day, counted down on Today however far', async () => {
  await page.goto('/');
  await page.getByRole('link', { name: 'New event' }).click();
  await page.waitForURL(/\/orders\/new\?event=1$/);
  await expect(page.locator('h1')).toHaveText('New event');
  // An event is for no customer: it is not asked which (decision 0084).
  await expect(page.getByLabel('For', { exact: true })).toHaveCount(0);
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
  await expect(item(section('Tomorrow'), 'Sew twenty pieces', 'Fashion show at the Sheraton')).toBeVisible();
  // What is ahead is on its own page, from Today's "Coming up": however far, counted down.
  await page.getByRole('link', { name: 'Coming up' }).click();
  await page.waitForURL(`${env.baseURL}/coming-up`);
  const later = section('Later');
  await expect(later).toContainText('Fashion show at the Sheraton');
  await expect(later).toContainText('70 days left');
  await expect(section('This week')).toContainText('Yonas Alemu · Suit alteration');
  await inspect(page, 'coming up');
});

test('an order due today shows once on Today: by its Delivery step', async () => {
  await fillNewJob(page, { client: 'Yonas Alemu', title: 'Hem trousers', due: today() });
  await page.getByRole('button', { name: 'Save the order' }).click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
  // Its Delivery is a step, on its day, with nothing added (decision 0096).
  await expect(page.locator('li.item .item__title')).toHaveText(['Delivery']);
  await page.goto('/');
  await expect(item(section('Today'), 'Delivery', 'Yonas Alemu · Hem trousers')).toBeVisible();
  // Not again as due today.
  await expect(page.locator('main')).not.toContainText('Due today');
  // Not on Coming up, which starts tomorrow.
  await page.goto('/coming-up');
  await expect(page.locator('main')).not.toContainText('Hem trousers');
});

test('a step she typed once is not offered as a usual one', async () => {
  await page.goto('/orders/new');
  const usual = page.getByRole('group', { name: 'Your usual steps' });
  for (const once of ['Sew twenty pieces', 'Beading', 'Lace work'])
    await expect(usual.getByRole('button', { name: `+ ${once}` })).toHaveCount(0);
  await expect(usual.getByRole('button', { name: '+ Fitting', exact: true })).toBeVisible();
});

test('the month: what each day holds, by name, and the list of the day she picks', async () => {
  await page.goto('/calendar');
  await inspect(page, 'month');
  const todayCell = page.locator('.month__day--today');
  await expect(todayCell).toHaveAttribute('aria-current', 'date');
  // By name (decision 0086): two labels on a phone, the rest counted; all of it said to a screen reader.
  await expect(todayCell.locator('.month__tag:visible')).toHaveCount(2);
  await expect(todayCell.locator('.month__more:visible')).toHaveText(/^\+\d+ more$/);
  await expect(todayCell.locator('.sr-only')).toContainText('Appointment · Selam Bekele');
  await expect(page.getByRole('list', { name: 'What the labels are' })).toContainText('Order due');
  await expect(
    section(new Date().toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Africa/Addis_Ababa' })),
  ).toContainText('Appointment');
  await page.getByRole('link', { name: 'Next month' }).click();
  await page.waitForURL(/month=\d{4}-\d{2}$/);
  await page.getByRole('link', { name: 'This month' }).click();
  await page.waitForURL(`${env.baseURL}/calendar`);
});

test('the month marks the days orders and events are due, and lists them on the day', async () => {
  // The fashion show, 70 days ahead, has its own day marked though its only step is weeks earlier.
  const show = inDays(70);
  await page.goto(`/calendar?day=${show}`);
  const cell = page.locator(`a[href$="day=${show}"]`);
  // By its name, not the word "Event" (decision 0084).
  await expect(cell.locator('.month__tag--event')).toHaveText('Fashion show at the Sheraton');
  await expect(cell.locator('.sr-only')).toContainText('Fashion show at the Sheraton');
  const due = page.getByRole('list', { name: 'Due this day' });
  await expect(due).toContainText('Fashion show at the Sheraton');
  await expect(due).toContainText('Event · #');
  // The party dress is marked on its delivery day, by the client's first name, and listed by its Delivery step
  // (decision 0096), which every customer order has.
  const party = inDays(10);
  await page.goto(`/calendar?day=${party}`);
  await expect(page.locator(`a[href$="day=${party}"] .month__tag--due`)).toHaveText(['Hanna']);
  await expect(item(page, 'Delivery', 'Hanna Tesfaye · Party dress')).toBeVisible();
  // The suit alteration has its Delivery step on its day: listed once, by that step, not again as due.
  const fix = inDays(2);
  await page.goto(`/calendar?day=${fix}`);
  const fixCell = page.locator(`a[href$="day=${fix}"]`);
  await expect(fixCell.locator('.month__tag--due')).toHaveText(['Yonas']);
  await expect(fixCell.locator('.month__tag--step', { hasText: 'Delivery' })).toHaveCount(0);
  await expect(item(page, 'Delivery', 'Yonas Alemu · Suit alteration')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Due this day' })).toHaveCount(0);
  await inspect(page, 'month with due days');
});

test('an order’s Delivery is a step with its day and time only, and no second one is added', async () => {
  await page.goto(`/orders/${ids.o1}`);
  await ready(page);
  const delivery = item(page, 'Delivery');
  const change = await open(delivery, 'Change');
  // Its name stays and it is not removed (decision 0096): its day is the delivery day.
  await expect(change.getByLabel('Step', { exact: true })).toHaveCount(0);
  await expect(change.getByLabel('Last day (optional)')).toHaveCount(0);
  await expect(change.getByLabel('Day', { exact: true })).toBeVisible();
  await expect(delivery.getByRole('button', { name: 'Remove this step' })).toHaveCount(0);
  // A day that has passed is refused, plainly.
  await change.getByLabel('Day', { exact: true }).fill(inDays(-1));
  await change.getByRole('button', { name: 'Save the step' }).click();
  await expect(change).toContainText('The delivery day cannot be in the past.');
  await page.reload();
  await ready(page);
  const form = await addSteps(page, [{ title: 'Delivery', day: inDays(30) }], false);
  await expect(form).toContainText('This order has its Delivery already.');
});

test('a step part done stays open, says what is left, and is on the history; a Delivery is done or not', async () => {
  await page.goto(`/orders/${ids.o1}`);
  await ready(page);
  const lace = item(page, 'Lace work');
  const form = await open(lace, 'Part done…');
  await inspect(page, 'part done form');
  await form.getByLabel('What is left (optional)').fill('Sleeves and hem');
  await form.getByRole('button', { name: 'Mark part done' }).click();
  // Not ticked: half filled, with what is left under it.
  await expect(lace.locator('.item__note--started')).toHaveText(/^Part done .+ · left: Sleeves and hem$/);
  await expect(lace.getByRole('button', { name: 'Mark Lace work as done' })).toHaveClass(/tick--started/);
  // She can change what is left.
  const again = await open(lace, 'Change what is left');
  await expect(again.getByLabel('What is left (optional)')).toHaveValue('Sleeves and hem');
  await again.getByLabel('What is left (optional)').fill('Hem');
  await again.getByRole('button', { name: 'Save' }).click();
  await expect(lace.locator('.item__note--started')).toHaveText(/ · left: Hem$/);
  expect(
    await value(
      `select coalesce(left_note, '') from public.task where order_id = $1 and title = 'Lace work'`,
      [ids.o1],
    ),
  ).toBe('Hem');
  // A Delivery is not offered it.
  await expect(item(page, 'Delivery').getByText('Part done…')).toHaveCount(0);
  await page.goto(`/orders/${ids.o1}/history`);
  expect(await text(page)).toContain('Part done: Lace work. Left: Hem.');
  await settled(page);
});

test('ticking an order’s Delivery finishes it: it leaves Active for History, and the tick stays on Today', async () => {
  const hem = await value(`select id::text from public.orders where title = 'Hem trousers'`);
  await page.goto('/orders');
  await ready(page);
  const active = page.getByRole('list', { name: 'Active orders' });
  await expect(active).toContainText('Yonas Alemu · Hem trousers');
  // An event is not an order (decision 0090).
  await expect(page.locator('main')).not.toContainText('Fashion show at the Sheraton');
  const before = Number(/Active \((\d+)\)/.exec(await text(page))![1]);

  await page.goto('/');
  // Ticking the Delivery asks the day it was delivered, today unless she says otherwise (decision 0101).
  const hemDelivery = item(section('Today'), 'Delivery', 'Yonas Alemu · Hem trousers');
  await hemDelivery
    .getByRole('button', { name: 'Mark Delivery, Yonas Alemu · Hem trousers as delivered' })
    .click();
  await expect(hemDelivery.getByLabel('Delivered on')).toHaveValue(today());
  await inspect(page, 'delivery asks its day');
  await hemDelivery.getByRole('button', { name: 'Delivered', exact: true }).click();
  // Still there, done, and no longer to be changed: the order is finished (decision 0089).
  const delivered = item(section('Today'), 'Delivery', 'Yonas Alemu · Hem trousers');
  await expect(delivered.getByRole('img', { name: 'Done' })).toBeVisible();
  expect(await value(`select status from public.orders where id = $1`, [hem])).toBe('delivered');

  await page.goto('/orders');
  await expect(page.getByRole('list', { name: 'Active orders' })).not.toContainText('Hem trousers');
  expect(await text(page)).toContain(`Active (${before - 1})`);
  await page.getByRole('link', { name: /^History \(\d+\)$/ }).click();
  await page.waitForURL(/tab=history/);
  const month = page.getByRole('region', {
    name: new Date().toLocaleDateString('en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'Africa/Addis_Ababa',
    }),
  });
  await expect(month.locator('.row-link', { hasText: 'Hem trousers' })).toContainText(
    /Delivered .+ · on time$/,
  );
  await inspect(page, 'order history');
  // Its page goes back to History.
  await month.getByRole('link', { name: /Hem trousers/ }).click();
  await expect(page.locator('.back-link')).toHaveText('← History');
  await expect(page.locator('.back-link')).toHaveAttribute('href', '/orders?tab=history');
});

test('a step ticked on Today says what comes next for its order, its delivery when nothing else is planned', async () => {
  await page.goto('/');
  const card = work(section('Today'), 'Yonas Alemu · Suit alteration');
  await expect(card.locator('.item__note--next')).toHaveCount(0);
  await card.getByRole('button', { name: 'Mark Fix, Yonas Alemu · Suit alteration as done' }).click();
  // Its only step left is its Delivery (decision 0094), on another day.
  await expect(card.locator('.item__note--next')).toHaveText(/^Next: Delivery, \w{3} \d{1,2} \w{3}/);
  await card.getByRole('button', { name: /Fix, Yonas Alemu · Suit alteration: done/ }).click();
  await expect(card.locator('.item__note--next')).toHaveCount(0);
});

test('an order with several steps on a day is shown once, its steps inside it', async () => {
  const id = await value(
    `select id::text from public.orders where title = 'Suit alteration' and status = 'active'`,
  );
  await page.goto(`/orders/${id}`);
  await ready(page);
  await addSteps(page, [{ title: 'Press', day: today() }]);
  await page.goto('/');
  const today_ = section('Today');
  // Once, not once a step (decision 0098).
  await expect(today_.locator('.work__title', { hasText: /^Yonas Alemu · Suit alteration$/ })).toHaveCount(1);
  const card = work(today_, 'Yonas Alemu · Suit alteration');
  await expect(card.locator('.item__title--step')).toHaveText(['Fix', 'Press']);
  // One done, one not: no "Next" yet.
  await card.getByRole('button', { name: 'Mark Fix, Yonas Alemu · Suit alteration as done' }).click();
  await expect(card.getByRole('button', { name: /Fix, Yonas Alemu · Suit alteration: done/ })).toBeVisible();
  await expect(card.locator('.item__note--next')).toHaveCount(0);
  await inspect(page, 'today, an order with two steps');
  // Back as it was for the tests after.
  await card.getByRole('button', { name: /Fix, Yonas Alemu · Suit alteration: done/ }).click();
  await page.goto(`/orders/${id}`);
  const press = item(page, 'Press');
  await (await open(press, 'Change')).getByRole('button', { name: 'Remove this step' }).click();
  await page.getByRole('button', { name: 'Yes, remove' }).click();
  await expect(item(page, 'Press')).toHaveCount(0);
});

test('events have their own list, and Numbers counts the orders taken and delivered', async () => {
  await page.goto('/orders');
  await page.getByRole('link', { name: 'Events' }).click();
  await page.waitForURL(/\/events$/);
  const coming = page.getByRole('region', { name: 'Coming' });
  await expect(coming).toContainText('Fashion show at the Sheraton');
  await expect(page.locator('main')).not.toContainText('Hem trousers');
  await inspect(page, 'events');
  await coming.getByRole('link', { name: /Fashion show/ }).click();
  await expect(page.locator('.back-link')).toHaveAttribute('href', '/events');

  await page.goto('/orders');
  await page.getByRole('link', { name: 'Numbers' }).click();
  await page.waitForURL(/\/numbers$/);
  const thisWeek = page.getByRole('region', { name: 'This week' });
  // Hem trousers was delivered today.
  const deliveredNow = Number(
    await thisWeek.locator('.stat', { hasText: 'Delivered' }).locator('.stat__value').innerText(),
  );
  expect(deliveredNow).toBeGreaterThanOrEqual(1);
  const taken = Number(
    await thisWeek.locator('.stat', { hasText: 'Orders taken' }).locator('.stat__value').innerText(),
  );
  expect(taken).toBeGreaterThanOrEqual(1);
  await open(page.locator('main'), 'See as a table');
  const rows = page.locator('table tbody tr');
  await expect(rows).toHaveCount(12);
  await expect(rows.first().locator('td').nth(1)).toHaveText(String(deliveredNow));
  await expect(page.getByRole('region', { name: /^Who orders most/ })).toContainText('Yonas Alemu');
  await inspect(page, 'numbers by week');
  await page.getByRole('link', { name: 'By month' }).click();
  await page.waitForURL(/by=month/);
  await expect(page.getByRole('region', { name: 'This month' })).toBeVisible();
  await inspect(page, 'numbers by month');
});

test('an order finished ahead of its day is delivered from its last step, and goes to History', async () => {
  const party = await value(`select id::text from public.orders where title = 'Party dress'`);
  await page.goto(`/orders/${party}`);
  await ready(page);
  await page.getByRole('button', { name: 'Mark Buy fabric as done' }).click();
  await expect(page.getByRole('button', { name: /^Buy fabric: done/ })).toBeVisible();
  // Its last step, on its day in the calendar, done today: its Delivery is all that is left (decision 0097).
  await page.goto(`/calendar?day=${inDays(5)}`);
  const party_ = work(page, 'Hanna Tesfaye · Party dress');
  await party_.getByRole('button', { name: /^Mark Sewing/ }).click();
  await expect(party_.locator('.item__note--next')).toHaveText(/^Next: Delivery, \w{3} \d{1,2} \w{3}$/);
  // The Orders list offers it too.
  await page.goto('/orders');
  await expect(page.getByLabel('Delivered: Hanna Tesfaye · Party dress')).toBeVisible();
  await inspect(page, 'orders, ready to deliver');
  await page.goto(`/calendar?day=${inDays(5)}`);
  const card = work(page, 'Hanna Tesfaye · Party dress');
  // It asks the day it was handed over (decision 0101): not a day still to come.
  await card.getByLabel('Delivered: Hanna Tesfaye · Party dress').click();
  const deliveredOn = card.getByLabel('Delivered on');
  await expect(deliveredOn).toHaveValue(today());
  await deliveredOn.fill(inDays(1));
  await card.getByRole('button', { name: 'Delivered', exact: true }).click();
  await expect(card.locator('#now-' + party + '-delivered-on-error')).toHaveText(
    'An order cannot be delivered on a day that has not come yet.',
  );
  await expect(deliveredOn).toBeFocused();
  await settled(page);
  // She handed it over two days ago, and only records it now.
  await deliveredOn.fill(inDays(-2));
  await card.getByRole('button', { name: 'Delivered', exact: true }).click();
  await expect
    .poll(() =>
      value(
        `select status || ' ' || (delivered_on = app.today_for(owner_id) - 2)::text from public.orders where id = $1`,
        [party],
      ),
    )
    .toBe('delivered true');
  // Its Delivery step is done that day too.
  expect(
    await value(
      `select (done_on = delivered_on)::text from public.task t join public.orders o on o.id = t.order_id
                 where o.id = $1 and t.title = 'Delivery'`,
      [party],
    ),
  ).toBe('true');
  await page.goto('/orders?tab=history');
  await expect(page.locator('.row-link', { hasText: 'Party dress' })).toContainText(/· 12 days early$/);
});

test('desktop, and a phone in dark mode: every calendar screen', async ({ browser }) => {
  const screens = [
    '/',
    '/calendar',
    '/clients',
    '/orders/new',
    `/orders/${ids.o4}`,
    '/orders?tab=history',
    '/events',
    '/numbers',
  ];
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
