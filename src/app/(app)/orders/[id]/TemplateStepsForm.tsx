'use client';

import { useActionState } from 'react';
import { addTemplateSteps } from '@/app/(app)/steps/actions';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { SelectField } from '@/components/fields';
import { idle } from '@/lib/action-state';

/** Adds the steps of one of her lists to the job, with no day yet. */
export function TemplateStepsForm({
  orderId,
  templates,
  preferred,
}: {
  orderId: string;
  templates: { id: string; label: string }[];
  preferred: string | null;
}) {
  const [state, action] = useActionState(addTemplateSteps, idle);
  return (
    <form action={action} className="form" noValidate>
      <input type="hidden" name="order-id" value={orderId} />
      <SelectField
        name="template"
        label="List"
        state={state}
        saved={preferred ?? templates[0]?.id ?? ''}
        options={templates.map((t) => ({ value: t.id, label: t.label }))}
        hint="Its steps are added with no day yet: give each its day with Change."
      />
      <FormNotice state={state} />
      <div className="btn-row">
        <SubmitButton pendingText="Adding…">Add these steps</SubmitButton>
      </div>
    </form>
  );
}
