import type { Metadata } from 'next';
import { CancelLink } from '@/components/BackLink';
import { notFound } from 'next/navigation';
import { asId, isUuid } from '@/domain/form-input';
import { loadClient } from '@/server/clients';
import { loadMeasurementFields, loadMeasurementSets } from '@/server/measurements';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';
import { MeasurementsForm } from './MeasurementsForm';

export const metadata: Metadata = { title: 'Record measurements' };

export default async function RecordMeasurementsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ order?: string }>;
}) {
  await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const query = await searchParams;
  const orderId = asId(query.order);

  const supabase = await createSupabase();
  const [client, sets, fields, prefs] = await Promise.all([
    loadClient(supabase, id),
    loadMeasurementSets(supabase, id),
    loadMeasurementFields(supabase),
    loadPreferences(supabase),
  ]);
  if (!client) notFound();

  const latest = sets[0] ?? null;
  // Start from the last version so she changes only what changed. Numbers are never converted between units,
  // so if the last version is in the other unit the form starts empty.
  const continues = latest !== null && latest.unit === prefs.measurementUnit;
  const visible = fields.filter((f) => !f.archived);

  return (
    <div className="form-screen">
      <div className="page-head">
        <CancelLink href={orderId ? `/orders/${orderId}/measurements` : `/clients/${client.id}`} />
        <h1>Measurements</h1>
      </div>
      {visible.length === 0 ? (
        <div className="card card--warn" role="alert">
          <p>No measurements are set up.</p>
        </div>
      ) : (
        <MeasurementsForm
          clientId={client.id}
          orderId={orderId}
          fields={visible}
          unit={prefs.measurementUnit}
          today={prefs.today}
          startingValues={continues ? latest.measures : {}}
        />
      )}
    </div>
  );
}
