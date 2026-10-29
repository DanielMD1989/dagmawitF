'use client';

import { useActionState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { idle } from '@/lib/action-state';
import { approvePlan, rejectPlan } from '../actions';

/** Approve or reject an open proposal. The database checks again that it still stands on today's facts. */
export function PlanDecision({
  number,
  orderId,
  findings,
}: {
  number: number;
  orderId: string | null;
  /** Problems and warnings in the whole plan. */
  findings: number;
}) {
  const [approved, approve] = useActionState(approvePlan, idle);
  const [rejected, reject] = useActionState(rejectPlan, idle);
  const hidden = (
    <>
      <input type="hidden" name="number" value={number} />
      {orderId && <input type="hidden" name="order-id" value={orderId} />}
    </>
  );
  return (
    <div className="decision">
      <div className="btn-row">
        <form action={approve}>
          {hidden}
          <SubmitButton pendingText="Approving…">
            {findings === 0 ? 'Approve' : `Approve with ${findings} warning${findings === 1 ? '' : 's'}`}
          </SubmitButton>
        </form>
        <form action={reject}>
          {hidden}
          <SubmitButton className="btn btn--quiet" pendingText="Rejecting…">
            Reject proposal
          </SubmitButton>
        </form>
      </div>
      <FormNotice state={approved} />
      <FormNotice state={rejected} />
    </div>
  );
}
