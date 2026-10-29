import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createSupabase } from './supabase';

export interface SessionUser {
  id: string;
  email: string | null;
}

/**
 * Who is signed in, checked by verifying the session token's signature (not by trusting the
 * cookie). Cached for the length of one request.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createSupabase();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims.sub) return null;
  const email = data.claims.email;
  return { id: data.claims.sub, email: typeof email === 'string' ? email : null };
});

/** For pages and actions that need her. Sends anyone else to the sign-in page. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/sign-in');
  return user;
}
