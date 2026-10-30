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
  usual = [],
}: {
  orderId: string | null;
  /** The day it starts on unless she changes it. */
  day: string;
  summary: string;
  idPrefix: string;
  /** Her usual steps, offered as she types the title. */
  usual?: readonly string[];
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
            usual={usual}
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
  usual = [],
}: {
  state: Parameters<typeof TextField>[0]['state'];
  idPrefix: string;
  saved: { title: string; day: string; until: string; from: string; to: string };
  usual?: readonly string[];
}) {
  return (
    <>
      {usual.length > 0 && (
        <datalist id={`${idPrefix}-usual`}>
          {usual.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      )}
      <TextField
        name="title"
        id={`${idPrefix}-title`}
        label="Step"
        state={state}
        saved={saved.title}
        placeholder="Cutting, sewing, fitting…"
        autoComplete="off"
        list={usual.length > 0 ? `${idPrefix}-usual` : undefined}
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
