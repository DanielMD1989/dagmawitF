import type { Metadata } from 'next';
import { BackLink } from '@/components/BackLink';
import { loadMeasurementFields } from '@/server/measurements';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';
import { AddMeasurementFieldForm } from './AddMeasurementFieldForm';
import { HiddenFieldRow, MeasurementFieldRow } from './MeasurementFieldRow';
import { MeasurementUnitForm } from './MeasurementUnitForm';

export const metadata: Metadata = { title: 'Your list of measurements' };

export default async function MeasurementListPage() {
  await requireUser();
  const supabase = await createSupabase();
  const [fields, { measurementUnit: unit }] = await Promise.all([
    loadMeasurementFields(supabase),
    loadPreferences(supabase),
  ]);
  const visible = fields.filter((f) => !f.archived);
  const hidden = fields.filter((f) => f.archived);

  return (
    <>
      <div className="page-head">
        <BackLink href="/clients">Clients</BackLink>
        <h1>Your list of measurements</h1>
      </div>

      <section className="section" aria-labelledby="unit-heading">
        <div className="section__head">
          <h2 id="unit-heading">Unit</h2>
        </div>
        <MeasurementUnitForm unit={unit} />
      </section>

      <section className="section" aria-labelledby="visible-heading">
        <div className="section__head">
          <h2 id="visible-heading">Asked for on every form</h2>
        </div>
        {visible.length === 0 ? (
          <div className="card card--warn" role="status">
            <p>The list is empty.</p>
          </div>
        ) : (
          <ul className="field-list">
            {visible.map((f, i) => (
              <MeasurementFieldRow key={f.id} field={f} first={i === 0} last={i === visible.length - 1} />
            ))}
          </ul>
        )}
      </section>

      <section className="section" aria-labelledby="add-heading">
        <div className="section__head">
          <h2 id="add-heading">Add a measurement</h2>
        </div>
        <AddMeasurementFieldForm />
      </section>

      {hidden.length > 0 && (
        <section className="section" aria-labelledby="hidden-heading">
          <div className="section__head">
            <h2 id="hidden-heading">Hidden</h2>
          </div>
          <ul className="field-list">
            {hidden.map((f) => (
              <HiddenFieldRow key={f.id} field={f} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
