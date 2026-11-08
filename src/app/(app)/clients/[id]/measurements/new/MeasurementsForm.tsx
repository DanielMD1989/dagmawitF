'use client';

import { useActionState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { MeasureInputs } from '@/components/MeasureInputs';
import { SubmitButton } from '@/components/SubmitButton';
import { TextField } from '@/components/fields';
import { idle } from '@/lib/action-state';
import type { MeasurementField } from '@/domain/measurements/fields';
import type { MeasurementUnit } from '@/domain/measurements/sets';
import { recordMeasurements } from '@/app/(app)/clients/actions';

/** Her measurements on a day: filled from the last version when it is in the same unit, so she changes what changed. */
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
      <input type="hidden" name="unit" value={unit} />
      <MeasureInputs fields={fields} unit={unit} state={state} startingValues={startingValues} />
      {state.errors.form && (
        <p className="error" role="alert">
          {state.errors.form}
        </p>
      )}
      <TextField
        name="taken-on"
        label="Measured on"
        type="date"
        state={state}
        saved={today}
        max={today}
        required
      />
      <FormNotice state={state} />
      <div className="btn-row form-bar">
        <SubmitButton className="btn btn--main">Save measurements</SubmitButton>
      </div>
    </form>
  );
}
