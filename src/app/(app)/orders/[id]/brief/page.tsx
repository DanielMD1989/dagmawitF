import { notFound } from 'next/navigation';
import { ATTACHMENT_GROUP, ATTACHMENT_KINDS } from '@/domain/files';
import { isUuid } from '@/domain/form-input';
import { garmentMeasurementStatus } from '@/domain/measurements/sets';
import { isClosed } from '@/domain/orders/status';
import { loadMeasurementSets } from '@/server/measurements';
import { getOrder, loadAttachments } from '@/server/orders';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';
import { AddGarmentForm } from '../AddGarmentForm';
import { GarmentCard } from '../GarmentCard';
import { PhotoCard } from '../PhotoCard';
import { UploadForm } from '../UploadForm';

/**
 * The job's Design brief: what is made, in her words, and its pictures, each kind (sketches, the client's
 * inspiration, fabric, fittings) under its own heading with its own button to add one.
 */
export default async function OrderBriefPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const order = await getOrder(id);
  if (!order) notFound();

  const supabase = await createSupabase();
  const [sets, pictures] = await Promise.all([
    order.client ? loadMeasurementSets(supabase, order.client.id) : Promise.resolve([]),
    loadAttachments(supabase, order.id),
  ]);
  const closed = isClosed(order.status);

  const groups = ATTACHMENT_KINDS.map((kind) => ({
    kind,
    pictures: pictures.filter((p) => p.kind === kind),
  })).filter((g) => !closed || g.pictures.length > 0);

  return (
    <>
      <section className="section" aria-labelledby="made-heading">
        <div className="section__head">
          <h2 id="made-heading">What is made</h2>
          <p className="hint">
            What the client asked for. Two pieces for one client, such as a matching outfit, go on the same
            job.
          </p>
        </div>
        {order.garments.length === 0 ? (
          <div className="card">
            <p>Nothing written yet. Add what is being made or fixed.</p>
          </div>
        ) : (
          order.garments.map((g) => (
            <GarmentCard
              key={g.id}
              orderId={order.id}
              garment={g}
              measurement={garmentMeasurementStatus(g.measurementSetId, sets)}
              editable={!closed}
            />
          ))
        )}
        {!closed && <AddGarmentForm orderId={order.id} first={order.garments.length === 0} />}
      </section>

      <section className="section" aria-labelledby="pictures-heading">
        <div className="section__head">
          <h2 id="pictures-heading">Pictures</h2>
          <p className="hint">A revised sketch is kept next to the first, numbered.</p>
        </div>
        {closed && groups.length === 0 && (
          <div className="card">
            <p>No pictures.</p>
          </div>
        )}
        {groups.map(({ kind, pictures: these }) => (
          <div key={kind} className="picture-group" role="group" aria-labelledby={`pictures-${kind}`}>
            <h3 id={`pictures-${kind}`}>{ATTACHMENT_GROUP[kind].heading}</h3>
            {these.length > 0 && (
              <ul className="photos">
                {these.map((p) => (
                  <PhotoCard key={p.id} picture={p} editable={!closed} />
                ))}
              </ul>
            )}
            {!closed && <UploadForm orderId={order.id} kind={kind} />}
          </div>
        ))}
      </section>
    </>
  );
}
