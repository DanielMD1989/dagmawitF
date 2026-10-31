/**
 * Where the browser suite runs (docs/testing.md). The defaults are the local Supabase stack (`supabase start`) and
 * the app on port 3000.
 */
export const env = {
  baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000',
  supabaseUrl: process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321',
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  databaseUrl: process.env.E2E_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  /** The account the suite creates afresh on every run, and deletes first if it exists. */
  email: process.env.E2E_EMAIL ?? 'dagmawit.e2e@example.test',
  /** A second account, made the same way: the person she adds to her workspace (decision 0081). */
  helperEmail: process.env.E2E_HELPER_EMAIL ?? 'hanna.e2e@example.test',
};

/** Her time zone: every day the suite types or expects is a day on her wall clock. */
export const ZONE = 'Africa/Addis_Ababa';

export function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date());
}

export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export function inDays(n: number): string {
  return addDays(today(), n);
}

export function mondayOf(iso: string): string {
  return addDays(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7));
}

/** The suite deletes and recreates its account: never let it near a database that is not a local one by mistake. */
export function assertLocal(): void {
  if (process.env.E2E_ALLOW_REMOTE === '1') return;
  for (const url of [env.supabaseUrl, env.databaseUrl, env.baseURL]) {
    const host = new URL(url).hostname;
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
      throw new Error(
        `The browser suite deletes and recreates ${env.email}. It runs only against local services, and ${url} is not ` +
          'one. Set E2E_ALLOW_REMOTE=1 only for a throwaway project.',
      );
    }
  }
}
