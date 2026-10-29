'use client';

import { useActionState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { SelectField, TextArea, TextField } from '@/components/fields';
import { idle } from '@/lib/action-state';
import { isClosed, type OrderStatus } from '@/domain/orders/status';
import { saveOrderDetails } from './actions';

/**
 * The promise to the client: who, which day, how much margin, and her own notes. A delivered or cancelled
 * order is a record, so only its notes can be changed there; the rest is shown by the page around it.
 */
export function OrderDetailsForm({
  order,
  clients,
}: {
  order: {
    id: string;
    status: OrderStatus;
    clientId: string;
    deliveryOn: string;
    bufferDays: number;
    notes: string;
  };
  clients: { id: string; name: string }[];
}) {
  const [state, action] = useActionState(saveOrderDetails, idle);
  const closed = isClosed(order.status);

  return (
    <form action={action} className="form" noValidate>
      <input type="hidden" name="id" value={order.id} />
      {!closed && (
        <>
          <div className="form-grid form-grid--2">
            <SelectField
              name="client"
              label="Client"
              state={state}
              saved={order.clientId}
              options={clients.map((c) => ({ value: c.id, label: c.name }))}
              hint="Changing the client clears the measurements chosen for the garments, because they are hers."
            />
            <TextField
              name="delivery-on"
              label="Handover day"
              type="date"
              state={state}
              saved={order.deliveryOn}
              required
              hint="The day the client collects it. This is the promise."
            />
          </div>
          <TextField
            name="buffer-days"
            label="Days to keep free before it"
            type="number"
            inputMode="numeric"
            min={0}
            max={30}
            state={state}
            saved={String(order.bufferDays)}
            required
          />
        </>
      )}
      <TextArea
        name="notes"
        label="Notes"
        state={state}
        saved={order.notes}
        rows={3}
        maxLength={4000}
        hint={
          closed
            ? 'Notes can still be added to a finished order.'
            : 'For you. For example: pays in two parts, collects with her mother.'
        }
      />
      <FormNotice state={state} />
      <div className="btn-row">
        <SubmitButton>{closed ? 'Save notes' : 'Save details'}</SubmitButton>
      </div>
    </form>
  );
}
