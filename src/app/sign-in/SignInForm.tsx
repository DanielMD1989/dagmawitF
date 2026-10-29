'use client';

import { useActionState, useState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { signIn, type SignInState } from './actions';

const initial: SignInState = {
  status: 'idle',
  message: '',
  errors: {},
  values: null,
  step: 'email',
  email: '',
};

export function SignInForm() {
  // Changing the key throws the form away and starts again from the email step.
  const [attempt, setAttempt] = useState(0);
  return <Steps key={attempt} onRestart={() => setAttempt((n) => n + 1)} />;
}

function Steps({ onRestart }: { onRestart: () => void }) {
  const [state, action] = useActionState(signIn, initial);

  if (state.step === 'email') {
    return (
      <form action={action} className="form" noValidate>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            className="input"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            autoFocus
            defaultValue={state.email}
            aria-invalid={Boolean(state.errors.email)}
            aria-describedby={state.errors.email ? 'email-error' : undefined}
          />
          {state.errors.email && (
            <p id="email-error" className="error">
              {state.errors.email}
            </p>
          )}
        </div>
        <FormNotice state={state} />
        <input type="hidden" name="intent" value="request" />
        <SubmitButton pendingText="Sending…">Send me a code</SubmitButton>
      </form>
    );
  }

  return (
    <form action={action} className="form" noValidate>
      <input type="hidden" name="email" value={state.email} />
      <div className="field">
        <label htmlFor="code">Code from the email</label>
        <input
          id="code"
          name="code"
          className="input input--code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={10}
          required
          autoFocus
          aria-invalid={Boolean(state.errors.code)}
          aria-describedby="code-hint"
        />
        <p id="code-hint" className="hint">
          Sent to {state.email}.
        </p>
        {state.errors.code && <p className="error">{state.errors.code}</p>}
      </div>
      <FormNotice state={state} />
      <div className="btn-row">
        <SubmitButton name="intent" value="verify" pendingText="Working…">
          Sign in
        </SubmitButton>
        <SubmitButton
          name="intent"
          value="request"
          className="btn btn--quiet"
          pendingText="Working…"
          formNoValidate
        >
          Send a new code
        </SubmitButton>
      </div>
      <button type="button" className="link-button" onClick={onRestart}>
        Use a different email
      </button>
    </form>
  );
}
