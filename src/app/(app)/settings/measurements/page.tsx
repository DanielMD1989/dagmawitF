import type { Metadata } from 'next';
import { BackLink } from '@/components/BackLink';
import { loadMeasurementFields } from '@/server/measurements';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';
import { AddMeasurementFieldForm } from './AddMeasurementFieldForm';
import { HiddenFieldRow, MeasurementFieldRow } from './MeasurementFieldRow';

export const metadata: Metadata = { title: 'Your list of measurements' };

export default async function MeasurementListPage() {
  await requireUser();
  const fields = await loadMeasurementFields(await createSupabase());
  const visible = fields.filter((f) => !f.archived);
  const hidden = fields.filter((f) => f.archived);

  return (
    <>
      <div className="page-head">
        <BackLink href="/settings">Settings</BackLink>
        <h1>Your list of measurements</h1>
        <p className="lede">
          These are the measurements asked for when you record a client. A starter list was set up for you:
          rename, reorder, hide and add until it matches how you work.
        </p>
        <p className="hint">
          Renaming changes the name everywhere, including measurements already saved. Hiding only stops a
          measurement being asked for on new forms; nothing already saved is lost.
        </p>
      </div>

      <section className="section" aria-labelledby="visible-heading">
        <div className="section__head">
          <h2 id="visible-heading">Asked for on every form</h2>
        </div>
        {visible.length === 0 ? (
          <div className="card card--warn" role="status">
            <p>Nothing is on the list, so there is nothing to measure. Add a measurement below.</p>
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
            <p className="hint">Not asked for on new forms. Measurements saved with them still show them.</p>
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
