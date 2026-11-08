'use client';

import { useActionState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { TextArea, TextField } from '@/components/fields';
import { idle } from '@/lib/action-state';
import { saveClient } from './actions';

/** Changes a client's details: only what a job and a phone call need. A new one is added with NewClientForm. */
export function ClientForm({
  client,
}: {
  client: { id: string; name: string; phone: string; notes: string };
}) {
  const [state, action] = useActionState(saveClient, idle);
  return (
    <form action={action} className="form" noValidate>
      <input type="hidden" name="id" value={client.id} />
      <TextField
        name="name"
        label="Name"
        state={state}
        saved={client.name}
        autoComplete="off"
        maxLength={120}
        required
      />
      <TextField
        name="phone"
        label="Phone (optional)"
        state={state}
        saved={client.phone}
        type="tel"
        placeholder="09…"
        autoComplete="off"
        inputMode="tel"
        maxLength={30}
      />
      <TextArea
        name="notes"
        label="Notes (optional)"
        state={state}
        saved={client.notes}
        rows={3}
        maxLength={2000}
      />
      <FormNotice state={state} />
      <div className="btn-row">
        <SubmitButton className="btn btn--main">Save details</SubmitButton>
      </div>
    </form>
  );
}
