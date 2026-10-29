'use client';

import { useActionState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { TextArea, TextField } from '@/components/fields';
import { idle } from '@/lib/action-state';
import { addGarment } from './actions';

/** Another garment on the same order: a bridal gown and two bridesmaid dresses are one order. */
export function AddGarmentForm({ orderId }: { orderId: string }) {
  const [state, action] = useActionState(addGarment, idle);
  return (
    <details className="disclosure">
      <summary>Add another garment</summary>
      <div className="disclosure__panel">
        <form action={action} className="form" noValidate>
          <input type="hidden" name="order-id" value={orderId} />
          <TextField
            name="garment-type"
            id="add-garment-type"
            label="Garment"
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
            <SubmitButton pendingText="Adding…">Add garment</SubmitButton>
          </div>
        </form>
      </div>
    </details>
  );
}
