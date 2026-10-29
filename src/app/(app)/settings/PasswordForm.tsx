'use client';

import { useActionState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { MIN_PASSWORD } from '@/domain/passwords';
import { idle } from '@/lib/action-state';
import { changePassword } from './actions';

/** Settings → Account → Change the password (decision 0065). */
export function PasswordForm() {
  const [state, action] = useActionState(changePassword, idle);
  const field = (name: string, label: string, autoComplete: string, hint?: string) => {
    const error = state.errors[name];
    return (
      <div className="field">
        <label htmlFor={name}>{label}</label>
        <input
          id={name}
          name={name}
          type="password"
          className="input"
          autoComplete={autoComplete}
          required
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${name}-error` : hint ? `${name}-hint` : undefined}
        />
        {error ? (
          <p id={`${name}-error`} className="error">
            {error}
          </p>
        ) : (
          hint && (
            <p id={`${name}-hint`} className="hint">
              {hint}
            </p>
          )
        )}
      </div>
    );
  };
  // React empties the form after every answer, and passwords are never sent back: nothing typed stays in the page.
  return (
    <form
      action={action}
      className="form"
      noValidate
      key={state.status === 'success' ? state.message : 'form'}
    >
      {field('current-password', 'Password you use now', 'current-password')}
      {field('new-password', 'New password', 'new-password', `At least ${MIN_PASSWORD} characters.`)}
      {field('repeat-password', 'New password again', 'new-password')}
      <FormNotice state={state} />
      <div className="btn-row">
        <SubmitButton className="btn btn--quiet" pendingText="Changing…">
          Change the password
        </SubmitButton>
      </div>
    </form>
  );
}
