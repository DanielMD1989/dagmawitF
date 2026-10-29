'use client';

import { useActionState } from 'react';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { CheckField, SelectField, TextArea, TextField } from '@/components/fields';
import { idle } from '@/lib/action-state';
import { formatDay } from '@/domain/dates';
import {
  KIND_LABEL,
  PREREQUISITE_KINDS,
  PREREQUISITE_STATES,
  dateLabel,
  stateLabel,
  type Prerequisite,
} from '@/domain/orders/prerequisites';
import { removePrerequisite, savePrerequisite } from './actions';

type Concern = 'late' | 'undated' | null;

/** What this item says about itself, and whether it needs her attention (it holds work back and cannot be planned around). */
function describeItem(item: Prerequisite, today: string): { text: string; concern: Concern } {
  const open = item.state !== 'received';
  const when = item.expectedOn ? `${dateLabel(item.kind)} ${formatDay(item.expectedOn)}` : '';
  if (open && item.blocking && item.expectedOn === null)
    return { text: 'Holds work back, and has no expected date yet.', concern: 'undated' };
  if (open && item.blocking && item.expectedOn !== null && item.expectedOn < today)
    return { text: `${when}. That day has passed.`, concern: 'late' };
  return {
    text: [item.blocking ? 'Holds work back' : 'Reminder', when].filter(Boolean).join(' · '),
    concern: null,
  };
}

function Tick() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/** One thing the order waits for: what it is and where it stands, with its editor one tap away. */
export function PrerequisiteItem({
  item,
  today,
  editable,
  orderId,
  impact,
}: {
  item: Prerequisite;
  today: string;
  editable: boolean;
  orderId: string;
  /** Offer "Save and see impact": the order is active (docs/change.md). */
  impact: boolean;
}) {
  const [state, action] = useActionState(savePrerequisite, idle);
  const done = item.state === 'received';
  const { text, concern } = describeItem(item, today);
  const id = `item-${item.id}`;
  const className = ['item', concern && `item--${concern}`].filter(Boolean).join(' ');

  return (
    <li className={className}>
      <div className="item__head">
        <span className={done ? 'item__mark item__mark--done' : 'item__mark'} aria-hidden="true">
          {done && <Tick />}
        </span>
        <div className="item__main">
          <span className="item__title">{item.label}</span>
          <span className={concern ? 'item__note' : 'item__note hint'}>{text}</span>
          {item.note && <span className="hint">{item.note}</span>}
        </div>
        <span className={done ? 'chip' : 'chip chip--sand'}>{stateLabel(item.kind, item.state)}</span>
      </div>

      {editable && (
        <details className="disclosure disclosure--link">
          <summary>
            Update<span className="sr-only"> {item.label}</span>
          </summary>
          <div className="disclosure__panel">
            <form action={action} className="form" noValidate>
              <input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="order-id" value={orderId} />
              <div className="item__quick">
                <SelectField
                  name="state"
                  id={`${id}-state`}
                  label="Where it stands"
                  state={state}
                  saved={item.state}
                  options={PREREQUISITE_STATES.map((s) => ({ value: s, label: stateLabel(item.kind, s) }))}
                />
                <TextField
                  name="expected-on"
                  id={`${id}-date`}
                  label={dateLabel(item.kind)}
                  type="date"
                  state={state}
                  saved={item.expectedOn ?? ''}
                />
              </div>
              <TextField
                name="label"
                id={`${id}-label`}
                label="Name"
                state={state}
                saved={item.label}
                maxLength={120}
                required
              />
              <SelectField
                name="kind"
                id={`${id}-kind`}
                label="What kind of thing is it?"
                state={state}
                saved={item.kind}
                options={PREREQUISITE_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
              />
              <CheckField
                name="blocking"
                id={`${id}-blocking`}
                label="Work cannot start without it"
                state={state}
                saved={item.blocking}
                hint="Untick it for a reminder that does not hold anything back."
              />
              <TextArea
                name="note"
                id={`${id}-note`}
                label="Note (optional)"
                state={state}
                saved={item.note}
                rows={2}
                maxLength={300}
              />
              <FormNotice state={state} />
              <div className="btn-row">
                <SubmitButton name="intent" value="save">
                  Save
                </SubmitButton>
                {impact && (
                  <SubmitButton
                    name="intent"
                    value="impact"
                    className="btn btn--quiet"
                    pendingText="Planning…"
                  >
                    Save and see impact
                  </SubmitButton>
                )}
              </div>
            </form>
            <ConfirmAction
              action={removePrerequisite}
              fields={{ id: item.id }}
              label="Remove from the list"
              question={`Remove “${item.label}” from the list?`}
              confirmLabel="Yes, remove"
            />
          </div>
        </details>
      )}
    </li>
  );
}
