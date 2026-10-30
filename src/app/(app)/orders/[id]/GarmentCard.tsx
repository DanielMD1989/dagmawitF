'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { TextArea, TextField } from '@/components/fields';
import { idle } from '@/lib/action-state';
import type { GarmentMeasurementKind } from '@/domain/measurements/sets';
import { removeGarment, saveGarment } from './actions';

/** One piece made on the job: what it is, its design brief, and which measurements it is made to. */
export function GarmentCard({
  orderId,
  garment,
  measurement,
  editable,
}: {
  orderId: string;
  garment: { id: string; garmentType: string; brief: string };
  measurement: { kind: GarmentMeasurementKind; text: string };
  editable: boolean;
}) {
  const [state, action] = useActionState(saveGarment, idle);
  const id = `garment-${garment.id}`;
  return (
    <article className="card" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>{garment.garmentType}</h3>
      {garment.brief ? (
        <p className="brief">{garment.brief}</p>
      ) : (
        <p className="hint">No brief written yet.</p>
      )}
      <p className={measurement.kind === 'outdated' ? 'late' : 'hint'}>
        {measurement.text} <Link href={`/orders/${orderId}/measurements`}>Measurements</Link>
      </p>
      {editable && (
        <details className="disclosure disclosure--link">
          <summary>
            Edit<span className="sr-only"> {garment.garmentType}</span>
          </summary>
          <div className="disclosure__panel">
            <form action={action} className="form" noValidate>
              <input type="hidden" name="id" value={garment.id} />
              <TextField
                name="garment-type"
                id={`${id}-type`}
                label="What it is"
                state={state}
                saved={garment.garmentType}
                maxLength={80}
                required
              />
              <TextArea
                name="brief"
                id={`${id}-brief`}
                label="Design brief"
                state={state}
                saved={garment.brief}
                rows={5}
                maxLength={4000}
              />
              <FormNotice state={state} />
              <div className="btn-row">
                <SubmitButton>Save</SubmitButton>
              </div>
            </form>
            <ConfirmAction
              action={removeGarment}
              fields={{ id: garment.id }}
              label={`Remove ${garment.garmentType}`}
              question={`Remove ${garment.garmentType} from the job? Its brief is lost.`}
              confirmLabel="Yes, remove"
            />
          </div>
        </details>
      )}
    </article>
  );
}
