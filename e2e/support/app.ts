import AxeBuilder from '@axe-core/playwright';
import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { env, ZONE } from './env';

/** Her signed-in session, made once by the global setup. */
export const STATE = `${import.meta.dirname}/../.auth/her.json`;
/** Her password, made afresh by the global setup for each run. */
export const PASSWORD_FILE = `${import.meta.dirname}/../.auth/password.txt`;
/** The second account's saved sign-in (decision 0081). */
export const HELPER_STATE = `${import.meta.dirname}/../.auth/helper.json`;

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESKTOP = { viewport: { width: 1280, height: 900 } };

/** A phone or a computer; "-dark" is one set to dark mode, where the app still shows its light look (decision 0073). */
export type Look = 'phone' | 'desktop' | 'phone-dark' | 'desktop-dark';

/** A signed-in browser, the way she uses the app: on her phone by default, in her time zone. */
export async function signedInContext(
  browser: Browser,
  look: Look = 'phone',
  who: 'her' | 'helper' = 'her',
): Promise<BrowserContext> {
  const dark = look.endsWith('dark');
  const ctx = await browser.newContext({
    ...(look.startsWith('phone') ? PHONE : DESKTOP),
    baseURL: env.baseURL,
    storageState: who === 'her' ? STATE : HELPER_STATE,
    timezoneId: ZONE,
    locale: 'en-GB',
    colorScheme: dark ? 'dark' : 'light',
    acceptDownloads: true,
  });
  return ctx;
}

/**
 * Collects what went wrong in the page: uncaught errors and console errors. `allow` names errors a test causes on
 * purpose (a 404 for a deleted order, a request sent with no signal).
 */
export function watchErrors(page: Page): { list: string[]; allow: (pattern: RegExp | null) => void } {
  const list: string[] = [];
  let allowed: RegExp | null = null;
  page.on('pageerror', (e) => list.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (allowed?.test(m.text())) return;
    list.push(`console @${page.url().replace(env.baseURL, '')}: ${m.text()}`);
  });
  return { list, allow: (pattern) => void (allowed = pattern) };
}

/** The main content's text, spaces squeezed. */
/**
 * Waits until the page she went to is on screen. After a tap the address changes at once and the loading screen
 * stands in for the page (decision 0077); reading text in that moment would read the loading screen.
 */
export async function ready(page: Page): Promise<void> {
  await expect(page.locator('.loading')).toHaveCount(0);
}

export async function text(page: Page): Promise<string> {
  await ready(page);
  return (await page.locator('main').innerText()).replace(/\s+/g, ' ');
}

/** The texts of a list on the page, once the page is there. */
export async function texts(list: Locator): Promise<string[]> {
  await ready(list.page());
  return list.allInnerTexts();
}

const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The list item whose title, or whose step, is exactly `title`, on the page or inside one part of it. On Today a step
 * of a job is shown under the job's name (her Task 7); `work` picks the job when several have that step.
 */
export function item(scope: Page | Locator, title: string, work?: string): Locator {
  const page = 'goto' in scope ? scope : scope.page();
  let found = scope
    .locator('li.item')
    .filter({ has: page.locator('.item__title, .item__step', { hasText: new RegExp(`^${esc(title)}$`) }) });
  if (work)
    found = found.filter({ has: page.locator('.item__title', { hasText: new RegExp(`^${esc(work)}$`) }) });
  return found.first();
}

/** A step as the new-job form takes it: what, its day, and a time if it has one (decision 0079). */
export interface NewStep {
  title: string;
  day?: string;
  from?: string;
}

/**
 * Fills the new-job form as she does (decision 0068): who it is for, what it is, the day, then a tap on each usual
 * step (or "Another step" for one of her own) and its day and time. Does not save.
 */
export async function fillNewJob(
  page: Page,
  job: {
    client?: string | { name: string; phone?: string } | 'event';
    title?: string;
    due: string;
    /** The delivery's time, beside its day: it goes on the calendar as a Delivery step. */
    dueAt?: string;
    brief?: string;
    steps?: NewStep[];
  },
): Promise<void> {
  // An event is made from "New event" (decision 0084). Otherwise, already on the order form (perhaps opened from a
  // client's page, with her chosen): fill it as it is.
  const url = new URL(page.url());
  if (job.client === 'event') {
    if (url.pathname !== '/orders/new' || url.searchParams.get('event') !== '1')
      await page.goto('/orders/new?event=1');
  } else if (url.pathname !== '/orders/new' || url.searchParams.get('event') === '1')
    await page.goto('/orders/new');
  const forWhom = page.getByLabel('For', { exact: true });
  if (job.client === 'event') {
    // No customer is asked.
  } else if (typeof job.client === 'object') {
    if ((await forWhom.locator('option').count()) > 0)
      await forWhom.selectOption({ label: '+ A new client' });
    await page.getByLabel("Client's name").fill(job.client.name);
    if (job.client.phone) await page.getByLabel('Phone (optional)').fill(job.client.phone);
  } else if (job.client) await forWhom.selectOption({ label: job.client });
  if (job.title !== undefined)
    await page
      .getByLabel(job.client === 'event' ? 'Name of the event' : 'What it is (optional)')
      .fill(job.title);
  if (job.brief) await page.getByLabel('Design brief (optional)').fill(job.brief);
  await page.getByLabel(job.client === 'event' ? 'Event day' : 'Delivery day').fill(job.due);
  if (job.dueAt) await page.locator('#due-at').fill(job.dueAt);
  await buildSteps(page.locator('main'), job.steps ?? []);
}

/** Taps each usual step (or "Another step" for one of her own) in the step buttons within `scope`, and gives its day and time. */
export async function buildSteps(scope: Locator, steps: NewStep[]): Promise<void> {
  for (const step of steps) {
    const usual = scope.getByRole('group', { name: 'Your usual steps' }).getByRole('button', {
      name: `+ ${step.title}`,
      exact: true,
    });
    const rows = scope.locator('.step-row');
    const before = await rows.count();
    if ((await usual.count()) > 0) await usual.click();
    else {
      await scope.getByRole('button', { name: '+ Another step', exact: true }).click();
      await rows.nth(before).getByRole('combobox').fill(step.title);
    }
    const row = rows.nth(before);
    if (step.day) await row.getByLabel('Day', { exact: true }).fill(step.day);
    if (step.from) await row.getByLabel('Time (optional)').fill(step.from);
  }
}

/**
 * Adds steps on an order's page with its step buttons (decision 0085), opening "Add steps" when the order has some
 * already, and waits until they are on it. Returns the form, for what it then says.
 */
export async function addSteps(page: Page, steps: NewStep[], wait = true): Promise<Locator> {
  // Only once the page is there, not its loading screen: open by itself, or behind "Add steps".
  await ready(page);
  const main = page.locator('main');
  const form = main.getByRole('form', { name: 'Add steps' });
  if (!(await form.isVisible())) await open(main, 'Add steps');
  await buildSteps(form, steps);
  await form.getByRole('button', { name: 'Add these steps' }).click();
  if (wait) for (const s of steps) await item(page, s.title).waitFor();
  return form;
}

/** Opens the disclosure whose summary starts with `summary`, inside `scope`, and returns it. */
export async function open(scope: Locator, summary: string): Promise<Locator> {
  const d = scope
    .locator('details', { has: scope.page().locator('summary', { hasText: new RegExp(`^${esc(summary)}`) }) })
    .first();
  if (!(await d.evaluate((el) => (el as HTMLDetailsElement).open)))
    await d.locator('summary').first().click();
  return d;
}

/**
 * After a form's answer arrives, React resets the form to what the server says, a moment after the message shows.
 * A person takes far longer than that to type again; a script does not, so it waits for the form to be quiet.
 */
export async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => !document.querySelector('button[type=submit]:disabled'));
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 50)))),
  );
}

/** The checks every screen must pass: no sideways scroll, and no accessibility violations (WCAG 2.2 A and AA). */
export async function inspect(page: Page, label: string, bestPractice = false): Promise<void> {
  await ready(page);
  // Next.js streams a dynamic page's <title> after its body; check the page once it has arrived.
  await page.waitForFunction(() => document.title.length > 0, null, { timeout: 5000 }).catch(() => undefined);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${label}: wider than the screen`).toBeLessThanOrEqual(0);
  const tags = [
    'wcag2a',
    'wcag2aa',
    'wcag21a',
    'wcag21aa',
    'wcag22aa',
    ...(bestPractice ? ['best-practice'] : []),
  ];
  const result = await new AxeBuilder({ page }).withTags(tags).analyze();
  expect(
    result.violations.map((v) => `${v.id}(${v.nodes.length}): ${v.nodes[0]?.html.slice(0, 120)}`),
    `${label}: accessibility`,
  ).toEqual([]);
}

/** Waits until the list item titled `title` shows `words`. */
export async function until(page: Page, title: string, words: string): Promise<void> {
  await expect(item(page, title)).toContainText(words);
}
