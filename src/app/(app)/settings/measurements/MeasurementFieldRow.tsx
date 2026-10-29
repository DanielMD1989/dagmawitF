'use client';

import { useActionState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { TextField } from '@/components/fields';
import { idle } from '@/lib/action-state';
import type { MeasurementField } from '@/domain/measurements/fields';
import { moveMeasurementField, renameMeasurementField, setMeasurementFieldHidden } from './actions';

/** One of her measurements: its name, its place in the list, and whether new forms still ask for it. */
export function MeasurementFieldRow({
  field,
  first,
  last,
}: {
  field: MeasurementField;
  first: boolean;
  last: boolean;
}) {
  const [renamed, rename] = useActionState(renameMeasurementField, idle);
  const [moved, move] = useActionState(moveMeasurementField, idle);
  const [hidden, hide] = useActionState(setMeasurementFieldHidden, idle);
  const id = `field-${field.id}`;

  return (
    <li className="field-row">
      <form action={rename} className="field-row__name" noValidate>
        <input type="hidden" name="id" value={field.id} />
        <TextField
          name="label"
          id={`${id}-label`}
          label={`Name of “${field.label}”`}
          state={renamed}
          saved={field.label}
          maxLength={60}
          autoComplete="off"
          required
        />
        <SubmitButton className="btn btn--quiet" aria-label={`Save name of ${field.label}`}>
          Save
        </SubmitButton>
      </form>
      <div className="field-row__tools">
        <form action={move} className="btn-row">
          <input type="hidden" name="id" value={field.id} />
          <SubmitButton
            className="btn btn--quiet"
            name="direction"
            value="up"
            pendingText="Moving…"
            disabled={first}
            aria-label={`Move ${field.label} up`}
          >
            Up
          </SubmitButton>
          <SubmitButton
            className="btn btn--quiet"
            name="direction"
            value="down"
            pendingText="Moving…"
            disabled={last}
            aria-label={`Move ${field.label} down`}
          >
            Down
          </SubmitButton>
        </form>
        <form action={hide}>
          <input type="hidden" name="id" value={field.id} />
          <input type="hidden" name="hide" value="yes" />
          <SubmitButton
            className="btn btn--quiet"
            pendingText="Hiding…"
            aria-label={`Hide ${field.label} from new forms`}
          >
            Hide
          </SubmitButton>
        </form>
      </div>
      <FormNotice state={renamed} />
      <FormNotice state={moved} />
      <FormNotice state={hidden} />
    </li>
  );
}

/** A measurement she no longer asks for. Measurements saved with it still show it. */
export function HiddenFieldRow({ field }: { field: MeasurementField }) {
  const [state, show] = useActionState(setMeasurementFieldHidden, idle);
  return (
    <li className="field-row field-row--hidden">
      <form action={show} className="field-row__name">
        <input type="hidden" name="id" value={field.id} />
        <input type="hidden" name="hide" value="no" />
        <span className="field-row__label">{field.label}</span>
        <SubmitButton
          className="btn btn--quiet"
          pendingText="Showing…"
          aria-label={`Show ${field.label} on new forms`}
        >
          Show again
        </SubmitButton>
      </form>
      <FormNotice state={state} />
    </li>
  );
}
