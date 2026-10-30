'use client';

import { useActionState, useEffect, useRef } from 'react';
import { addStep } from '@/app/(app)/steps/actions';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { TextField } from '@/components/fields';
import { idle } from '@/lib/action-state';

/**
 * Adds a step: to a job (on its page), or as her own studio work (on Today, for what walks in). A day is offered;
 * a last day and a time are there when she wants them.
 */
export function AddStepForm({
  orderId,
  day,
  summary,
  idPrefix,
}: {
  orderId: string | null;
  /** The day it starts on unless she changes it. */
  day: string;
  summary: string;
  idPrefix: string;
}) {
  const [state, action] = useActionState(addStep, idle);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === 'success') form.current?.reset();
  }, [state]);
  return (
    <details className="disclosure disclosure--link" open={state.status === 'error' || undefined}>
      <summary>{summary}</summary>
      <div className="disclosure__panel">
        <form ref={form} action={action} className="form" noValidate>
          {orderId && <input type="hidden" name="order-id" value={orderId} />}
          <StepFields
            state={state}
            idPrefix={idPrefix}
            saved={{ title: '', day, until: '', from: '', to: '' }}
          />
          <FormNotice state={state} />
          <div className="btn-row">
            <SubmitButton pendingText="Adding…">Add</SubmitButton>
          </div>
        </form>
      </div>
    </details>
  );
}

/** The fields of a step, shared by adding and changing one. */
export function StepFields({
  state,
  idPrefix,
  saved,
}: {
  state: Parameters<typeof TextField>[0]['state'];
  idPrefix: string;
  saved: { title: string; day: string; until: string; from: string; to: string };
}) {
  return (
    <>
      <TextField
        name="title"
        id={`${idPrefix}-title`}
        label="Step"
        state={state}
        saved={saved.title}
        placeholder="Cutting, sewing, fitting…"
        autoComplete="off"
      />
      <div className="form-grid form-grid--pair">
        <TextField
          name="day"
          id={`${idPrefix}-day`}
          label="Day"
          type="date"
          state={state}
          saved={saved.day}
        />
        <TextField
          name="until"
          id={`${idPrefix}-until`}
          label="Last day (optional)"
          type="date"
          state={state}
          saved={saved.until}
          hint="For a step over several days."
        />
      </div>
      <div className="form-grid form-grid--pair">
        <TextField
          name="from"
          id={`${idPrefix}-from`}
          label="From (optional)"
          type="time"
          state={state}
          saved={saved.from}
        />
        <TextField
          name="to"
          id={`${idPrefix}-to`}
          label="To (optional)"
          type="time"
          state={state}
          saved={saved.to}
        />
      </div>
    </>
  );
}
