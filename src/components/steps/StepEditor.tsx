'use client';

import { useActionState, useRef } from 'react';
import { removeStep, saveStep } from '@/app/(app)/steps/actions';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FormNotice } from '@/components/FormNotice';
import { useCloseOnSaved } from '@/components/Sheet';
import { SubmitButton } from '@/components/SubmitButton';
import { idle } from '@/lib/action-state';
import { StepFields } from './AddStepForm';

/** Removes a step (not an order's Delivery), asking first. In a step's sheet, on its own, in the warning colour. */
export function RemoveStep({
  stepId,
  orderId,
  title,
}: {
  stepId: string;
  orderId: string | null;
  title: string;
}) {
  return (
    <ConfirmAction
      action={removeStep}
      fields={orderId ? { 'step-id': stepId, 'order-id': orderId } : { 'step-id': stepId }}
      label="Remove this step"
      question={`Remove “${title}”?`}
      confirmLabel="Yes, remove"
    />
  );
}

/** Changes one step: its title, its days, its time. An order's Delivery: its day and time. */
export function StepEditor({
  orderId,
  step,
  delivery = false,
}: {
  orderId: string | null;
  /** The order's own Delivery (decision 0096): kept by its name, on its one day, never removed. */
  delivery?: boolean;
  step: {
    id: string;
    title: string;
    onDay: string | null;
    untilDay: string | null;
    startsAt: string | null;
    endsAt: string | null;
  };
}) {
  const [state, action] = useActionState(saveStep, idle);
  const form = useRef<HTMLFormElement>(null);
  useCloseOnSaved(form, state);
  return (
    <details className="disclosure disclosure--row" open={state.status === 'error' || undefined}>
      <summary>
        {delivery ? 'Change the delivery day or time' : 'Change day or time'}
        <span className="sr-only">: {step.title}</span>
      </summary>
      <div className="disclosure__panel">
        <form ref={form} action={action} className="form" noValidate>
          <input type="hidden" name="step-id" value={step.id} />
          {orderId && <input type="hidden" name="order-id" value={orderId} />}
          <StepFields
            state={state}
            idPrefix={`step-${step.id}`}
            saved={{
              title: step.title,
              day: step.onDay ?? '',
              until: step.untilDay ?? '',
              from: step.startsAt ?? '',
              to: step.endsAt ?? '',
            }}
            delivery={delivery}
          />
          <FormNotice state={state} />
          <div className="btn-row">
            <SubmitButton>Save the step</SubmitButton>
          </div>
        </form>
      </div>
    </details>
  );
}
