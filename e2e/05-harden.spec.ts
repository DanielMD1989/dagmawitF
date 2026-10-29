import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { strFromU8, unzipSync } from 'fflate';
import { inspect, open, signedInContext, text, watchErrors } from './support/app';
import { ownerId, orderId, sql, value } from './support/db';
import { env, inDays, today } from './support/env';
import { smallSwatch } from './support/pictures';

// Stage 6 (docs/harden.md): My Day with no signal and the taps that wait, the export restored by the drill, tidying
// stored pictures, the Content-Security-Policy, the keyboard, and every screen against axe with best practices.

test.describe.configure({ mode: 'serial' });

let ctx: BrowserContext;
let page: Page;
let errors: ReturnType<typeof watchErrors>;
let O1 = '';
let OWNER = '';

interface Entry {
  id: string;
  title: string;
  state: string;
  kind: string;
}
let kept: Entry[] = [];
/** The two ready pieces of work the offline steps use: their places in the list. */
let A = -1;
let B = -1;

/** An entry of the day by its place: My Day and the offline page list them in the same order. */
const entry = (i: number): Locator => page.locator('main li.item').nth(i);
const chip = (i: number) => entry(i).locator('.item__head > .chip');
const stored = (key: string) => page.evaluate((k) => localStorage.getItem(k), key);
const progress = (id: string) =>
  value(
    `select status || '|' || coalesce(remaining_minutes::text, '') || '|' || coalesce(actual_minutes::text, '')
     from public.task where id = $1`,
    [id],
  );
const signal = async (on: boolean) => {
  // With the network cut, the browser reports its failed requests: those are the point of these steps.
  errors.allow(on ? null : /ERR_INTERNET_DISCONNECTED|Failed to fetch|net::/);
  await ctx.setOffline(!on);
};
/** Presses Tab until `target` has focus, as she would; fails if it never does. */
async function tabTo(target: Locator, most = 300): Promise<void> {
  for (let i = 0; i < most; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Tab never reached ${target}`);
}

test.beforeAll(async ({ browser }) => {
  ctx = await signedInContext(browser);
  page = await ctx.newPage();
  errors = watchErrors(page);
  O1 = await orderId(1);
  OWNER = await ownerId();
});
test.afterAll(async () => ctx.close());

test('a fresh plan is approved, and the app installs its service worker', async () => {
  await page.goto(`/orders/${O1}/plan`);
  await page.getByRole('button', { name: /Make (a|a new) proposal/ }).click();
  await page.waitForURL(/\/plan\/\d+\?order=/);
  await page.getByRole('button', { name: /^Approve/ }).click();
  await page.waitForURL(`${env.baseURL}/orders/${O1}/plan`);
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  // The first visit installs it; from the next, it controls the page and keeps the offline page when asked.
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.waitForFunction(async () => Boolean(await caches.match('/offline')), null, { timeout: 20_000 });
});

test('My Day is kept on the phone as she sees it, and nothing else of hers is', async () => {
  await expect.poll(() => stored('dagmawit.today.v1')).not.toBeNull();
  const snap = JSON.parse((await stored('dagmawit.today.v1'))!) as {
    ownerId: string;
    firstName: string;
    entries: Entry[];
  };
  expect(snap.entries.map((e) => e.title)).toEqual(
    await page.locator('main li.item .item__title').allInnerTexts(),
  );
  expect(snap.ownerId).toBe(OWNER);
  expect(snap.firstName).toBe('Dagmawit');
  expect(
    await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('dagmawit'))),
  ).toEqual(['dagmawit.today.v1']);
  const cached = await page.evaluate(async () =>
    (await (await caches.open('dagmawit-shell-v2')).keys()).map((r) => new URL(r.url).pathname),
  );
  expect(cached).toContain('/offline');
  expect(cached.some((p) => p.endsWith('.css'))).toBe(true);
  expect(cached.some((p) => p.endsWith('.js'))).toBe(true);
  expect(
    cached.filter((p) => p === '/' || p.startsWith('/orders') || p.startsWith('/api')),
    'pages or data cached',
  ).toEqual([]);
  kept = snap.entries;
  A = kept.findIndex((e) => e.state === 'ready' && e.kind === 'work');
  B = kept.findIndex((e, i) => i > A && e.state === 'ready' && e.kind === 'work');
  expect(
    A >= 0 && B >= 0,
    `two ready pieces of work today: ${kept.map((e) => `${e.title}:${e.state}`).join('|')}`,
  ).toBe(true);
});

test('with no signal, opening the app shows the day as of when it was kept', async () => {
  await signal(false);
  await page.goto('/');
  await page.waitForURL(/\/offline\?from=%2F$/);
  await page.locator('h1', { hasText: /^Today, as of \d\d:\d\d$/ }).waitFor();
  const t = await text(page);
  expect(t).toMatch(/no signal/i);
  expect(t).toContain('What you mark here waits on this phone');
  expect(t).toMatch(/planned of .* usable/);
  expect(await page.locator('main li.item .item__title').allInnerTexts()).toEqual(kept.map((e) => e.title));
  await inspect(page, 'offline day');
});

test('any page she opens with no signal leads to the day; Try again goes back to it', async () => {
  await page.goto(`/orders/${O1}`);
  await page.waitForURL(/\/offline\?from=/);
  await expect(page.getByRole('link', { name: 'Try again' })).toHaveAttribute('href', `/orders/${O1}`);
});

test('she starts one task and says what is left of it, and finishes another; each change waits', async () => {
  await entry(A)
    .getByRole('button', { name: `Start ${kept[A]!.title}` })
    .click();
  await expect(entry(A)).toContainText('Waiting to be sent');
  await expect(chip(A)).toHaveText('Started');
  const going = await open(entry(A), 'Still going');
  await going.getByLabel('hours').fill('0');
  await going.getByLabel('minutes').fill('40');
  await going.getByRole('button', { name: 'Save what is left' }).click();
  await expect(entry(A)).toContainText('about 40 min left');
  // The same rules as My Day: her own work says how long it took (her estimate is offered).
  const done = await open(entry(B), 'Done');
  const hours = done.getByLabel('hours');
  const minutes = done.getByLabel('minutes');
  expect(`${await hours.inputValue()}${await minutes.inputValue()}`).not.toBe('');
  await hours.fill('');
  await minutes.fill('');
  await done.getByRole('button', { name: 'Mark as done' }).click();
  await done.getByText('Say how long it took, in total.').waitFor();
  await hours.fill('1');
  await minutes.fill('15');
  await done.getByRole('button', { name: 'Mark as done' }).click();
  await expect(entry(B)).toContainText('took 1h 15m');
  await expect(chip(B)).toHaveText('Done');
  expect(await text(page)).toContain('3 changes wait to be sent.');
  const taps = JSON.parse((await stored('dagmawit.waiting.v1'))!) as {
    change: { kind: string };
    seen: string;
  }[];
  expect(taps.map((t) => `${t.change.kind}:${t.seen}`)).toEqual([
    'start:not_started',
    'remaining:in_progress',
    'done:not_started',
  ]);
});

test('undo takes back only a task’s last change', async () => {
  await entry(A)
    .getByRole('button', { name: `Undo the last change to ${kept[A]!.title}` })
    .click();
  await expect(entry(A)).not.toContainText('min left');
  await expect(chip(A)).toHaveText('Started');
  expect(await text(page)).toContain('2 changes wait to be sent.');
  const going = await open(entry(A), 'Still going');
  await going.getByLabel('hours').fill('0');
  await going.getByLabel('minutes').fill('40');
  await going.getByRole('button', { name: 'Save what is left' }).click();
  await expect(page.locator('main')).toContainText('3 changes wait to be sent.');
});

test('the taps survive closing and reopening the app with no signal', async () => {
  await page.goto('/');
  await page.waitForURL(/\/offline/);
  await expect(page.locator('main')).toContainText('3 changes wait to be sent.');
  await expect(chip(B)).toHaveText('Done');
  await inspect(page, 'offline with taps');
});

test('nothing reached the server while there was no signal', async () => {
  expect(await progress(kept[A]!.id)).toMatch(/^not_started\|/);
  expect(await progress(kept[B]!.id)).toMatch(/^not_started\|/);
});

test('meanwhile, on her computer, she says the second task is still going', async ({ browser }) => {
  // Not done on the computer: still going. A waiting "done" could follow that by the rules of progress, so only
  // the rule that a tap applies to the task as she saw it (decision 0056) keeps the computer's answer.
  const computer = await signedInContext(browser, 'desktop');
  const p = await computer.newPage();
  await p.goto('/');
  const there = p.locator('main li.item').nth(B);
  await expect(there.locator('.item__title')).toHaveText(kept[B]!.title);
  const going = await open(there, 'Still going');
  await going.getByLabel('hours').fill('1');
  await going.getByLabel('minutes').fill('');
  await going.getByRole('button', { name: 'Save what is left' }).click();
  await expect(there).toContainText('about 1h 00m left');
  await computer.close();
});

test('the signal comes back: the page says so, and opening the app sends what waited', async () => {
  await signal(true);
  await page.getByText('The signal is back.', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'Open the app' }).click();
  await page.waitForURL(`${env.baseURL}/`);
  const status = page.locator('.sync');
  await status.getByText('2 taps made without signal were saved.').waitFor();
  await expect(status.locator('.attention')).toHaveText('One was not saved:');
  await expect(status.locator('li')).toHaveText(
    `${kept[B]!.title}. It is started now, so this was left as it is.`,
  );
  expect(await progress(kept[A]!.id)).toBe('in_progress|40|');
  // The computer's answer stands: the waiting tap did not overwrite it.
  expect(await progress(kept[B]!.id)).toBe('in_progress|60|');
  expect(JSON.parse((await stored('dagmawit.waiting.v1')) ?? '[]')).toEqual([]);
  // My Day shows what the server has now.
  await expect(entry(A)).toContainText('about 40 min left');
  await inspect(page, 'my day after sending');
  await status.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.locator('.sync')).toHaveCount(0);
});

test('a waiting tap sent twice is not applied twice', async () => {
  const res = await page.evaluate(async (taskId) => {
    const r = await fetch('/api/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, seen: 'not_started', change: { kind: 'start' } }),
    });
    return { status: r.status, body: (await r.json()) as { result: string; message: string } };
  }, kept[A]!.id);
  expect(res).toEqual({
    status: 200,
    body: { result: 'stale', message: 'It is started now, so this was left as it is.' },
  });
});

test('the replay endpoint keeps the rules: a day to come is refused, a stranger is turned away', async () => {
  errors.allow(/status of 400/);
  const future = await page.evaluate(async (taskId) => {
    const r = await fetch('/api/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId,
        seen: 'in_progress',
        change: { kind: 'done', doneOn: '2099-01-01', actualMinutes: 30 },
      }),
    });
    return { status: r.status, body: await r.json() };
  }, kept[A]!.id);
  expect(future).toEqual({
    status: 200,
    body: { result: 'invalid', message: 'Choose today or an earlier day.' },
  });
  const junk = await page.evaluate(
    async () =>
      (
        await fetch('/api/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{"taskId":"x"}',
        })
      ).status,
  );
  expect(junk).toBe(400);
  errors.allow(null);
  // Without her session: refused, not redirected.
  const stranger = await fetch(`${env.baseURL}/api/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  expect(stranger.status).toBe(401);
  expect((await fetch(`${env.baseURL}/api/export`, { redirect: 'manual' })).status).toBe(401);
  // From another site: refused.
  const elsewhere = await fetch(`${env.baseURL}/api/progress`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://elsewhere.example',
      Cookie: (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join('; '),
    },
    body: '{}',
  });
  expect(elsewhere.status).toBe(403);
});

test('a list kept on an earlier day is a reminder only: no taps', async () => {
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('dagmawit.today.v1')!) as { day: string };
    s.day = '2026-01-05';
    localStorage.setItem('dagmawit.today.v1', JSON.stringify(s));
  });
  await signal(false);
  await page.goto('/planner');
  await page.waitForURL(/\/offline/);
  await page.locator('h1', { hasText: /^Monday 5 January, as of / }).waitFor();
  expect(await text(page)).toContain('It is a reminder, not today’s plan, so nothing can be marked here.');
  await expect(page.getByRole('button', { name: /^Start / })).toHaveCount(0);
  await expect(page.locator('main summary')).toHaveCount(0);
  await signal(true);
});

test('with nothing kept, the offline page says how to keep the day', async () => {
  await page.evaluate(() => localStorage.clear());
  await page.goto('/offline');
  await page.locator('h1', { hasText: 'Nothing is kept on this phone yet' }).waitFor();
  await inspect(page, 'offline nothing kept');
});

let zipPath = '';
test('Settings → Download everything gives one zip, named by her day, with every picture', async () => {
  await page.goto('/settings');
  await page.locator('h2', { hasText: 'Her data' }).waitFor();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download everything' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`dagmawit-${today()}.zip`);
  zipPath = join(mkdtempSync(join(tmpdir(), 'dagmawit-export-')), download.suggestedFilename());
  await download.saveAs(zipPath);
  const entries = unzipSync(new Uint8Array(readFileSync(zipPath)));
  const names = Object.keys(entries);
  expect(names).toContain('data.json');
  expect(names).toContain('README.txt');
  const pictures = names.filter((n) => n.startsWith('files/'));
  const recorded = await sql<{ storage_path: string }>(
    `select storage_path from public.attachment where owner_id = $1`,
    [OWNER],
  );
  expect(pictures.sort()).toEqual(recorded.map((r) => `files/${r.storage_path}`).sort());
  expect(strFromU8(entries['README.txt']!)).not.toContain('could not be read');
  const data = JSON.parse(strFromU8(entries['data.json']!)) as {
    owner_id: string;
    tables: Record<string, unknown[]>;
  };
  expect(data.owner_id).toBe(OWNER);
  expect(data.tables.orders!.length).toBe(
    Number(await value(`select count(*) from public.orders where owner_id = $1`, [OWNER])),
  );
});

test('the exit test: the downloaded file restores whole, as another person, in a fresh database', async () => {
  const out = execFileSync('npm', ['run', '-s', 'drill:restore', '--', '--file', zipPath], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: env.databaseUrl },
  });
  expect(out).toContain('The drill passed');
});

test('Tidy stored pictures removes only an old file no record points to', async () => {
  // Two stored files with no record, as if the server stopped between storing and recording: one is two hours old.
  const bucket = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false },
  }).storage.from('order-files');
  const old = `${OWNER}/${O1}/00000000-0000-4000-8000-00000000aaaa.png`;
  const fresh = `${OWNER}/${O1}/00000000-0000-4000-8000-00000000bbbb.png`;
  const swatch = await smallSwatch(page);
  for (const path of [old, fresh]) {
    const { error } = await bucket.upload(path, swatch.buffer, { contentType: 'image/png' });
    expect(error).toBeNull();
  }
  await sql(
    `update storage.objects set created_at = now() - interval '2 hours' where bucket_id = 'order-files' and name = $1`,
    [old],
  );
  const names = async () =>
    (
      await sql<{ name: string }>(
        `select name from storage.objects where bucket_id = 'order-files' and name like $1`,
        [`${OWNER}/%`],
      )
    ).map((r) => r.name);
  const before = await names();
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Tidy stored pictures' }).click();
  await page.getByText('Removed 1 stored picture that no record pointed to.').waitFor();
  const after = await names();
  expect(after).not.toContain(old);
  expect(after).toContain(fresh);
  expect(after).toHaveLength(before.length - 1);
  const recorded = await sql<{ storage_path: string }>(
    `select storage_path from public.attachment where owner_id = $1`,
    [OWNER],
  );
  for (const r of recorded) expect(after).toContain(r.storage_path);
  await page.getByRole('button', { name: 'Tidy stored pictures' }).click();
  await page.getByText('Nothing to tidy: every stored picture belongs to a record.').waitFor();
  // The fresh one would be tidied in an hour; remove it now so the next steps see only real pictures.
  await bucket.remove([fresh]);
});

test('the Content-Security-Policy stops a script the app did not send', async () => {
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    (window as unknown as { violations: string[] }).violations = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as unknown as { violations: string[] }).violations.push(e.effectiveDirective),
    );
  });
  await p.route('**/settings', async (route) => {
    const r = await route.fetch();
    const body = (await r.text()).replace('</body>', '<script>window.injected = true</script></body>');
    await route.fulfill({ response: r, body });
  });
  await p.goto('/settings');
  await p.locator('h2', { hasText: 'Her data' }).waitFor();
  expect(await p.evaluate(() => (window as unknown as { injected?: boolean }).injected === true)).toBe(false);
  const blocked = await p.evaluate(() => (window as unknown as { violations: string[] }).violations);
  expect(
    blocked.some((d) => d.startsWith('script-src')),
    `violations: ${blocked}`,
  ).toBe(true);
  const policy = (await p.request.get('/settings')).headers()['content-security-policy'];
  expect(policy).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  // The app's own scripts carry the nonce, and run.
  expect(await p.locator('script[nonce]').count()).toBeGreaterThan(0);
  await p.close();
});

test('the keyboard: the skip link comes first and lands on the content', async () => {
  await page.goto('/orders');
  await page.keyboard.press('Tab');
  const first = page.locator('.skip-link');
  await expect(first).toBeFocused();
  await expect(first).toHaveText('Skip to the content');
  await expect(first).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#content')).toBeFocused();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.closest('main') !== null)).toBe(true);
});

test('the keyboard alone: take an order', async () => {
  // A date box takes day and month in the order of the browser's own language. Find which first, on a page of its
  // own, as she knows hers.
  await page.goto('/orders/new');
  await page.locator('body').focus();
  await tabTo(page.getByLabel('Handover day'));
  await page.keyboard.type('01022030');
  const dayFirst = (await page.getByLabel('Handover day').inputValue()) === '2030-02-01';

  await page.goto('/orders/new');
  await page.locator('body').focus();
  const client = page.getByLabel('Client', { exact: true });
  await tabTo(client);
  // A closed list picks the option whose name she types.
  await page.keyboard.type('Hanna');
  await expect(client).toHaveValue(/[0-9a-f-]{36}/);
  await tabTo(page.getByLabel('Garment', { exact: true }));
  await page.keyboard.type('Netela shawl');
  const handover = page.getByLabel('Handover day');
  await tabTo(handover);
  const [y, m, d] = inDays(20).split('-');
  await page.keyboard.type(dayFirst ? `${d}${m}${y}` : `${m}${d}${y}`);
  await expect(handover).toHaveValue(inDays(20));
  await tabTo(page.getByRole('button', { name: 'Confirm order' }));
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}\/preparation/);
  await expect(page.locator('h1')).toContainText('Netela shawl');
});

test('the keyboard alone: approve a plan, then mark a task done', async () => {
  await page.goto(`/orders/${O1}/plan`);
  await page.locator('body').focus();
  await tabTo(page.getByRole('button', { name: /Make (a|a new) proposal/ }));
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/plan\/\d+\?order=/);
  await page.locator('body').focus();
  await tabTo(page.getByRole('button', { name: /^Approve/ }));
  await page.keyboard.press('Enter');
  await page.waitForURL(`${env.baseURL}/orders/${O1}/plan`);
  await page.goto('/');
  const summary = entry(A).locator('summary', { hasText: /^Done/ });
  await page.locator('body').focus();
  await tabTo(summary);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('1');
  await page.keyboard.press('Tab');
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('5');
  await page.keyboard.press('Enter');
  await expect(entry(A)).toContainText('took 1h 05m');
  expect(await progress(kept[A]!.id)).toBe('done||65');
});

test('every screen passes axe with best practices, on a phone and on a night desktop', async ({
  browser,
}) => {
  const screens = [
    '/',
    '/orders',
    `/orders/${O1}`,
    `/orders/${O1}/plan`,
    `/orders/${O1}/preparation`,
    `/orders/${O1}/history`,
    '/orders/new',
    '/plan',
    '/planner',
    '/library',
    '/clients',
    '/settings',
    '/settings/measurements',
    '/today/review',
    '/offline',
  ];
  for (const look of ['phone', 'desktop-night'] as const) {
    const c = await signedInContext(browser, look);
    const p = await c.newPage();
    const seen = watchErrors(p);
    for (const path of screens) {
      expect((await p.goto(path))?.status(), `${look} ${path}`).toBe(200);
      await inspect(p, `${look} ${path}`, true);
    }
    expect(seen.list).toEqual([]);
    await c.close();
  }
});

test('no browser errors along the way', async () => {
  expect(errors.list).toEqual([]);
});
