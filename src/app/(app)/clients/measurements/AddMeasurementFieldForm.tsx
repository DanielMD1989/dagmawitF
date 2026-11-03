'use client';

import { useActionState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { TextField } from '@/components/fields';
import { idle } from '@/lib/action-state';
import { addMeasurementField } from './actions';

export function AddMeasurementFieldForm() {
  const [state, action] = useActionState(addMeasurementField, idle);
  return (
    <form action={action} className="form" noValidate>
      <TextField
        name="label"
        id="new-field-label"
        label="A measurement to add"
        state={state}
        maxLength={60}
        autoComplete="off"
        required
        hint="For example: Knee to hem, Wrist, Bridal train length. It goes at the end of the list."
      />
      <FormNotice state={state} />
      <div className="btn-row">
        <SubmitButton pendingText="Adding…">Add to the list</SubmitButton>
      </div>
    </form>
  );
}
