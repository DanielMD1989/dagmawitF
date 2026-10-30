'use client';

import { useActionState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { SelectField, TextArea, TextField } from '@/components/fields';
import { idle } from '@/lib/action-state';
import { JOB_KINDS, KIND_WORDS, type JobKind } from '@/domain/jobs/kinds';
import { createTemplate, saveTemplate } from './actions';

/** A template's own words: its name, the kind of job it is for, notes. New, or saved. */
export function TemplateForm({
  template,
}: {
  template?: { id: string; name: string; kind: JobKind; notes: string };
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
          hint="For example: Bridal gown, Habesha kemis. A new job for a garment of this name starts with it."
        />
        <SelectField
          name="kind"
          label="For which kind of job"
          state={state}
          saved={template?.kind ?? 'new_order'}
          options={JOB_KINDS.map((k) => ({ value: k, label: KIND_WORDS[k].label }))}
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
