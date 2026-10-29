'use server';

import { redirect } from 'next/navigation';
import { failure, type ActionState } from '@/lib/action-state';
import { parseSignIn } from '@/domain/passwords';
import { createSupabase } from '@/server/supabase';

/**
 * Signs her in with her email and password (decision 0065). Accounts are made by hand; this form can never make
 * one. A wrong email and a wrong password get the same answer, so the form cannot be used to find out who has an
 * account.
 */
export async function signIn(_previous: ActionState, formData: FormData): Promise<ActionState> {
  // Only the email is handed back if she has to try again: a password is never sent back to the page.
  const typed = { email: String(formData.get('email') ?? '') };
  const parsed = parseSignIn(formData);
  if (!parsed.ok) return failure('Enter your email and password.', parsed.errors, typed);

  const supabase = await createSupabase();
  const { error } = await supabase.auth.signInWithPassword(parsed.value);
  if (error) {
    if (error.status === 429 || error.code === 'over_request_rate_limit') {
      return failure('Too many tries. Wait a few minutes, then try again.', {}, typed);
    }
    if (error.code !== 'invalid_credentials') {
      console.error(`Sign-in failed [${error.code ?? error.status ?? 'no code'}]: ${error.message}`);
    }
    return failure('That email and password do not match. Check both, then try again.', {}, typed);
  }
  redirect('/'); // outside any try/catch: redirect works by throwing
}
