'use client';

import { useActionState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { MeasureInputs } from '@/components/MeasureInputs';
import { SubmitButton } from '@/components/SubmitButton';
import { TextArea, TextField } from '@/components/fields';
import { idle } from '@/lib/action-state';
import type { MeasurementField } from '@/domain/measurements/fields';
import type { MeasurementUnit } from '@/domain/measurements/sets';
import { createClient } from '../actions';

/** A new client and her measurements, on one screen (decision 0102). Only her name is needed. */
export function NewClientForm({ fields, unit }: { fields: MeasurementField[]; unit: MeasurementUnit }) {
  const [state, action] = useActionState(createClient, idle);
  return (
    <form action={action} className="form" noValidate>
      <TextField
        name="name"
        label="Name"
        state={state}
        autoComplete="off"
        maxLength={120}
        placeholder="Full name"
        required
      />
      <TextField
        name="phone"
        label="Phone (optional)"
        state={state}
        type="tel"
        autoComplete="off"
        inputMode="tel"
        maxLength={30}
        placeholder="09…"
      />
      {fields.length > 0 && <MeasureInputs fields={fields} unit={unit} state={state} />}
      <TextArea
        name="notes"
        label="Notes (optional)"
        state={state}
        rows={2}
        maxLength={2000}
        placeholder="Fit preferences, etc."
      />
      <FormNotice state={state} />
      <div className="btn-row form-bar">
        <SubmitButton className="btn btn--main">Save</SubmitButton>
      </div>
    </form>
  );
}
