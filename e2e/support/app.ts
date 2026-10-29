import AxeBuilder from '@axe-core/playwright';
import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { env, ZONE } from './env';

/** Her signed-in session, made once by the global setup. */
export const STATE = `${import.meta.dirname}/../.auth/her.json`;
/** Her password, made afresh by the global setup for each run. */
export const PASSWORD_FILE = `${import.meta.dirname}/../.auth/password.txt`;

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESKTOP = { viewport: { width: 1280, height: 900 } };

export type Look = 'phone' | 'desktop' | 'phone-night' | 'desktop-night';

/** A signed-in browser, the way she uses the app: on her phone by default, in her time zone. */
export async function signedInContext(browser: Browser, look: Look = 'phone'): Promise<BrowserContext> {
  const night = look.endsWith('night');
  const ctx = await browser.newContext({
    ...(look.startsWith('phone') ? PHONE : DESKTOP),
    baseURL: env.baseURL,
    storageState: STATE,
    timezoneId: ZONE,
    locale: 'en-GB',
    colorScheme: night ? 'dark' : 'light',
    acceptDownloads: true,
  });
  if (night) await ctx.addCookies([{ name: 'dagmawit-theme', value: 'night', url: env.baseURL }]);
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
export async function text(page: Page): Promise<string> {
  return (await page.locator('main').innerText()).replace(/\s+/g, ' ');
}

const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The list item whose title is exactly `title`. */
export function item(page: Page, title: string): Locator {
  return page
    .locator('li.item')
    .filter({ has: page.locator('.item__title', { hasText: new RegExp(`^${esc(title)}$`) }) })
    .first();
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

/** A task on My Day: its chip. */
export async function chipOf(page: Page, title: string): Promise<string> {
  return item(page, title).locator('.item__head > .chip').innerText();
}

/** Waits until the list item titled `title` shows `words`. */
export async function until(page: Page, title: string, words: string): Promise<void> {
  await expect(item(page, title)).toContainText(words);
}
