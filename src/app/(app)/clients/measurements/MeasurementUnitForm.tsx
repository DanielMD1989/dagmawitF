'use client';

import { useActionState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { ChoiceField } from '@/components/fields';
import { idle } from '@/lib/action-state';
import type { MeasurementUnit } from '@/domain/measurements/sets';
import { saveMeasurementDefaults } from './actions';

/** The unit new measurements are taken in. Saved measurements keep theirs. */
export function MeasurementUnitForm({ unit }: { unit: MeasurementUnit }) {
  const [state, action] = useActionState(saveMeasurementDefaults, idle);
  return (
    <form action={action} className="form" noValidate>
      <ChoiceField
        name="measurement-unit"
        legend="Unit for new measurements"
        state={state}
        saved={unit}
        options={[
          { value: 'cm', label: 'Centimetres' },
          { value: 'in', label: 'Inches' },
        ]}
        hint="Measurements already saved keep the unit they were taken in."
      />
      <FormNotice state={state} />
      <div className="btn-row">
        <SubmitButton>Save the unit</SubmitButton>
      </div>
    </form>
  );
}
