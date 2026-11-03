'use client';

import { useActionState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { TextField } from '@/components/fields';
import { idle } from '@/lib/action-state';
import { saveProfile } from './actions';

/** Her name, as the app greets her and as the others of the workspace see her. */
export function ProfileForm({ name }: { name: string }) {
  const [state, action] = useActionState(saveProfile, idle);
  return (
    <form action={action} className="form" noValidate>
      <TextField
        name="name"
        label="Your name"
        state={state}
        saved={name}
        autoComplete="name"
        maxLength={120}
      />
      <FormNotice state={state} />
      <div className="btn-row">
        <SubmitButton>Save the name</SubmitButton>
      </div>
    </form>
  );
}
