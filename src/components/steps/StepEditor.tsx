'use client';

import { useActionState } from 'react';
import { removeStep, saveStep } from '@/app/(app)/steps/actions';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { idle } from '@/lib/action-state';
import { StepFields } from './AddStepForm';

/** Changes one step of a job: its title, its days, its time; or removes it. */
export function StepEditor({
  orderId,
  step,
}: {
  orderId: string;
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
  return (
    <details className="disclosure disclosure--link" open={state.status === 'error' || undefined}>
      <summary>
        Change<span className="sr-only">: {step.title}</span>
      </summary>
      <div className="disclosure__panel">
        <form action={action} className="form" noValidate>
          <input type="hidden" name="step-id" value={step.id} />
          <input type="hidden" name="order-id" value={orderId} />
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
          />
          <FormNotice state={state} />
          <div className="btn-row">
            <SubmitButton>Save the step</SubmitButton>
          </div>
        </form>
        <ConfirmAction
          action={removeStep}
          fields={{ 'step-id': step.id, 'order-id': orderId }}
          label="Remove this step"
          question={`Remove “${step.title}”?`}
          confirmLabel="Yes, remove"
        />
      </div>
    </details>
  );
}
