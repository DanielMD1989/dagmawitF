'use client';

import { useActionState } from 'react';
import { moveOrder } from '@/app/(app)/orders/[id]/actions';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { TextField } from '@/components/fields';
import type { IsoDate } from '@/domain/dates';
import { idle } from '@/lib/action-state';

/**
 * The day an order was handed over, asked every time it is marked delivered (decision 0101): today unless she says
 * otherwise, never a day still to come. It finishes the order on that day, the same move as "Mark as finished", and
 * the database ticks its Delivery step on that same day (decision 0096).
 */
export function DeliveredForm({
  orderId,
  today,
  idPrefix,
  whose,
}: {
  orderId: string;
  today: IsoDate;
  /** Unique on the page: several orders can be delivered from one list. */
  idPrefix: string;
  /** "Tiest · Fetil outfit", said to a screen reader on the button. */
  whose?: string;
}) {
  const [state, action] = useActionState(moveOrder, idle);
  return (
    <form action={action} className="form deliver-form" noValidate>
      <input type="hidden" name="id" value={orderId} />
      <input type="hidden" name="to" value="delivered" />
      <TextField
        name="delivered-on"
        id={`${idPrefix}-delivered-on`}
        label="Delivered on"
        type="date"
        state={state}
        saved={today}
        max={today}
        required
      />
      {state.errors.form && (
        <p className="error" role="alert">
          {state.errors.form}
        </p>
      )}
      <FormNotice state={state} />
      <div className="btn-row">
        <SubmitButton
          className="btn btn--main"
          pendingText="Finishing…"
          {...(whose ? { 'aria-label': `Delivered: ${whose}` } : {})}
        >
          Delivered
        </SubmitButton>
      </div>
    </form>
  );
}
