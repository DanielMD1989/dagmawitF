'use client';

import { useActionState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { TextField } from '@/components/fields';
import { idle, type ActionState } from '@/lib/action-state';
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

/**
 * The one move that takes the job forward, from where it is (decision 0100): it is the big solid button, first in
 * the row. The others are there when needed, quieter: a cancel says so in the warning colour, the rest are plain.
 */
const MAIN: Readonly<Partial<Record<OrderStatus, OrderStatus>>> = {
  draft: 'active',
  active: 'delivered',
  on_hold: 'active',
};

function look(from: OrderStatus, to: OrderStatus): { button: string; disclosure: string } {
  if (MAIN[from] === to) return { button: 'btn', disclosure: 'disclosure disclosure--main' };
  if (to === 'cancelled') return { button: 'btn btn--warn', disclosure: 'disclosure disclosure--warn' };
  return { button: 'btn btn--quiet', disclosure: 'disclosure' };
}

/**
 * The moves this job can make, as buttons. A move that needs an answer (why it is on hold, which day it
 * was delivered, a new handover day when the old one has passed) opens a small form; the rest are one press.
 * The list comes from the same table the database checks, so a button is never offered that would be refused.
 */
export function StatusActions({
  order,
  today,
}: {
  order: { id: string; status: OrderStatus; deliveryOn: string; event: boolean };
  today: string;
}) {
  const main = MAIN[order.status];
  // The main move first; the rest keep their order.
  const moves = [...movesFrom(order.status)].sort((a, b) => Number(b === main) - Number(a === main));
  return (
    <div className="status-actions">
      {moves.map((to) => {
        const label = moveLabel(order.status, to, order.event ? 'event' : 'order');
        const { button: className, disclosure } = look(order.status, to);
        const dayPassed = to === 'active' && order.deliveryOn < today;

        if (to === 'on_hold') {
          return (
            <details key={to} className={disclosure}>
              <summary>{label}</summary>
              <div className="disclosure__panel">
                <MoveForm orderId={order.id} to={to}>
                  {(state) => (
                    <>
                      <TextField
                        name="reason"
                        id="hold-reason"
                        label="Why is it on hold? (optional)"
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
        if (to === 'delivered') {
          return (
            <details key={to} className={disclosure}>
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
            <details key={to} className={disclosure}>
              <summary>{label}</summary>
              <div className="disclosure__panel">
                <MoveForm orderId={order.id} to={to}>
                  {(state) => (
                    <>
                      <p>
                        {order.event
                          ? 'The event is kept, with its history, and leaves your calendar. It can be reopened as a draft.'
                          : 'The order is kept, with its history and measurements, and leaves your calendar. It can be reopened as a draft.'}
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
            <details key={to} className={disclosure}>
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
