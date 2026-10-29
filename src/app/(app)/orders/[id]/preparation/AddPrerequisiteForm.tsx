'use client';

import { useActionState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { CheckField, SelectField, TextField } from '@/components/fields';
import { idle } from '@/lib/action-state';
import { KIND_LABEL, PREREQUISITE_KINDS } from '@/domain/orders/prerequisites';
import { addPrerequisite } from './actions';

/** Something this order waits for that the suggestions do not cover. */
export function AddPrerequisiteForm({ orderId }: { orderId: string }) {
  const [state, action] = useActionState(addPrerequisite, idle);
  return (
    <details className="disclosure">
      <summary>Add something else</summary>
      <div className="disclosure__panel">
        <form action={action} className="form" noValidate>
          <input type="hidden" name="order-id" value={orderId} />
          <TextField
            name="label"
            id="add-item-label"
            label="What is it?"
            state={state}
            maxLength={120}
            autoComplete="off"
            required
            hint="For example: Silk organza, Beading by the embroiderer, Client’s shoes for the hem."
          />
          <div className="form-grid form-grid--2">
            <SelectField
              name="kind"
              id="add-item-kind"
              label="What kind of thing is it?"
              state={state}
              saved="material"
              options={PREREQUISITE_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
            />
            <TextField
              name="expected-on"
              id="add-item-date"
              label="Expected on (if known)"
              type="date"
              state={state}
            />
          </div>
          <CheckField
            name="blocking"
            id="add-item-blocking"
            label="Work cannot start without it"
            state={state}
            saved
          />
          <FormNotice state={state} />
          <div className="btn-row">
            <SubmitButton pendingText="Adding…">Add to the list</SubmitButton>
          </div>
        </form>
      </div>
    </details>
  );
}
