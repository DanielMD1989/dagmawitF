import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MeasurementVersions } from '@/components/MeasurementVersions';
import { formatDay } from '@/domain/dates';
import { isUuid } from '@/domain/form-input';
import {
  changesBetween,
  formatDelta,
  formatMeasure,
  garmentMeasurementStatus,
} from '@/domain/measurements/sets';
import { isClosed } from '@/domain/orders/status';
import { loadMeasurementFields, loadMeasurementSets } from '@/server/measurements';
import { getOrder } from '@/server/orders';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';
import { SwitchMeasurementsForm } from './SwitchMeasurementsForm';

/** Which version of the client's measurements each garment is made to, and whether a newer one exists. */
export default async function OrderMeasurementsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const order = await getOrder(id);
  if (!order) notFound();

  const client = order.client;
  if (!client)
    return (
      <div className="card">
        <p>This job is an event, for no client, so it has no measurements.</p>
      </div>
    );

  const supabase = await createSupabase();
  const [sets, fields] = await Promise.all([
    loadMeasurementSets(supabase, client.id),
    loadMeasurementFields(supabase),
  ]);
  const latest = sets[0];
  const closed = isClosed(order.status);
  const versions = sets.map((s) => ({
    id: s.id,
    label: `Version ${s.version} · taken ${formatDay(s.takenOn)} · ${s.unit}`,
  }));

  return (
    <>
      <section className="section" aria-labelledby="garments-heading">
        <div className="section__head">
          <h2 id="garments-heading">Which measurements each piece is made to</h2>
          <p className="hint">
            A garment keeps the measurements it was planned with, because it may already be cut to them. When
            a newer version exists you choose whether to switch.
          </p>
        </div>
        {order.garments.length === 0 && (
          <div className="card">
            <p>Nothing is written on this job yet. Add what is made under Design brief.</p>
          </div>
        )}
        {order.garments.map((g) => {
          const status = garmentMeasurementStatus(g.measurementSetId, sets);
          const chosen = sets.find((s) => s.id === g.measurementSetId);
          const changes =
            status.kind === 'outdated' && chosen && latest && chosen.unit === latest.unit
              ? changesBetween(chosen.measures, latest.measures, fields)
              : [];
          return (
            <article key={g.id} className="card" aria-labelledby={`g-${g.id}`}>
              <h3 id={`g-${g.id}`}>{g.garmentType}</h3>
              <p className={status.kind === 'outdated' || status.kind === 'not-chosen' ? 'late' : 'hint'}>
                {status.text}
              </p>
              {changes.length > 0 && latest && (
                <div>
                  <p className="eyebrow">What changed in version {latest.version}</p>
                  <ul className="plain-list">
                    {changes.map((c) => (
                      <li key={c.key}>
                        {c.label}:{' '}
                        {c.from === null
                          ? `now ${formatMeasure(c.to!, latest.unit)}`
                          : c.to === null
                            ? 'not measured this time'
                            : `${formatMeasure(c.from, latest.unit)} → ${formatMeasure(c.to, latest.unit)} (${formatDelta(c.from, c.to, latest.unit)})`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!closed && latest && status.kind !== 'current' && (
                <SwitchMeasurementsForm
                  garmentId={g.id}
                  garmentType={g.garmentType}
                  versions={versions}
                  suggested={latest.id}
                />
              )}
            </article>
          );
        })}
      </section>

      <section className="section" aria-labelledby="versions-heading">
        <div className="section__head">
          <h2 id="versions-heading">{client.name}&apos;s measurements</h2>
        </div>
        {sets.length === 0 ? (
          <div className="card">
            <p>Nothing has been measured for {client.name} yet.</p>
          </div>
        ) : (
          <MeasurementVersions sets={sets} fields={fields} />
        )}
        <div className="btn-row">
          <Link
            href={`/clients/${client.id}/measurements/new?order=${order.id}`}
            className={sets.length === 0 ? 'btn' : 'btn btn--quiet'}
          >
            {sets.length === 0 ? 'Record measurements' : 'Record new measurements'}
          </Link>
        </div>
      </section>
    </>
  );
}
