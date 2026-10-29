'use client';

import { useActionState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { ChoiceField, TextField } from '@/components/fields';
import { idle } from '@/lib/action-state';
import type { OrderDefaults } from '@/domain/preferences';
import { saveOrderDefaults } from './actions';

/** What a new order and a new set of measurements start from. Each can still be changed for one order. */
export function OrderDefaultsForm({ defaults }: { defaults: OrderDefaults }) {
  const [state, action] = useActionState(saveOrderDefaults, idle);
  return (
    <form action={action} className="form" noValidate>
      <TextField
        name="default-buffer-days"
        label="Days to keep free before a handover"
        type="number"
        inputMode="numeric"
        min={0}
        max={30}
        state={state}
        saved={String(defaults.defaultBufferDays)}
        hint="A safety margin the planner leaves before the day an order is promised. A single order can use a different number."
        required
      />
      <ChoiceField
        name="measurement-unit"
        legend="Unit for new measurements"
        state={state}
        saved={defaults.measurementUnit}
        options={[
          { value: 'cm', label: 'Centimetres' },
          { value: 'in', label: 'Inches' },
        ]}
        hint="Measurements already saved keep the unit they were taken in."
      />
      <FormNotice state={state} />
      <div className="btn-row">
        <SubmitButton>Save defaults</SubmitButton>
      </div>
    </form>
  );
}
