'use client';

import { useActionState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { TextArea, TextField } from '@/components/fields';
import { idle } from '@/lib/action-state';
import { createTemplate, saveTemplate } from './actions';

/** A list's own words: its name and notes. New, or saved. */
export function TemplateForm({ template }: { template?: { id: string; name: string; notes: string } }) {
  const [state, action] = useActionState(template ? saveTemplate : createTemplate, idle);
  return (
    <form action={action} className="form" noValidate>
      {template && <input type="hidden" name="id" value={template.id} />}
      <TextField
        name="name"
        label="Name"
        state={state}
        saved={template?.name ?? ''}
        maxLength={80}
        autoComplete="off"
        required
        hint="For example: Bridal gown, Habesha kemis, Bazaar."
      />
      <TextArea
        name="notes"
        label="Notes (optional)"
        state={state}
        saved={template?.notes ?? ''}
        rows={3}
        maxLength={2000}
      />
      <FormNotice state={state} />
      <div className="btn-row">
        <SubmitButton pendingText={template ? 'Saving…' : 'Creating…'}>
          {template ? 'Save' : 'Create the list'}
        </SubmitButton>
      </div>
    </form>
  );
}
