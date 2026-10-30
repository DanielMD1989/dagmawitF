'use client';

import { useActionState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { TextField } from '@/components/fields';
import { idle, type ActionState } from '@/lib/action-state';
import { formatDay } from '@/domain/dates';
import { moveLabel, movesFrom, type OrderStatus } from '@/domain/orders/status';
import { moveOrder } from './actions';

function MoveForm({
  orderId,
  to,
  children,
}: {
  orderId: string;
  to: OrderStatus;
  children: (state: ActionState) => React.ReactNode;
}) {
  const [state, action] = useActionState(moveOrder, idle);
  return (
    <form action={action} className="form" noValidate>
      <input type="hidden" name="id" value={orderId} />
      <input type="hidden" name="to" value={to} />
      {children(state)}
      {state.errors.form && (
        <p className="error" role="alert">
          {state.errors.form}
        </p>
      )}
      <FormNotice state={state} />
    </form>
  );
}

const BUTTON: Readonly<Record<OrderStatus, string>> = {
  active: 'btn',
  delivered: 'btn',
  draft: 'btn btn--quiet',
  on_hold: 'btn btn--quiet',
  cancelled: 'btn btn--warn',
};

/**
 * The moves this job can make, as buttons. A move that needs an answer (why it is on hold, which day it
 * was delivered, a new handover day when the old one has passed) opens a small form; the rest are one press.
 * The list comes from the same table the database checks, so a button is never offered that would be refused.
 */
export function StatusActions({
  order,
  today,
}: {
  order: { id: string; status: OrderStatus; deliveryOn: string };
  today: string;
}) {
  const moves = movesFrom(order.status);
  return (
    <div className="status-actions">
      {moves.map((to) => {
        const label = moveLabel(order.status, to);
        const className = BUTTON[to];
        const dayPassed = to === 'active' && order.deliveryOn < today;

        if (to === 'on_hold') {
          return (
            <details key={to} className="disclosure">
              <summary>{label}</summary>
              <div className="disclosure__panel">
                <MoveForm orderId={order.id} to={to}>
                  {(state) => (
                    <>
                      <TextField
                        name="reason"
                        id="hold-reason"
                        label="Why is it on hold?"
                        state={state}
                        maxLength={300}
                        hint="For example: client is abroad until December, fabric is not coming."
                        required
                      />
                      <div className="btn-row">
                        <SubmitButton className={className}>{label}</SubmitButton>
                      </div>
                    </>
                  )}
                </MoveForm>
              </div>
            </details>
          );
        }
        if (to === 'delivered') {
          return (
            <details key={to} className="disclosure">
              <summary>{label}</summary>
              <div className="disclosure__panel">
                <MoveForm orderId={order.id} to={to}>
                  {(state) => (
                    <>
                      <TextField
                        name="delivered-on"
                        id="delivered-on"
                        label="Finished on"
                        type="date"
                        state={state}
                        saved={today}
                        max={today}
                      />
                      <div className="btn-row">
                        <SubmitButton className={className}>{label}</SubmitButton>
                      </div>
                    </>
                  )}
                </MoveForm>
              </div>
            </details>
          );
        }
        if (to === 'cancelled') {
          return (
            <details key={to} className="disclosure">
              <summary>{label}</summary>
              <div className="disclosure__panel">
                <MoveForm orderId={order.id} to={to}>
                  {(state) => (
                    <>
                      <p>
                        The job is kept, with its history and measurements, and leaves your calendar. It can
                        be reopened as a draft.
                      </p>
                      <TextField
                        name="reason"
                        id="cancel-reason"
                        label="Why? (optional)"
                        state={state}
                        maxLength={300}
                      />
                      <div className="btn-row">
                        <SubmitButton className={className}>{label}</SubmitButton>
                      </div>
                    </>
                  )}
                </MoveForm>
              </div>
            </details>
          );
        }
        if (dayPassed) {
          return (
            <details key={to} className="disclosure">
              <summary>{label}</summary>
              <div className="disclosure__panel">
                <MoveForm orderId={order.id} to={to}>
                  {(state) => (
                    <>
                      <TextField
                        name="delivery-on"
                        id="new-delivery-on"
                        label="New day"
                        type="date"
                        state={state}
                        min={today}
                        required
                        hint={`The old day, ${formatDay(order.deliveryOn)}, has passed.`}
                      />
                      <div className="btn-row">
                        <SubmitButton className={className}>{label}</SubmitButton>
                      </div>
                    </>
                  )}
                </MoveForm>
              </div>
            </details>
          );
        }
        return (
          <MoveForm key={to} orderId={order.id} to={to}>
            {() => (
              <div className="btn-row">
                <SubmitButton className={className}>{label}</SubmitButton>
              </div>
            )}
          </MoveForm>
        );
      })}
    </div>
  );
}
