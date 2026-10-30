'use client';

import { useActionState, useState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { SelectField, TextArea, TextField } from '@/components/fields';
import { fieldTicked, fieldValue, idle } from '@/lib/action-state';
import { JOB_KINDS, KIND_WORDS, isJobKind, type JobKind } from '@/domain/jobs/kinds';
import { isClosed, type OrderStatus } from '@/domain/orders/status';
import { saveOrderDetails } from './actions';

/**
 * The job itself: its kind, the client, its day, and your notes. Moving the day can move the steps not done yet with
 * it. A delivered or cancelled job is a record, so only its notes can be changed there.
 */
export function OrderDetailsForm({
  order,
  clients,
}: {
  order: { id: string; status: OrderStatus; kind: JobKind; clientId: string; dueOn: string; notes: string };
  clients: { id: string; name: string }[];
}) {
  const [state, action] = useActionState(saveOrderDetails, idle);
  const closed = isClosed(order.status);
  const typedKind = fieldValue(state, 'kind', order.kind);
  const [kind, setKind] = useState<JobKind>(isJobKind(typedKind) ? typedKind : order.kind);

  return (
    <form action={action} className="form" noValidate>
      <input type="hidden" name="id" value={order.id} />
      {!closed && (
        <>
          <div className="form-grid form-grid--2">
            <div className="field">
              <label htmlFor="kind">Kind of job</label>
              <select
                id="kind"
                name="kind"
                className="select"
                value={kind}
                onChange={(e) => isJobKind(e.target.value) && setKind(e.target.value)}
              >
                {JOB_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_WORDS[k].label}
                  </option>
                ))}
              </select>
            </div>
            <SelectField
              name="client"
              label="Client"
              state={state}
              saved={order.clientId}
              options={clients.map((c) => ({ value: c.id, label: c.name }))}
              hint="Changing the client clears the measurements chosen for the garments, because they are hers."
            />
          </div>
          <TextField
            name="due-on"
            label={KIND_WORDS[kind].dueLabel}
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
            ? 'Notes can still be added to a finished job.'
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
