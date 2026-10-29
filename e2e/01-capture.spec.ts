import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { inspect, item, open, settled, signedInContext, text, watchErrors } from './support/app';
import { sql, value } from './support/db';
import { env, inDays, today } from './support/env';
import { bigSketch, noise, notAPicture, smallSwatch } from './support/pictures';

// Stage 2 (docs/capture.md): her week, then three orders with their clients, garments, pictures, preparation and
// measurements, status moves and history. Everything is typed into the screens, as she would.

test.describe.configure({ mode: 'serial' });

let ctx: BrowserContext;
let page: Page;
let errors: ReturnType<typeof watchErrors>;
const ids: Record<string, string> = {};
const orderOfUrl = () => /\/orders\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';
const has = async (words: string) => (await text(page)).includes(words);
const pic = (name: string) =>
  page.locator('.photo').filter({ has: page.locator('.photo__name', { hasText: new RegExp(`^${name}$`) }) });
const openAdd = async () => {
  const d = page.locator('details', { hasText: 'Add something else' }).first();
  if (!(await d.evaluate((el) => (el as HTMLDetailsElement).open))) await d.locator('summary').click();
};
/** Her stored pictures, as storage records them. */
const stored = () =>
  sql<{ name: string; size: number; mimetype: string }>(
    `select o.name, (o.metadata->>'size')::int as size, o.metadata->>'mimetype' as mimetype
     from storage.objects o join auth.users u on o.name like u.id::text || '/%'
     where o.bucket_id = 'order-files' and u.email = $1 order by o.created_at`,
    [env.email],
  );

test.beforeAll(async ({ browser }) => {
  ctx = await signedInContext(browser);
  page = await ctx.newPage();
  errors = watchErrors(page);
});
test.afterAll(async () => ctx.close());

// ---------------------------------------------------------------- her week
test('a new account asks for her working week first', async () => {
  await page.goto('/');
  await expect(page.getByText('Her working week is not set yet.')).toBeVisible();
});

test('she sets her working week: every day, nine to five with an hour for lunch', async () => {
  // Every day, so that whatever day the suite runs on, today has work planned.
  await page.goto('/settings');
  for (let day = 1; day <= 7; day++) {
    const works = page.locator(`input[name="works-${day}"]`);
    if (!(await works.isChecked())) await works.check();
    await page.locator(`#start-${day}`).fill('09:00');
    await page.locator(`#end-${day}`).fill('17:00');
    await page.locator(`#break-start-${day}`).fill('12:30');
    await page.locator(`#break-end-${day}`).fill('13:30');
  }
  await page.getByRole('button', { name: 'Save working week' }).click();
  await expect(page.locator('.notice--success').first()).toBeVisible();
  await page.goto('/');
  await expect(page.getByText('Her working week is not set yet.')).toHaveCount(0);
  await expect(page.locator('main')).toContainText('of 4h 54m usable');
});

// ---------------------------------------------------------------- order 1: a bridal gown, new client
test('the orders list starts empty and says what to do', async () => {
  await page.goto('/orders');
  expect(await has('No orders')).toBe(true);
});

test('a refused form keeps what she typed and says what is missing', async () => {
  await page.goto('/orders/new');
  await page.getByLabel("Client's name").fill('Selam Bekele');
  await page.getByLabel('Design brief (optional)').fill('Ivory lace, long sleeves, boat neckline');
  await page.getByRole('button', { name: 'Confirm order' }).click();
  await page.locator('.error').first().waitFor();
  await expect(page.getByLabel("Client's name")).toHaveValue('Selam Bekele');
  await expect(page.getByLabel('Design brief (optional)')).toHaveValue(/^Ivory/);
  const errs = await page.locator('.error').allInnerTexts();
  expect(errs.some((e) => /being made/i.test(e)) && errs.some((e) => /day/i.test(e)), errs.join(' | ')).toBe(
    true,
  );
  await inspect(page, 'new order refused');
});

test('she confirms order 1 and lands on what it is waiting for', async () => {
  await page.getByLabel('Garment', { exact: true }).fill('Bridal gown');
  await page.getByLabel('Handover day').fill(inDays(30));
  await page.getByLabel('Notes (optional)').fill('Pays in two parts. Mother collects.');
  await page.getByLabel('Phone (optional)').fill('0911 22 33 44');
  await page.getByRole('button', { name: 'Confirm order' }).click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}\/preparation/);
  ids.o1 = orderOfUrl();
  await expect(page.locator('h1')).toContainText('#1');
  await expect(page.locator('.chip').first()).toHaveText('Active');
  await inspect(page, 'preparation empty');
});

test('preparation: quick-add suggestions add items that hold work back', async () => {
  for (const label of ['Measurements taken', 'Design approved by client', 'Lace', 'Main fabric']) {
    await page.getByRole('button', { name: `+ ${label}` }).click();
    await item(page, label).waitFor();
  }
  const t = await text(page);
  expect(t).toContain('0 of 4 ready');
  expect(t).toContain('4 blocking items have no expected date');
  await expect(page.getByRole('button', { name: '+ Lace' })).toHaveCount(0);
  await inspect(page, 'preparation with 4 items');
});

test('preparation: lace is ordered with a date; the fabric is received', async () => {
  const lace = item(page, 'Lace');
  await open(lace, 'Update');
  await lace.getByLabel('Where it stands').selectOption('ordered');
  await lace.getByLabel('Expected to arrive').fill(inDays(4));
  await lace.getByRole('button', { name: 'Save', exact: true }).click();
  await lace.locator('.notice--success').waitFor();
  const fabric = item(page, 'Main fabric');
  await open(fabric, 'Update');
  await fabric.getByLabel('Where it stands').selectOption('received');
  await fabric.getByRole('button', { name: 'Save', exact: true }).click();
  await fabric.locator('.notice--success').waitFor();
  const t = await text(page);
  expect(t).toContain('1 of 4 ready');
  expect(t).toContain('2 blocking items have no expected date');
  await expect(lace).toContainText('Ordered');
  await expect(fabric).toContainText('Received');
  // The choice she made stays chosen after the save.
  await expect(lace.getByLabel('Where it stands')).toHaveValue('ordered');
  await expect(lace.getByLabel('Expected to arrive')).toHaveValue(inDays(4));
  await expect(fabric.getByLabel('Where it stands')).toHaveValue('received');
  await inspect(page, 'preparation mixed');
});

test('preparation: an item with a date that has passed is flagged late', async () => {
  const design = item(page, 'Design approved by client');
  await open(design, 'Update');
  await design.getByLabel('Where it stands').selectOption('ordered');
  await design.getByLabel('Answer expected').fill(inDays(-9));
  await design.getByRole('button', { name: 'Save', exact: true }).click();
  await design.locator('.notice--success').waitFor();
  await expect(design).toContainText('That day has passed');
  expect(await text(page)).toContain('1 blocking item is late');
});

test('preparation: a custom item, edited, then removed', async () => {
  await openAdd();
  await page.getByLabel('What is it?').fill('Beading by the embroiderer');
  await page.getByRole('button', { name: 'Add to the list' }).click();
  await item(page, 'Beading by the embroiderer').waitFor();
  const beading = item(page, 'Beading by the embroiderer');
  await open(beading, 'Update');
  await beading.getByLabel('Name', { exact: true }).fill('Beading (embroiderer)');
  await beading.getByLabel('Work cannot start without it').uncheck();
  await beading.getByRole('button', { name: 'Save', exact: true }).click();
  const renamed = item(page, 'Beading (embroiderer)');
  await renamed.locator('.notice--success').waitFor();
  await expect(renamed).toContainText('Reminder');
  await renamed.getByRole('button', { name: 'Remove from the list' }).click();
  await page.getByRole('button', { name: 'Yes, remove' }).click();
  await renamed.waitFor({ state: 'detached' });
});

test('preparation: an empty name is refused where she typed it', async () => {
  await openAdd();
  await page.getByRole('button', { name: 'Add to the list' }).click();
  await expect(page.locator('#add-item-label-error')).toContainText('Say what it is');
  await expect(page.getByLabel('What is it?')).toHaveAttribute('aria-invalid', 'true');
});

// ---------------------------------------------------------------- order 1: the brief
const goBrief = () => page.goto(`/orders/${ids.o1}`);

test('brief: a second garment on the same order', async () => {
  await goBrief();
  await page.getByText('Add another garment').click();
  await page.locator('#add-garment-type').fill('Bridesmaid dress');
  await page.locator('#add-garment-brief').fill('Sage green chiffon, knee length');
  await page.getByRole('button', { name: 'Add garment' }).click();
  await page.getByRole('heading', { name: 'Bridesmaid dress' }).waitFor();
  await expect(page.locator('h1')).toContainText('Bridal gown');
});

test('brief: editing a garment keeps the edit', async () => {
  const card = page.locator('article', { hasText: 'Bridal gown' }).first();
  await card.getByText('Edit this garment').click();
  await card.getByLabel('Design brief').fill('Ivory lace, long sleeves, boat neckline, 2 m train');
  await card.getByRole('button', { name: 'Save garment' }).click();
  await card.locator('.notice--success').waitFor();
  await page.reload();
  expect(await has('2 m train')).toBe(true);
});

test('brief: a large phone photo of a sketch is shrunk before it is sent', async () => {
  const sketch = await bigSketch(page);
  await page.getByLabel('Picture').setInputFiles(sketch);
  await page.getByLabel('Caption (optional)').fill('First sketch, with the lace panel');
  await page.getByRole('button', { name: 'Add picture' }).click();
  await pic('Sketch 1').waitFor();
  const files = await stored();
  expect(files).toHaveLength(1);
  expect(files[0]!.mimetype).toBe('image/jpeg');
  expect(files[0]!.size, `sent ${files[0]!.size} of ${sketch.buffer.length} bytes`).toBeLessThan(
    sketch.buffer.length / 3,
  );
  const dims = await pic('Sketch 1')
    .locator('img')
    .evaluate((img: HTMLImageElement) => img.decode().then(() => [img.naturalWidth, img.naturalHeight]));
  expect(Math.max(...dims), `dimensions ${dims}`).toBeLessThanOrEqual(1600);
  expect(Math.max(...dims), `dimensions ${dims}`).toBeGreaterThan(1200);
  expect(dims[1]! > dims[0]!, `orientation lost: ${dims}`).toBe(true);
});

test('brief: a small swatch is sent as it is, with a different kind', async () => {
  const swatch = await smallSwatch(page);
  await page.getByLabel('Picture').setInputFiles(swatch);
  await page.getByLabel('What is it?').selectOption('fabric');
  await page.getByLabel('Caption (optional)').fill('Lace from the market');
  await page.getByRole('button', { name: 'Add picture' }).click();
  await pic('Fabric 1').waitFor();
  const png = (await stored()).find((f) => f.mimetype === 'image/png');
  expect(png?.size).toBe(swatch.buffer.length);
});

test('brief: a second sketch is kept next to the first', async () => {
  await page.getByLabel('Picture').setInputFiles(await smallSwatch(page));
  await page.getByLabel('What is it?').selectOption('sketch');
  await page.getByRole('button', { name: 'Add picture' }).click();
  await pic('Sketch 2').waitFor();
  await expect(pic('Sketch 1')).toHaveCount(1);
});

test('brief: a file that is not a picture is refused in plain words, and the form keeps the rest', async () => {
  await page.getByLabel('Picture').setInputFiles(notAPicture);
  await page.getByLabel('Caption (optional)').fill('Should survive');
  await page.getByRole('button', { name: 'Add picture' }).click();
  await expect(page.locator('#picture-file-error')).toHaveText(/JPEG|PNG|WebP|picture/i);
  await expect(page.getByLabel('Caption (optional)')).toHaveValue('Should survive');
});

test('brief: no file chosen is refused', async () => {
  await page.getByLabel('Picture').setInputFiles([]);
  await page.getByRole('button', { name: 'Add picture' }).click();
  await expect(page.locator('#picture-file-error')).toHaveText(/.{6,}/);
});

test('brief: a picture over 5 MB is made small enough instead of refused', async () => {
  const big = await noise(page);
  expect(big.buffer.length).toBeGreaterThan(5 * 1024 * 1024);
  await page.getByLabel('Picture').setInputFiles(big);
  await page.getByLabel('Caption (optional)').fill('Noise');
  await page.getByRole('button', { name: 'Add picture' }).click();
  await pic('Sketch 3').waitFor({ timeout: 30_000 });
});

test('brief: a picture opens through the app’s own address, by a link that lasts a minute', async () => {
  const href = await pic('Sketch 1').locator('.photo__img').getAttribute('href');
  expect(href).toMatch(/^\/files\/[0-9a-f-]{36}$/);
  const redirect = await ctx.request.get(href!, { maxRedirects: 0 });
  expect(redirect.status()).toBe(302);
  const signed = new URL(redirect.headers().location!);
  const token = signed.searchParams.get('token')!;
  const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as {
    exp: number;
    iat?: number;
  };
  expect(claims.exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(60);
  const picture = await ctx.request.get(href!);
  expect(picture.status()).toBe(200);
  expect(picture.headers()['content-type']).toBe('image/jpeg');
  // Someone else's, or an invented id, is simply not found.
  expect(
    (await ctx.request.get('/files/00000000-0000-4000-8000-000000000000', { maxRedirects: 0 })).status(),
  ).toBe(404);
  expect((await ctx.request.get('/files/not-an-id', { maxRedirects: 0 })).status()).toBe(404);
});

test('brief: editing a caption, and removing a picture removes the stored file too', async () => {
  const card = pic('Sketch 3');
  await card.getByText('Edit').click();
  await card.getByLabel('Caption').fill('Noise, renamed');
  await card.getByRole('button', { name: 'Save caption' }).click();
  await card.locator('.notice--success').waitFor();
  const before = (await stored()).length;
  await card.getByRole('button', { name: 'Remove picture' }).click();
  await card.getByRole('button', { name: 'Yes, remove' }).click();
  await pic('Sketch 3').waitFor({ state: 'detached' });
  await expect.poll(async () => (await stored()).length).toBe(before - 1);
});

test('brief: on a phone, no sideways scroll and no accessibility violations', async () => {
  await goBrief();
  await inspect(page, 'order brief (phone)');
});

// ---------------------------------------------------------------- measurements
const goMeasurements = () => page.goto(`/orders/${ids.o1}/measurements`);

test('measurements: nothing recorded yet says so and offers to record', async () => {
  await goMeasurements();
  const t = await text(page);
  expect(t).toContain('No measurements have been recorded for this client yet.');
  expect(t).toContain('Nothing has been measured for Selam Bekele yet.');
  await inspect(page, 'order measurements empty');
});

test('measurements: the form asks for her list, in her order, with today and her unit', async () => {
  await page.getByRole('link', { name: 'Record measurements' }).click();
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}\/measurements\/new\?order=/);
  ids.client1 = /clients\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  const labels = await page.locator('.measure-grid label').allInnerTexts();
  expect(labels).toHaveLength(12);
  expect(labels[0]).toMatch(/^Bust/);
  expect(labels[11]).toMatch(/^Inseam/);
  await expect(page.getByLabel('Measured on')).toHaveValue(today());
  await expect(page.getByLabel('Centimetres')).toBeChecked();
  await inspect(page, 'record measurements');
});

test('measurements: a bad number is refused at its field and the others are kept', async () => {
  await page.locator('#m-bust').fill('92.5');
  await page.locator('#m-waist').fill('abc');
  await page.locator('#m-hip').fill('98');
  await page.getByRole('button', { name: 'Save measurements' }).click();
  await page.locator('#m-waist-error').waitFor();
  await expect(page.locator('#m-bust')).toHaveValue('92.5');
  await expect(page.locator('#m-hip')).toHaveValue('98');
  await expect(page.locator('#m-waist')).toHaveAttribute('aria-invalid', 'true');
});

test('measurements: nothing at all is refused', async () => {
  for (const id of ['#m-bust', '#m-waist', '#m-hip']) await page.locator(id).fill('');
  await page.getByRole('button', { name: 'Save measurements' }).click();
  await expect(page.locator('.notice--error').first()).toHaveText(/.{11,}/);
  await settled(page);
});

test('measurements: saving from an order returns to it, every garment made to version 1', async () => {
  await page.locator('#m-bust').fill('92.5');
  await page.locator('#m-underbust').fill('78');
  await page.locator('#m-waist').fill('70');
  await page.locator('#m-hip').fill('98');
  await page.locator('#m-dress_length').fill('150');
  await page.getByLabel('Note (optional)').fill('Measured standing, in her wedding shoes');
  await page.getByRole('button', { name: 'Save measurements' }).click();
  await page.waitForURL(`${env.baseURL}/orders/${ids.o1}/measurements`);
  expect((await text(page)).match(/Made to measurements version 1, taken/g)).toHaveLength(2);
  await expect(page.getByRole('button', { name: 'Use this version' })).toHaveCount(0);
  await inspect(page, 'order measurements v1');
});

test('measurements: a new version from the client page is prefilled from the last one', async () => {
  await page.goto(`/clients/${ids.client1}`);
  expect(await has('Version 1')).toBe(true);
  await inspect(page, 'client page');
  await page
    .getByRole('link', { name: /Record new measurements|Record measurements/ })
    .first()
    .click();
  await page.waitForURL(/measurements\/new/);
  await expect(page.locator('#m-bust')).toHaveValue('92.5');
  await expect(page.locator('#m-hip')).toHaveValue('98');
  await expect(page.locator('#m-sleeve')).toHaveValue('');
  await page.locator('#m-waist').fill('68');
  await page.locator('#m-hip').fill('99.5');
  await page.locator('#m-sleeve').fill('58');
  await page.getByRole('button', { name: 'Save measurements' }).click();
  await page.waitForURL(`${env.baseURL}/clients/${ids.client1}`);
  expect(await has('Version 2')).toBe(true);
});

test('measurements: the order says what changed and moves no garment by itself', async () => {
  await goMeasurements();
  const t = await text(page);
  expect(t.match(/Made to measurements version 1/g)).toHaveLength(2);
  expect(t).toContain('A newer version, 2');
  expect(t).toContain('Waist: 70 cm → 68 cm (-2 cm)');
  expect(t).toContain('Hip: 98 cm → 99.5 cm (+1.5 cm)');
  expect(t).toContain('Sleeve length: now 58 cm');
  await inspect(page, 'order measurements outdated');
});

test('measurements: she moves one garment to the new version and the other stays', async () => {
  const gown = page.locator('article', { hasText: 'Bridal gown' });
  await gown.getByRole('button', { name: 'Use this version' }).click();
  await gown.getByText('Made to measurements version 2').waitFor();
  const dress = page.locator('article', { hasText: 'Bridesmaid dress' });
  await expect(dress).toContainText('version 1');
  await expect(dress.getByRole('button', { name: 'Use this version' })).toHaveCount(1);
});

test('measurements: inches stay inches; numbers are never converted into another unit', async () => {
  await page.goto(`/clients/${ids.client1}/measurements/new`);
  await page.locator('.segmented label', { hasText: 'Inches' }).click();
  await page.locator('#m-bust').fill('36.5');
  await page.getByRole('button', { name: 'Save measurements' }).click();
  await page.waitForURL(`${env.baseURL}/clients/${ids.client1}`);
  expect(await text(page)).toMatch(/Version 3 · taken [^·]+ · in/);
  await page.locator('summary', { hasText: 'Version 3' }).click();
  expect(await text(page)).toMatch(/Bust\s*36\.5 in/);
  // With her default unit still centimetres, the form starts empty and says why.
  await page.goto(`/clients/${ids.client1}/measurements/new`);
  await expect(page.getByLabel('Centimetres')).toBeChecked();
  expect(await has('Version 3 was taken in inches, so this form starts empty')).toBe(true);
  await expect(page.locator('#m-bust')).toHaveValue('');
});

// ---------------------------------------------------------------- settings: her defaults and her list
test('settings: her list of measurements can be renamed, reordered, hidden, shown and added to', async () => {
  await page.goto('/settings/measurements');
  await inspect(page, 'measurement list');
  const labels = () =>
    page
      .locator('.field-row__name input.input')
      .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  expect((await labels())[0]).toBe('Bust');
  expect(await labels()).toHaveLength(12);
  await page.locator('input[id$="-label"]').first().fill('Bust (fullest part)');
  await page.getByRole('button', { name: 'Save name of Bust' }).click();
  await page.locator('.notice--success').first().waitFor();
  await page.getByRole('button', { name: 'Move Waist up' }).click();
  await expect.poll(async () => (await labels())[1]).toBe('Waist');
  expect((await labels()).slice(0, 4)).toEqual(['Bust (fullest part)', 'Waist', 'Under bust', 'Hip']);
  await expect(page.getByRole('button', { name: 'Move Bust (fullest part) up' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Move Inseam down' })).toBeDisabled();
  // A name already taken, in other capitals, is refused.
  await page.locator('input[id$="-label"]').nth(2).fill('WAIST');
  await page.getByRole('button', { name: 'Save name of Under bust' }).click();
  await expect(page.locator('.error').first()).toContainText('already have a measurement');
  await page.reload();
  await page.getByRole('button', { name: 'Hide Neck from new forms' }).click();
  await page.getByRole('button', { name: 'Show Neck on new forms' }).waitFor();
  expect(await labels()).toHaveLength(11);
  await page.getByRole('button', { name: 'Show Neck on new forms' }).click();
  await expect.poll(async () => (await labels()).length).toBe(12);
  await page.getByLabel('A measurement to add').fill('Knee to hem');
  await page.getByRole('button', { name: 'Add to the list' }).click();
  await expect.poll(async () => (await labels()).at(-1)).toBe('Knee to hem');
  // The form follows the list.
  await page.goto(`/clients/${ids.client1}/measurements/new`);
  const names = await page.locator('.measure-grid label').allInnerTexts();
  expect(names[0]).toMatch(/^Bust \(fullest part\)/);
  expect(names[1]).toMatch(/^Waist/);
  expect(names.at(-1)).toMatch(/^Knee to hem/);
  // An old version still shows its numbers, under the new name.
  await page.goto(`/clients/${ids.client1}`);
  await page.locator('summary', { hasText: 'Version 1' }).click();
  expect(await text(page)).toMatch(/Bust \(fullest part\)\s*92\.5 cm/);
});

test('settings: her order and measurement defaults are saved and used', async () => {
  await page.goto('/settings');
  const buffer = page.getByLabel('Days to keep free before a handover');
  await buffer.fill('4');
  await page.locator('.segmented label', { hasText: 'Inches' }).click();
  await page.getByRole('button', { name: 'Save defaults' }).click();
  await page.getByText('Defaults saved.').waitFor();
  await page.reload();
  await expect(buffer).toHaveValue('4');
  await expect(page.locator('.segmented label', { hasText: 'Inches' }).locator('input')).toBeChecked();
  await page.goto('/orders/new');
  await expect(page.getByLabel('Days to keep free before it')).toHaveAttribute('placeholder', '4');
  await page.goto('/settings');
  await buffer.fill('40');
  await page.getByRole('button', { name: 'Save defaults' }).click();
  await expect(page.locator('.error').first()).toContainText('0 to 30');
  await expect(buffer).toHaveValue('40');
  await inspect(page, 'settings refused');
  await buffer.fill('3');
  // Back to centimetres: the later steps measure in centimetres.
  await page.locator('.segmented label', { hasText: 'Centimetres' }).click();
  await page.getByRole('button', { name: 'Save defaults' }).click();
  await page.getByText('Defaults saved.').waitFor();
});

test('settings: the time zone she saves is the one still shown', async () => {
  await page.goto('/settings');
  const zone = page.getByLabel('Time zone');
  await zone.selectOption('Europe/London');
  await page.getByRole('button', { name: 'Save details' }).click();
  await page.getByText('Details saved.').waitFor();
  await expect(zone).toHaveValue('Europe/London');
  await zone.selectOption('Africa/Addis_Ababa');
  await page.getByRole('button', { name: 'Save details' }).click();
  // The first save's message is still on screen; wait for what is stored instead.
  await expect
    .poll(() =>
      value(
        `select timezone from public.profile p join auth.users u on u.id = p.owner_id where u.email = $1`,
        [env.email],
      ),
    )
    .toBe('Africa/Addis_Ababa');
  await expect(zone).toHaveValue('Africa/Addis_Ababa');
});

// ---------------------------------------------------------------- orders 2 and 3
test('order 2: an evening dress for another new client; her default buffer is used', async () => {
  await page.goto('/orders/new');
  await page.getByLabel('Client', { exact: true }).selectOption({ label: '+ A new client' });
  await page.getByLabel("Client's name").fill('Hanna Tesfaye');
  await page.getByLabel('Garment', { exact: true }).fill('Evening dress');
  await page.getByLabel('Design brief (optional)').fill('Wine red satin, open back, floor length');
  await page.getByLabel('Handover day').fill(inDays(16));
  await page.getByRole('button', { name: 'Confirm order' }).click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}\/preparation/);
  ids.o2 = orderOfUrl();
  await expect(page.locator('h1')).toContainText('#2');
  await page.goto(`/orders/${ids.o2}`);
  await expect(page.getByLabel('Days to keep free before it')).toHaveValue('3');
});

test('order 2: garments of a new client have no measurements, and she is told', async () => {
  expect(await has('No measurements have been recorded for this client yet.')).toBe(true);
});

test('order 3: a client added on her own, then an order started from the client page', async () => {
  await page.goto('/clients/new');
  await page.getByLabel('Name', { exact: true }).fill('Yonas Alemu');
  await page.getByLabel('Phone (optional)').fill('+251 911 000 111');
  await page.getByLabel('Notes (optional)').fill('Prefers a call after 5pm');
  await page.getByRole('button', { name: 'Add client' }).click();
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}$/);
  ids.client3 = page.url().split('/').pop()!;
  await inspect(page, 'client page (no orders)');
  await page.getByRole('link', { name: 'New order for Yonas Alemu' }).click();
  await page.waitForURL(/orders\/new\?client=/);
  await expect(page.getByLabel('Client', { exact: true })).toHaveValue(ids.client3);
  await page.getByLabel('Garment', { exact: true }).fill('Suit alteration');
  await page.getByLabel('Design brief (optional)').fill('Take in the waist 3 cm, shorten trousers');
  await page.getByLabel('Handover day').fill(inDays(2));
  await page.getByRole('button', { name: 'Save as draft' }).click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}\/preparation/);
  ids.o3 = orderOfUrl();
});

test('order 3: a draft promises nothing, and offers to be confirmed or deleted', async () => {
  await page.goto(`/orders/${ids.o3}`);
  await expect(page.locator('.chip').first()).toHaveText('Draft');
  const t = await text(page);
  expect(t).toContain('A draft promises nothing');
  expect(t).toContain('Delete this draft');
});

test('order 3: a taken order number is refused at its field', async () => {
  await page.goto('/orders/new');
  await page.getByLabel('Client', { exact: true }).selectOption(ids.client3!);
  await page.getByLabel('Garment', { exact: true }).fill('Trousers hem');
  await page.getByLabel('Handover day').fill(inDays(1));
  await page.getByText('Use my own order number').click();
  await page.getByLabel('Order number').fill('1');
  await page.getByRole('button', { name: 'Confirm order' }).click();
  await expect(page.locator('.error').first()).toHaveText(/already/i);
  await expect(page.getByLabel('Garment', { exact: true })).toHaveValue('Trousers hem');
});

test('order 3: confirming the draft makes it active', async () => {
  await page.goto(`/orders/${ids.o3}`);
  await page.getByRole('button', { name: 'Confirm order' }).click();
  await page.locator('.chip', { hasText: 'Active' }).first().waitFor();
});

test('order 3: a hold needs a reason, and the reason is shown', async () => {
  await page.locator('summary', { hasText: 'Put on hold' }).click();
  await page.getByRole('button', { name: 'Put on hold' }).click();
  await page.locator('#hold-reason-error').waitFor();
  await page.getByLabel('Why is it on hold?').fill('Client abroad until December');
  await page.getByRole('button', { name: 'Put on hold' }).click();
  await page.locator('.chip', { hasText: 'On hold' }).first().waitFor();
  expect(await has('On hold: Client abroad until December')).toBe(true);
});

test('order 3: resumed, then delivered on a day she chooses', async () => {
  await page.getByRole('button', { name: 'Resume order' }).click();
  await page.locator('.chip', { hasText: 'Active' }).first().waitFor();
  await page.locator('summary', { hasText: 'Mark as delivered' }).click();
  await expect(page.getByLabel('Delivered on')).toHaveValue(today());
  await page.getByRole('button', { name: 'Mark as delivered' }).click();
  await page.locator('.chip', { hasText: 'Delivered' }).first().waitFor();
  expect(await has('Delivered on')).toBe(true);
  await inspect(page, 'delivered order');
});

test('order 3: a delivered order is a record: nothing on it can be edited', async () => {
  await page.goto(`/orders/${ids.o3}`);
  await expect(page.getByText('Add another garment')).toHaveCount(0);
  await expect(page.getByText('Edit this garment')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save details' })).toHaveCount(0);
  await expect(page.locator('#picture-file')).toHaveCount(0);
  await page.goto(`/orders/${ids.o3}/preparation`);
  await expect(page.getByText('Update', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Quick add')).toHaveCount(0);
  expect(await has('Reopen it to change the list')).toBe(true);
  await page.goto(`/orders/${ids.o3}/measurements`);
  await expect(page.getByRole('button', { name: 'Use this version' })).toHaveCount(0);
});

test('order 3: reopened, cancelled with a reason, reopened as a draft and deleted', async () => {
  await page.goto(`/orders/${ids.o3}`);
  await page.getByRole('button', { name: 'Reopen order' }).click();
  await page.locator('.chip', { hasText: 'Active' }).first().waitFor();
  await page.locator('summary', { hasText: 'Cancel order' }).click();
  await page.getByLabel('Why? (optional)').fill('Client found another tailor');
  await page.getByRole('button', { name: 'Cancel order' }).click();
  await page.locator('.chip', { hasText: 'Cancelled' }).first().waitFor();
  expect(await has('Cancelled: Client found another tailor')).toBe(true);
  await page.getByRole('button', { name: 'Reopen as draft' }).click();
  await page.locator('.chip', { hasText: 'Draft' }).first().waitFor();
  await page.getByRole('button', { name: 'Delete this draft' }).click();
  await page.getByRole('button', { name: 'Yes, delete' }).click();
  await page.waitForURL(`${env.baseURL}/orders`);
  expect(await has('Suit alteration')).toBe(false);
  // The deleted order's page is not found: the 404 is the point.
  errors.allow(/status of 404/);
  const gone = await page.goto(`/orders/${ids.o3}`);
  expect(gone?.status()).toBe(404);
  errors.allow(null);
});

test('order 3 again: the same client, a second suit order, kept this time', async () => {
  await page.goto(`/orders/new?client=${ids.client3}`);
  await page.getByLabel('Garment', { exact: true }).fill('Suit alteration');
  await page.getByLabel('Handover day').fill(inDays(2));
  await page.getByRole('button', { name: 'Confirm order' }).click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}\/preparation/);
  ids.o3 = orderOfUrl();
  // A deleted draft promised nothing, so its number is free again.
  await expect(page.locator('h1')).toContainText('#3');
});

// ---------------------------------------------------------------- history, lists, clients
test('history: order 1 tells its story in her words', async () => {
  await page.goto(`/orders/${ids.o1}/history`);
  const t = await text(page);
  for (const words of ['Bridesmaid dress', 'Sketch', 'version 2', 'Lace']) expect(t).toContain(words);
  await inspect(page, 'history');
});

test('orders list: soonest first, filters count, readiness shown', async () => {
  await page.goto('/orders');
  const titles = await page.locator('.row-link__title').allInnerTexts();
  expect(titles).toHaveLength(3);
  expect(titles[0]).toContain('#3');
  expect(titles[2]).toContain('#1');
  const t = await text(page);
  expect(t).toContain('1 of 4 ready');
  expect(t).toContain('Active (3)');
  await inspect(page, 'orders list');
  await page.goto('/orders?status=delivered');
  expect(await has('No delivered orders.')).toBe(true);
  await page.goto('/orders?status=nonsense');
  expect(await has('Active (3)')).toBe(true);
});

test('clients: a client with orders cannot be deleted; one without can', async () => {
  await page.goto(`/clients/${ids.client1}`);
  await expect(page.getByRole('button', { name: 'Remove this client' })).toHaveCount(0);
  expect(await has('orders are kept as a record')).toBe(true);
  await page.goto('/clients/new');
  await page.getByLabel('Name', { exact: true }).fill('Walk-in, no order');
  await page.getByRole('button', { name: 'Add client' }).click();
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Remove this client' }).click();
  await page.getByRole('button', { name: 'Yes, remove' }).click();
  await page.waitForURL(`${env.baseURL}/clients`);
  expect(await has('Walk-in, no order')).toBe(false);
  await inspect(page, 'clients list');
});

test('desktop and night: every capture screen', async ({ browser }) => {
  const screens = [
    '/orders',
    `/orders/${ids.o1}`,
    `/orders/${ids.o1}/measurements`,
    `/orders/${ids.o1}/preparation`,
    `/orders/${ids.o1}/history`,
    '/orders/new',
    `/clients/${ids.client1}`,
    '/settings',
    '/settings/measurements',
  ];
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
