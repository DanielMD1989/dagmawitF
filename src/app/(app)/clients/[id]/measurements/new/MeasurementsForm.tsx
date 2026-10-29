'use client';

import { useActionState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { ChoiceField, TextArea, TextField } from '@/components/fields';
import { idle } from '@/lib/action-state';
import type { MeasurementField } from '@/domain/measurements/fields';
import { measureFieldName, type MeasurementUnit } from '@/domain/measurements/sets';
import { recordMeasurements } from '@/app/(app)/clients/actions';

/** One column of numbers: the fields she has chosen to measure, filled from the last version when it is in the same unit. */
export function MeasurementsForm({
  clientId,
  orderId,
  fields,
  unit,
  today,
  startingValues,
}: {
  clientId: string;
  orderId: string | null;
  fields: MeasurementField[];
  unit: MeasurementUnit;
  today: string;
  /** What the last version said, by field key; empty when there is none to start from. */
  startingValues: Record<string, number>;
}) {
  const [state, action] = useActionState(recordMeasurements, idle);
  return (
    <form action={action} className="form" noValidate>
      <input type="hidden" name="client-id" value={clientId} />
      {orderId && <input type="hidden" name="order-id" value={orderId} />}

      <div className="form-grid form-grid--2">
        <TextField
          name="taken-on"
          label="Measured on"
          type="date"
          state={state}
          saved={today}
          max={today}
          required
        />
        <ChoiceField
          name="unit"
          legend="Unit"
          state={state}
          saved={unit}
          options={[
            { value: 'cm', label: 'Centimetres' },
            { value: 'in', label: 'Inches' },
          ]}
          hint="Numbers are not converted if you change this."
        />
      </div>

      <div className="measure-grid">
        {fields.map((f) => {
          const name = measureFieldName(f.key);
          const start = startingValues[f.key];
          return (
            <TextField
              key={f.key}
              name={name}
              id={name}
              label={f.label}
              state={state}
              saved={start === undefined ? '' : String(start)}
              inputMode="decimal"
              autoComplete="off"
              placeholder="—"
            />
          );
        })}
      </div>
      {state.errors.form && (
        <p className="error" role="alert">
          {state.errors.form}
        </p>
      )}

      <TextArea
        name="note"
        label="Note (optional)"
        state={state}
        rows={2}
        maxLength={300}
        hint="For example: measured over a fitted slip, or after she lost weight."
      />
      <FormNotice state={state} />
      <div className="btn-row">
        <SubmitButton>Save measurements</SubmitButton>
      </div>
    </form>
  );
}
