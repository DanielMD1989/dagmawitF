'use client';

import { useActionState, useEffect, useRef } from 'react';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { TextField } from '@/components/fields';
import { fieldTicked, idle, type ActionState } from '@/lib/action-state';
import { addTemplateStep, removeTemplateStep, saveTemplateStep } from '../actions';

interface Saved {
  title: string;
  daysBefore: number;
  spanDays: number;
  withClient: boolean;
}

function Fields({ state, idPrefix, saved }: { state: ActionState; idPrefix: string; saved: Saved | null }) {
  return (
    <>
      <TextField
        name="title"
        id={`${idPrefix}-title`}
        label="Step"
        state={state}
        saved={saved?.title ?? ''}
        maxLength={120}
        autoComplete="off"
      />
      <div className="form-grid form-grid--pair">
        <TextField
          name="days-before"
          id={`${idPrefix}-before`}
          label="Days before the job’s day"
          type="number"
          inputMode="numeric"
          min={0}
          max={365}
          state={state}
          saved={saved ? String(saved.daysBefore) : ''}
          hint="0 is the day itself."
        />
        <TextField
          name="span-days"
          id={`${idPrefix}-span`}
          label="For how many days"
          type="number"
          inputMode="numeric"
          min={1}
          max={60}
          state={state}
          saved={saved ? String(saved.spanDays) : '1'}
        />
      </div>
      <label className="check">
        <input
          type="checkbox"
          name="with-client"
          defaultChecked={fieldTicked(state, 'with-client', saved?.withClient ?? false)}
        />
        With the client (a fitting, the delivery): it can have a time
      </label>
    </>
  );
}

export function TemplateStepEditor({ step }: { step: Saved & { id: string } }) {
  const [state, action] = useActionState(saveTemplateStep, idle);
  return (
    <details className="disclosure disclosure--link" open={state.status === 'error' || undefined}>
      <summary>
        Change<span className="sr-only">: {step.title}</span>
      </summary>
      <div className="disclosure__panel">
        <form action={action} className="form" noValidate>
          <input type="hidden" name="id" value={step.id} />
          <Fields state={state} idPrefix={`t-${step.id}`} saved={step} />
          <FormNotice state={state} />
          <div className="btn-row">
            <SubmitButton>Save the step</SubmitButton>
          </div>
        </form>
        <ConfirmAction
          action={removeTemplateStep}
          fields={{ id: step.id }}
          label="Remove this step"
          question={`Remove “${step.title}” from the template? Jobs that already have it keep theirs.`}
          confirmLabel="Yes, remove"
        />
      </div>
    </details>
  );
}

export function AddTemplateStep({ templateId }: { templateId: string }) {
  const [state, action] = useActionState(addTemplateStep, idle);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === 'success') form.current?.reset();
  }, [state]);
  return (
    <details className="disclosure disclosure--link" open={state.status === 'error' || undefined}>
      <summary>Add a step</summary>
      <div className="disclosure__panel">
        <form ref={form} action={action} className="form" noValidate>
          <input type="hidden" name="template-id" value={templateId} />
          <Fields state={state} idPrefix="new-template-step" saved={null} />
          <FormNotice state={state} />
          <div className="btn-row">
            <SubmitButton pendingText="Adding…">Add</SubmitButton>
          </div>
        </form>
      </div>
    </details>
  );
}
