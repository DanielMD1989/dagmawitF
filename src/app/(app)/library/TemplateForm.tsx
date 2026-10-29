'use client';

import { useActionState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { TextArea, TextField } from '@/components/fields';
import { idle } from '@/lib/action-state';
import { createTemplate, saveTemplate } from './actions';

/** A template's own words. New, or saved. */
export function TemplateForm({
  template,
}: {
  template?: { id: string; name: string; garmentType: string; notes: string };
}) {
  const [state, action] = useActionState(template ? saveTemplate : createTemplate, idle);
  return (
    <form action={action} className="form" noValidate>
      {template && <input type="hidden" name="id" value={template.id} />}
      <div className="form-grid form-grid--2">
        <TextField
          name="name"
          label="Name"
          state={state}
          saved={template?.name ?? ''}
          maxLength={80}
          autoComplete="off"
          required
          hint="For example: Bridal gown, Bridal gown with train, Habesha kemis."
        />
        <TextField
          name="garment-type"
          label="For which garment"
          state={state}
          saved={template?.garmentType ?? ''}
          maxLength={80}
          autoComplete="off"
          required
          hint="Offered first when an order has this garment."
        />
      </div>
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
          {template ? 'Save' : 'Create template'}
        </SubmitButton>
      </div>
    </form>
  );
}
