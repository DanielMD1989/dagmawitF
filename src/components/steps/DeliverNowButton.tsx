'use client';

import { useActionState } from 'react';
import { toggleStep } from '@/app/(app)/steps/actions';
import { SubmitButton } from '@/components/SubmitButton';
import { idle } from '@/lib/action-state';

/**
 * "Delivered", under "Next: Delivery" once an order's Delivery is all that is left (decision 0097): it ticks the
 * Delivery today, ahead of its day if she delivered early, which finishes the order (decision 0089). The same tick as
 * the Delivery step's own mark, so it goes the same way and by the same rules.
 */
export function DeliverNowButton({
  stepId,
  orderId,
  whose,
}: {
  stepId: string;
  orderId: string;
  /** "Tiest · Fetil outfit", said to a screen reader. */
  whose: string;
}) {
  const [state, action] = useActionState(toggleStep, idle);
  return (
    <form action={action} className="deliver-now">
      <input type="hidden" name="step-id" value={stepId} />
      <input type="hidden" name="order-id" value={orderId} />
      <input type="hidden" name="saw-done" value="false" />
      <SubmitButton className="btn btn--small" pendingText="Finishing…" aria-label={`Delivered: ${whose}`}>
        Delivered
      </SubmitButton>
      {state.status === 'error' && (
        <span className="error" role="alert">
          {state.message}
        </span>
      )}
    </form>
  );
}
