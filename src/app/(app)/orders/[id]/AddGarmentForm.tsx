'use client';

import { useActionState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { TextArea, TextField } from '@/components/fields';
import { idle } from '@/lib/action-state';
import { addGarment } from './actions';

/** Another piece on the same job: a bridal gown and two bridesmaid dresses, or a matching outfit, are one job. */
export function AddGarmentForm({ orderId, first }: { orderId: string; first: boolean }) {
  const [state, action] = useActionState(addGarment, idle);
  return (
    <details className="disclosure">
      <summary>{first ? 'Add what is made' : 'Add another piece'}</summary>
      <div className="disclosure__panel">
        <form action={action} className="form" noValidate>
          <input type="hidden" name="order-id" value={orderId} />
          <TextField
            name="garment-type"
            id="add-garment-type"
            label="What it is"
            hint="For example “Matching shirt for the groom”."
            state={state}
            maxLength={80}
            autoComplete="off"
            required
          />
          <TextArea
            name="brief"
            id="add-garment-brief"
            label="Design brief (optional)"
            state={state}
            rows={4}
            maxLength={4000}
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
