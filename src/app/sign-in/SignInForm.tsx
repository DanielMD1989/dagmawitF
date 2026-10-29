'use client';

import { useActionState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { fieldValue, idle } from '@/lib/action-state';
import { signIn } from './actions';

export function SignInForm() {
  const [state, action] = useActionState(signIn, idle);
  return (
    <form action={action} className="form" noValidate>
      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          className="input"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          autoFocus
          defaultValue={fieldValue(state, 'email', '')}
          aria-invalid={Boolean(state.errors.email)}
          aria-describedby={state.errors.email ? 'email-error' : undefined}
        />
        {state.errors.email && (
          <p id="email-error" className="error">
            {state.errors.email}
          </p>
        )}
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          autoComplete="current-password"
          required
          aria-invalid={Boolean(state.errors.password)}
          aria-describedby={state.errors.password ? 'password-error' : 'password-hint'}
        />
        {state.errors.password ? (
          <p id="password-error" className="error">
            {state.errors.password}
          </p>
        ) : (
          <p id="password-hint" className="hint">
            Forgotten it? The person who set up the app can give you a new one.
          </p>
        )}
      </div>
      <FormNotice state={state} />
      <SubmitButton pendingText="Signing in…">Sign in</SubmitButton>
    </form>
  );
}
