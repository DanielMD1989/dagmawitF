'use client';

import { useActionState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { SelectField } from '@/components/fields';
import { idle } from '@/lib/action-state';
import { switchMeasurements } from '../actions';

/** Offers the client's saved versions for one garment. The garment keeps its version until she picks another. */
export function SwitchMeasurementsForm({
  garmentId,
  garmentType,
  versions,
  suggested,
}: {
  garmentId: string;
  garmentType: string;
  versions: { id: string; label: string }[];
  /** The version to offer first: the newest. */
  suggested: string;
}) {
  const [state, action] = useActionState(switchMeasurements, idle);
  return (
    <form action={action} className="form" noValidate>
      <input type="hidden" name="id" value={garmentId} />
      <SelectField
        name="measurement-set-id"
        id={`version-${garmentId}`}
        label={`Version to use for ${garmentType}`}
        state={state}
        saved={suggested}
        options={versions.map((v) => ({ value: v.id, label: v.label }))}
      />
      <FormNotice state={state} />
      <div className="btn-row">
        <SubmitButton className="btn btn--quiet">Use this version</SubmitButton>
      </div>
    </form>
  );
}
