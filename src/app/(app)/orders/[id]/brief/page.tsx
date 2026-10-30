import { notFound } from 'next/navigation';
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

/** The design brief: what is being made and how it should look. */
export default async function OrderBriefPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const order = await getOrder(id);
  if (!order) notFound();

  const supabase = await createSupabase();
  const [sets, pictures] = await Promise.all([
    loadMeasurementSets(supabase, order.client.id),
    loadAttachments(supabase, order.id),
  ]);
  const closed = isClosed(order.status);

  return (
    <>
      <section className="section" aria-labelledby="garments-heading">
        <div className="section__head">
          <h2 id="garments-heading">{order.garments.length === 1 ? 'Garment' : 'Garments'}</h2>
        </div>
        {order.garments.length === 0 ? (
          <div className="card">
            <p>No garment on this job. Add one if something is being made or fixed.</p>
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
        {!closed && <AddGarmentForm orderId={order.id} />}
      </section>

      <section className="section" aria-labelledby="pictures-heading">
        <div className="section__head">
          <h2 id="pictures-heading">Sketches and photos</h2>
          <p className="hint">
            Your sketches, the client&apos;s inspiration, fabric swatches. A revised sketch is kept next to
            the first.
          </p>
        </div>
        {pictures.length === 0 ? (
          <div className="card">
            <p>No pictures yet.</p>
          </div>
        ) : (
          <ul className="photos">
            {pictures.map((p) => (
              <PhotoCard key={p.id} picture={p} editable={!closed} />
            ))}
          </ul>
        )}
        {!closed && <UploadForm orderId={order.id} />}
      </section>
    </>
  );
}
