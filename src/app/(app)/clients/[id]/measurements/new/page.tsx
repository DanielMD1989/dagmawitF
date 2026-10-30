import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asId, isUuid } from '@/domain/form-input';
import { formatDay } from '@/domain/dates';
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
  // so if the last version is in the other unit the form starts empty and says why.
  const continues = latest !== null && latest.unit === prefs.measurementUnit;
  const visible = fields.filter((f) => !f.archived);

  return (
    <>
      <div className="page-head">
        <p className="crumbs">
          <Link href="/clients">Clients</Link> / <Link href={`/clients/${client.id}`}>{client.name}</Link> /
          Measurements
        </p>
        <h1>Measurements for {client.name}</h1>
        <p className="lede">
          {latest === null
            ? 'Fill in what you measured and leave the rest empty.'
            : continues
              ? `Starting from version ${latest.version}, taken ${formatDay(latest.takenOn)}. Change only what is different; this is saved as version ${latest.version + 1}.`
              : `Version ${latest.version} was taken in ${latest.unit === 'cm' ? 'centimetres' : 'inches'}, so this form starts empty. It is saved as version ${latest.version + 1}.`}
        </p>
      </div>
      {visible.length === 0 ? (
        <div className="card card--warn" role="alert">
          <p>
            Your list of measurements is empty.{' '}
            <Link href="/settings/measurements">Add the measurements you take</Link> first.
          </p>
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
    </>
  );
}
