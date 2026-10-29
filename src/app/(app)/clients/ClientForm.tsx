'use client';

import { useActionState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { TextArea, TextField } from '@/components/fields';
import { idle } from '@/lib/action-state';
import { createClient, saveClient } from './actions';

/** Adds a client, or (with `client`) changes one. Only what planning and a phone call need. */
export function ClientForm({
  client,
}: {
  client?: { id: string; name: string; phone: string; notes: string };
}) {
  const [state, action] = useActionState(client ? saveClient : createClient, idle);
  return (
    <form action={action} className="form" noValidate>
      {client && <input type="hidden" name="id" value={client.id} />}
      <TextField
        name="name"
        label="Name"
        state={state}
        saved={client?.name}
        autoComplete="off"
        maxLength={120}
        required
      />
      <TextField
        name="phone"
        label="Phone (optional)"
        state={state}
        saved={client?.phone}
        type="tel"
        autoComplete="off"
        inputMode="tel"
        maxLength={30}
        hint="Digits, spaces and + ( ) . - only."
      />
      <TextArea
        name="notes"
        label="Notes (optional)"
        state={state}
        saved={client?.notes}
        rows={3}
        maxLength={2000}
        hint="Anything to remember about her: how she likes to be reached, allergies to fabric, her sister who pays."
      />
      <FormNotice state={state} />
      <div className="btn-row">
        <SubmitButton>{client ? 'Save details' : 'Add client'}</SubmitButton>
      </div>
    </form>
  );
}
