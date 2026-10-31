'use client';

import { useActionState, useEffect, useRef } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { TextField } from '@/components/fields';
import { idle } from '@/lib/action-state';
import { addPerson } from './actions';

/** Settings → People → add someone by the email of their account (decision 0081). */
export function AddPersonForm() {
  const [state, action] = useActionState(addPerson, idle);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === 'success') form.current?.reset();
  }, [state]);
  return (
    <form ref={form} action={action} className="form" noValidate>
      <TextField
        name="email"
        label="Their email"
        type="email"
        inputMode="email"
        autoComplete="off"
        state={state}
        hint="The email of an account already made for them. They sign in with it as usual."
      />
      <FormNotice state={state} />
      <div className="btn-row">
        <SubmitButton pendingText="Adding…">Add</SubmitButton>
      </div>
    </form>
  );
}
