import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { env } from './env';

/**
 * A Supabase client that acts as the signed-in designer. It carries her session cookie, so
 * every query runs under row-level security as her. Create one per request; never share it.
 * This app has no browser-side database client: all data goes through the server.
 */
export async function createSupabase() {
  const cookieStore = await cookies();
  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = env();

  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(list) {
        try {
          for (const { name, value, options } of list) cookieStore.set(name, value, options);
        } catch {
          // A Server Component cannot set cookies. The proxy refreshes the session on every
          // request, so nothing is lost.
        }
      },
    },
  });
}
