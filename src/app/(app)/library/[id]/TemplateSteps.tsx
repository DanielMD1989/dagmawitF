'use client';

import { useActionState, useEffect, useRef } from 'react';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { TextField } from '@/components/fields';
import { idle } from '@/lib/action-state';
import { addTemplateStep, moveTemplateStep, removeTemplateStep, saveTemplateStep } from '../actions';

export function TemplateStepEditor({ step }: { step: { id: string; title: string } }) {
  const [state, action] = useActionState(saveTemplateStep, idle);
  return (
    <details className="disclosure disclosure--link" open={state.status === 'error' || undefined}>
      <summary>
        Rename or remove<span className="sr-only">: {step.title}</span>
      </summary>
      <div className="disclosure__panel">
        <form action={action} className="form" noValidate>
          <input type="hidden" name="id" value={step.id} />
          <TextField
            name="title"
            id={`t-${step.id}-title`}
            label="Step"
            state={state}
            saved={step.title}
            maxLength={120}
          />
          <FormNotice state={state} />
          <div className="btn-row">
            <SubmitButton>Save the step</SubmitButton>
          </div>
        </form>
        <ConfirmAction
          action={removeTemplateStep}
          fields={{ id: step.id }}
          label="Remove this step"
          question={`Remove “${step.title}” from the list? Jobs that already have it keep theirs.`}
          confirmLabel="Yes, remove"
        />
      </div>
    </details>
  );
}

/** Up and down buttons for one step of a list. */
export function MoveStep({
  step,
  first,
  last,
}: {
  step: { id: string; title: string };
  first: boolean;
  last: boolean;
}) {
  const [, action] = useActionState(moveTemplateStep, idle);
  return (
    <form action={action} className="btn-row">
      <input type="hidden" name="id" value={step.id} />
      <SubmitButton
        name="direction"
        value="up"
        className="btn btn--quiet btn--small"
        disabled={first}
        pendingText="…"
        aria-label={`Move ${step.title} earlier`}
      >
        ↑
      </SubmitButton>
      <SubmitButton
        name="direction"
        value="down"
        className="btn btn--quiet btn--small"
        disabled={last}
        pendingText="…"
        aria-label={`Move ${step.title} later`}
      >
        ↓
      </SubmitButton>
    </form>
  );
}

export function AddTemplateStep({ templateId }: { templateId: string }) {
  const [state, action] = useActionState(addTemplateStep, idle);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === 'success') form.current?.reset();
  }, [state]);
  return (
    <form ref={form} action={action} className="form" noValidate>
      <input type="hidden" name="template-id" value={templateId} />
      <TextField
        name="title"
        id="new-template-step"
        label="Add a step"
        state={state}
        maxLength={120}
        autoComplete="off"
      />
      <FormNotice state={state} />
      <div className="btn-row">
        <SubmitButton pendingText="Adding…">Add</SubmitButton>
      </div>
    </form>
  );
}
