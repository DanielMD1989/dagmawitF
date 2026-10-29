'use client';

import { useActionState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { SelectField } from '@/components/fields';
import { idle } from '@/lib/action-state';
import { makeProposal } from '@/app/(app)/plan/actions';
import { applyTemplate } from './actions';

/** Copies a template into a garment that has no tasks yet. */
export function ApplyTemplateForm({
  garmentId,
  garmentType,
  templates,
  suggested,
}: {
  garmentId: string;
  garmentType: string;
  templates: { id: string; name: string }[];
  suggested: string;
}) {
  const [state, action] = useActionState(applyTemplate, idle);
  return (
    <form action={action} className="form" noValidate>
      <input type="hidden" name="garment-id" value={garmentId} />
      <SelectField
        name="template-id"
        id={`template-for-${garmentId}`}
        label={`Template for ${garmentType}`}
        state={state}
        saved={suggested}
        options={[
          { value: '', label: 'Choose a template…' },
          ...templates.map((t) => ({ value: t.id, label: t.name })),
        ]}
        hint="Its tasks, links and preparation are copied into this order. Change anything afterwards."
      />
      <FormNotice state={state} />
      <div className="btn-row">
        <SubmitButton pendingText="Applying…">Apply template</SubmitButton>
      </div>
    </form>
  );
}

/** Plans the whole atelier and opens the proposal for review. */
export function MakeProposalForm({
  orderId,
  label = 'Make a proposal',
}: {
  /** The order to come back to; none when it is made from My Day. */
  orderId?: string;
  label?: string;
}) {
  const [state, action] = useActionState(makeProposal, idle);
  return (
    <form action={action} className="form">
      {orderId && <input type="hidden" name="order-id" value={orderId} />}
      <div className="btn-row">
        <SubmitButton pendingText="Planning…">{label}</SubmitButton>
      </div>
      <FormNotice state={state} />
    </form>
  );
}
