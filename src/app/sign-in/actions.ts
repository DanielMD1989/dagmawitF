'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { failure, type ActionState } from '@/lib/action-state';
import { createSupabase } from '@/server/supabase';

export interface SignInState extends ActionState {
  step: 'email' | 'code';
  email: string;
}

const emailSchema = z.email();
const codeSchema = z.string().regex(/^\d{6,10}$/);

/**
 * One action for both steps of signing in, chosen by the button pressed (`intent`):
 *   request: send a one-time code to her email
 *   verify:  check the code she typed and start her session
 *
 * We use a typed code, not a link, on purpose: a link opened from email lands in the phone's
 * browser, and an app installed on the home screen cannot see that browser's session.
 */
export async function signIn(previous: SignInState, formData: FormData): Promise<SignInState> {
  const intent = String(formData.get('intent') ?? '');
  const rawEmail = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();

  const email = emailSchema.safeParse(rawEmail);
  if (!email.success) {
    return {
      ...failure('Enter the email address this account was created with.', {
        email: 'Enter a valid email address.',
      }),
      step: 'email',
      email: rawEmail,
    };
  }

  const supabase = await createSupabase();

  if (intent === 'verify') {
    const code = codeSchema.safeParse(String(formData.get('code') ?? '').replace(/\s/g, ''));
    if (!code.success) {
      return {
        ...failure('Enter the code from the email.', { code: 'The code is made of digits only.' }),
        step: 'code',
        email: email.data,
      };
    }
    const { error } = await supabase.auth.verifyOtp({ email: email.data, token: code.data, type: 'email' });
    if (error) {
      return {
        ...failure('That code did not work. Check the newest email, or ask for a new code.'),
        step: 'code',
        email: email.data,
      };
    }
    redirect('/'); // outside any try/catch: redirect works by throwing
  }

  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    options: { shouldCreateUser: false },
  });
  if (
    error &&
    (error.status === 429 ||
      error.code === 'over_email_send_rate_limit' ||
      error.code === 'over_request_rate_limit')
  ) {
    return {
      ...failure('Too many codes were asked for. Wait a minute, then try again.'),
      step: previous.step,
      email: email.data,
    };
  }
  if (error) {
    // Deliberately not shown: whether this address has an account. Saying so would let anyone check.
    console.error(`Sign-in code request failed [${error.code ?? error.status ?? 'no code'}]`);
  }
  return {
    status: 'success',
    message: `If ${email.data} has an account, a code is on its way. It can take a minute.`,
    errors: {},
    values: null,
    step: 'code',
    email: email.data,
  };
}
