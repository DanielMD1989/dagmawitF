'use client';

import { useActionState, useState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { SelectField, TextArea, TextField } from '@/components/fields';
import { fieldTicked, fieldValue, idle } from '@/lib/action-state';
import { EVENT_LABEL, NO_CLIENT } from '@/domain/orders/forms';
import { isClosed, type OrderStatus } from '@/domain/orders/status';
import { saveOrderDetails } from './actions';

/**
 * The job itself: who it is for (or nobody: an event), what it is, its day, and your notes. Moving the day can move
 * the steps not done yet with it. A finished or cancelled job is a record, so only its notes can be changed there.
 */
export function OrderDetailsForm({
  order,
  clients,
}: {
  order: {
    id: string;
    status: OrderStatus;
    clientId: string | null;
    title: string;
    dueOn: string;
    notes: string;
  };
  clients: { id: string; name: string }[];
}) {
  const [state, action] = useActionState(saveOrderDetails, idle);
  const closed = isClosed(order.status);
  const [client, setClient] = useState(fieldValue(state, 'client', order.clientId ?? NO_CLIENT));
  const event = client === NO_CLIENT;

  return (
    <form action={action} className="form" noValidate>
      <input type="hidden" name="id" value={order.id} />
      {!closed && (
        <>
          <SelectField
            name="client"
            label="For"
            state={state}
            saved={order.clientId ?? NO_CLIENT}
            options={[
              ...clients.map((c) => ({ value: c.id, label: c.name })),
              { value: NO_CLIENT, label: EVENT_LABEL },
            ]}
            onChange={setClient}
            hint={
              event
                ? undefined
                : 'Changing the client clears the measurements chosen on this job, because they are hers.'
            }
          />
          <TextField
            name="title"
            label={event ? 'Name of the event' : 'What it is (optional)'}
            state={state}
            saved={order.title}
            maxLength={120}
            autoComplete="off"
          />
          <TextField
            name="due-on"
            label={event ? 'Event day' : 'Delivery day'}
            type="date"
            state={state}
            saved={order.dueOn}
            required
          />
          <label className="check">
            <input
              type="checkbox"
              name="move-steps"
              defaultChecked={fieldTicked(state, 'move-steps', true)}
            />
            When the day moves, move the steps not done yet by as many days
          </label>
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
            ? `Notes can still be added to a finished ${event ? 'event' : 'job'}.`
            : event
              ? 'For you. For example: the stand number, what to bring.'
              : 'For you. For example: pays in two parts, collects with her mother.'
        }
      />
      <FormNotice state={state} />
      <div className="btn-row">
        <SubmitButton>{closed ? 'Save notes' : 'Save'}</SubmitButton>
      </div>
    </form>
  );
}
