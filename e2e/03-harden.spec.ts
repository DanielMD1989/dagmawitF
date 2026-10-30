import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { strFromU8, unzipSync } from 'fflate';
import { inspect, signedInContext, text, watchErrors } from './support/app';
import { ownerId, orderId, sql, value } from './support/db';
import { env, inDays, today } from './support/env';
import { smallSwatch } from './support/pictures';

// Stage 6 (docs/harden.md): Today with no signal and the ticks that wait, the export restored by the drill, tidying
// stored pictures, the Content-Security-Policy, the keyboard, and every screen against axe with best practices.

test.describe.configure({ mode: 'serial' });

let ctx: BrowserContext;
let page: Page;
let errors: ReturnType<typeof watchErrors>;
let O1 = '';
let OWNER = '';

interface Kept {
  id: string;
  title: string;
  /** The work it is part of, its headline; null for her own. */
  work: string | null;
  done: boolean;
}
/** What she reads first on an entry: the work, or her own step's title. */
const headline = (e: Kept) => e.work ?? e.title;
/** The name a tick button carries: the step, then its work. */
const tickName = (e: Kept) => (e.work ? `${e.title}, ${e.work}` : e.title);
/** Today's steps as kept on the phone, and the two not done yet that the offline steps tick. */
let kept: Kept[] = [];
let A = -1;
let B = -1;

/** A step of today by its place: Today and the offline page list them in the same order. */
const todayList = () =>
  page.locator('main section').filter({ has: page.locator('h2', { hasText: /^Today/ }) });
const entry = (i: number): Locator => todayList().locator('li.item').nth(i);
const stored = (key: string) => page.evaluate((k) => localStorage.getItem(k), key);
const doneOn = (id: string) =>
  value(`select coalesce(done_on::text, '') from public.task where id = $1`, [id]);
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

test('the app installs its service worker', async () => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  // The first visit installs it; from the next, it controls the page and keeps the offline page when asked.
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.waitForFunction(async () => Boolean(await caches.match('/offline')), null, { timeout: 20_000 });
});

test('Today is kept on the phone as she sees it, and nothing else of hers is', async () => {
  await expect.poll(() => stored('dagmawit.today.v3')).not.toBeNull();
  const snap = JSON.parse((await stored('dagmawit.today.v3'))!) as {
    ownerId: string;
    firstName: string;
    days: { heading: string; entries: Kept[] }[];
  };
  expect(snap.days[0]!.heading).toBe('Today');
  expect(snap.days[0]!.entries.map(headline)).toEqual(
    await todayList().locator('.item__title').allInnerTexts(),
  );
  expect(snap.ownerId).toBe(OWNER);
  expect(snap.firstName).toBe('Dagmawit');
  expect(
    await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('dagmawit'))),
  ).toEqual(['dagmawit.today.v3']);
  const cached = await page.evaluate(async () =>
    (await (await caches.open('dagmawit-shell-v3')).keys()).map((r) => new URL(r.url).pathname),
  );
  expect(cached).toContain('/offline');
  expect(cached.some((p) => p.endsWith('.css'))).toBe(true);
  expect(cached.some((p) => p.endsWith('.js'))).toBe(true);
  expect(
    cached.filter((p) => p === '/' || p.startsWith('/orders') || p.startsWith('/api')),
    'pages or data cached',
  ).toEqual([]);
  kept = snap.days[0]!.entries;
  A = kept.findIndex((e) => !e.done);
  B = kept.findIndex((e, i) => i > A && !e.done);
  expect(
    A >= 0 && B >= 0,
    `two steps not done today: ${kept.map((e) => `${e.title}:${e.done}`).join('|')}`,
  ).toBe(true);
});

test('with no signal, opening the app shows the day as of when it was kept', async () => {
  await signal(false);
  await page.goto('/');
  await page.waitForURL(/\/offline\?from=%2F$/);
  await page.locator('h1', { hasText: /^Today, as of \d{1,2}:\d\d [AP]M$/ }).waitFor();
  const t = await text(page);
  expect(t).toMatch(/no signal/i);
  expect(t).toContain('What you tick here waits on this phone');
  expect(await todayList().locator('.item__title').allInnerTexts()).toEqual(kept.map(headline));
  await inspect(page, 'offline day');
});

test('any page she opens with no signal leads to the day; Try again goes back to it', async () => {
  await page.goto(`/orders/${O1}`);
  await page.waitForURL(/\/offline\?from=/);
  await expect(page.getByRole('link', { name: 'Try again' })).toHaveAttribute('href', `/orders/${O1}`);
});

test('she ticks two steps done; each tick waits, and undo takes back only the last', async () => {
  await entry(A)
    .getByRole('button', { name: `Mark ${tickName(kept[A]!)} as done` })
    .click();
  await expect(entry(A)).toContainText('Waiting to be sent');
  await entry(B)
    .getByRole('button', { name: `Mark ${tickName(kept[B]!)} as done` })
    .click();
  await entry(B)
    .getByRole('button', { name: `${tickName(kept[B]!)}: done. Mark as not done` })
    .click();
  await expect(page.locator('main')).toContainText('3 ticks wait to be sent.');
  await entry(B)
    .getByRole('button', { name: `Undo the last change to ${tickName(kept[B]!)}` })
    .click();
  await expect(
    entry(B).getByRole('button', { name: `${tickName(kept[B]!)}: done. Mark as not done` }),
  ).toBeVisible();
  await expect(page.locator('main')).toContainText('2 ticks wait to be sent.');
  const ticks = JSON.parse((await stored('dagmawit.waiting.v2'))!) as { sawDone: boolean; done: boolean }[];
  expect(ticks.map((t) => `${t.sawDone}>${t.done}`)).toEqual(['false>true', 'false>true']);
});

test('the ticks survive closing and reopening the app with no signal', async () => {
  await page.goto('/');
  await page.waitForURL(/\/offline/);
  await expect(page.locator('main')).toContainText('2 ticks wait to be sent.');
  await expect(
    entry(A).getByRole('button', { name: `${tickName(kept[A]!)}: done. Mark as not done` }),
  ).toBeVisible();
  await inspect(page, 'offline with ticks');
});

test('nothing reached the server while there was no signal', async () => {
  expect(await doneOn(kept[A]!.id)).toBe('');
  expect(await doneOn(kept[B]!.id)).toBe('');
});

test('meanwhile, on her computer, she ticks the second step done herself', async ({ browser }) => {
  const computer = await signedInContext(browser, 'desktop');
  const p = await computer.newPage();
  await p.goto('/');
  await p
    .getByRole('button', { name: `Mark ${tickName(kept[B]!)} as done` })
    .first()
    .click();
  await p
    .getByRole('button', { name: `${tickName(kept[B]!)}: done. Mark as not done` })
    .first()
    .waitFor();
  await computer.close();
});

test('the signal comes back: the page says so, and opening the app sends what waited', async () => {
  await signal(true);
  await page.getByText('The signal is back.', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'Open the app' }).click();
  await page.waitForURL(`${env.baseURL}/`);
  const status = page.locator('.sync');
  await status.getByText('1 tick made without signal was saved.').waitFor();
  await expect(status.locator('.attention')).toHaveText('One was not saved:');
  await expect(status.locator('li')).toHaveText(
    `${tickName(kept[B]!)}. It was already ticked done on another device.`,
  );
  expect(await doneOn(kept[A]!.id)).toBe(today());
  expect(await doneOn(kept[B]!.id)).toBe(today());
  expect(JSON.parse((await stored('dagmawit.waiting.v2')) ?? '[]')).toEqual([]);
  await inspect(page, 'today after sending');
  await status.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.locator('.sync')).toHaveCount(0);
});

test('a waiting tick sent twice is not applied twice', async () => {
  const res = await page.evaluate(async (stepId) => {
    const r = await fetch('/api/steps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId, sawDone: false, done: true }),
    });
    return { status: r.status, body: (await r.json()) as { result: string; message: string } };
  }, kept[A]!.id);
  expect(res).toEqual({
    status: 200,
    body: { result: 'stale', message: 'It was already ticked done on another device.' },
  });
});

test('the replay endpoint keeps the rules: nonsense is refused, a stranger is turned away', async () => {
  errors.allow(/status of 400/);
  for (const body of ['{"stepId":"x"}', JSON.stringify({ stepId: kept[A]!.id, sawDone: true, done: true })]) {
    const status = await page.evaluate(
      async (b) =>
        (
          await fetch('/api/steps', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: b,
          })
        ).status,
      body,
    );
    expect(status, body).toBe(400);
  }
  errors.allow(null);
  // Without her session: refused, not redirected.
  const stranger = await fetch(`${env.baseURL}/api/steps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  expect(stranger.status).toBe(401);
  expect((await fetch(`${env.baseURL}/api/export`, { redirect: 'manual' })).status).toBe(401);
  // From another site: refused.
  const elsewhere = await fetch(`${env.baseURL}/api/steps`, {
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

test('a list kept on an earlier day is a reminder only: no ticks', async () => {
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('dagmawit.today.v3')!) as { day: string };
    s.day = '2026-01-05';
    localStorage.setItem('dagmawit.today.v3', JSON.stringify(s));
  });
  await signal(false);
  await page.goto('/calendar');
  await page.waitForURL(/\/offline/);
  await page.locator('h1', { hasText: /^Monday 5 January, as of / }).waitFor();
  expect(await text(page)).toContain('It is a reminder, so nothing can be ticked here.');
  await expect(page.getByRole('button', { name: /^Mark / })).toHaveCount(0);
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
  await page.locator('h2', { hasText: 'Your data' }).waitFor();
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
  await p.locator('h2', { hasText: 'Your data' }).waitFor();
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

test('the keyboard alone: take a job', async () => {
  // A date box takes day and month in the order of the browser's own language. Find which first, on a page of its
  // own, as she knows hers.
  await page.goto('/orders/new');
  await page.locator('body').focus();
  await tabTo(page.getByLabel('Delivery day'));
  await page.keyboard.type('01022030');
  const dayFirst = (await page.getByLabel('Delivery day').inputValue()) === '2030-02-01';

  await page.goto('/orders/new');
  await page.locator('body').focus();
  const client = page.getByLabel('For', { exact: true });
  await tabTo(client);
  // A closed list picks the option whose name she types.
  await page.keyboard.type('Hanna');
  await expect(client).toHaveValue(/[0-9a-f-]{36}/);
  const due = page.getByLabel('Delivery day');
  await tabTo(due);
  const [y, m, d] = inDays(20).split('-');
  await page.keyboard.type(dayFirst ? `${d}${m}${y}` : `${m}${d}${y}`);
  await expect(due).toHaveValue(inDays(20));
  await tabTo(page.getByLabel('What it is (optional)'));
  await page.keyboard.type('Netela shawl');
  // A step is a tap: Enter on its button, then its day.
  await tabTo(page.getByRole('button', { name: '+ Delivery', exact: true }));
  await page.keyboard.press('Enter');
  const day = page.locator('.step-row').getByLabel('Day', { exact: true });
  await tabTo(day);
  await page.keyboard.type(dayFirst ? `${d}${m}${y}` : `${m}${d}${y}`);
  await expect(day).toHaveValue(inDays(20));
  await tabTo(page.getByRole('button', { name: 'Save the job' }));
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
  await expect(page.locator('h1')).toHaveText('Hanna Tesfaye · Netela shawl');
  await expect(page.locator('li.item .item__title')).toHaveText(['Delivery']);
});

test('the keyboard alone: tick a step done', async () => {
  await page.goto('/');
  const tick = page.getByRole('button', { name: /^Mark .* as done$/ }).first();
  const title = (await tick.getAttribute('aria-label'))!.replace(/^Mark (.*) as done$/, '$1');
  await page.locator('body').focus();
  await tabTo(tick);
  await page.keyboard.press('Enter');
  await page
    .getByRole('button', { name: `${title}: done. Mark as not done` })
    .first()
    .waitFor();
});

test('a computer in dark mode still shows the light look, and Settings offers no dark mode', async ({
  browser,
}) => {
  const c = await signedInContext(browser, 'desktop-dark');
  const p = await c.newPage();
  await p.goto('/');
  const colours = await p.evaluate(() => ({
    page: getComputedStyle(document.body).backgroundColor,
    bar: getComputedStyle(document.querySelector('.nav')!).backgroundColor,
  }));
  expect(colours).toEqual({ page: 'rgb(250, 248, 245)', bar: 'rgb(15, 63, 0)' });
  await p.goto('/settings');
  await expect(p.getByRole('heading', { name: 'Appearance' })).toHaveCount(0);
  await c.close();
});

test('every screen passes axe with best practices, on a phone and on a computer in dark mode', async ({
  browser,
}) => {
  const screens = [
    '/',
    '/calendar',
    '/orders',
    `/orders/${O1}`,
    `/orders/${O1}/brief`,
    `/orders/${O1}/measurements`,
    `/orders/${O1}/history`,
    '/orders/new',
    '/library',
    '/library/new',
    '/clients',
    '/settings',
    '/settings/measurements',
    '/offline',
  ];
  for (const look of ['phone', 'desktop-dark'] as const) {
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
