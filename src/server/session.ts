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

/**
 * The workspace she works in (decision 0081): her own, or the one she was added to. Her pictures are kept in its
 * folder. Asked once per request.
 */
export const getWorkspaceId = cache(async (): Promise<string> => {
  const supabase = await createSupabase();
  const { data, error } = await supabase.rpc('my_workspace');
  if (error || typeof data !== 'string')
    throw new Error(`Could not read the workspace: ${error?.message ?? 'no id'}`);
  return data;
});
