'use client';

import { useActionState } from 'react';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FormNotice } from '@/components/FormNotice';
import { HoursMinutes } from '@/components/HoursMinutes';
import { SubmitButton } from '@/components/SubmitButton';
import { SelectField, TextField } from '@/components/fields';
import { fieldValue, idle } from '@/lib/action-state';
import { quickAdd, removeQuickTask } from '@/app/(app)/today/actions';

/** Work that came in the door. It gets a day from the next plan. */
export function QuickAddForm({ orders }: { orders: { id: string; label: string }[] }) {
  const [state, action] = useActionState(quickAdd, idle);
  const error = state.errors['estimate-hours'];
  return (
    <details className="disclosure">
      <summary>Quick add</summary>
      <div className="disclosure__panel">
        <form action={action} className="form" noValidate>
          <TextField
            name="title"
            id="quick-title"
            label="What is it?"
            state={state}
            maxLength={120}
            autoComplete="off"
            required
            hint="A walk-in hem, an extra fitting, sharpening the shears."
          />
          <HoursMinutes
            prefix="estimate"
            id="quick"
            legend="How long it takes"
            error={error}
            hours={fieldValue(state, 'estimate-hours', '')}
            minutes={fieldValue(state, 'estimate-minutes', '')}
          />
          <SelectField
            name="order-id"
            id="quick-order"
            label="For an order (optional)"
            state={state}
            saved=""
            options={[
              { value: '', label: 'None: studio work' },
              ...orders.map((o) => ({ value: o.id, label: o.label })),
            ]}
          />
          <FormNotice state={state} />
          <div className="btn-row">
            <SubmitButton pendingText="Adding…">Add</SubmitButton>
          </div>
        </form>
      </div>
    </details>
  );
}

export function RemoveQuickTask({ id, title }: { id: string; title: string }) {
  return (
    <ConfirmAction
      action={removeQuickTask}
      fields={{ id }}
      label="Remove"
      question={`Remove “${title}”?`}
      confirmLabel="Yes, remove"
    />
  );
}
