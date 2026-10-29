import { notFound } from 'next/navigation';
import { formatDay } from '@/domain/dates';
import { isUuid } from '@/domain/form-input';
import { garmentMeasurementStatus } from '@/domain/measurements/sets';
import { isClosed } from '@/domain/orders/status';
import { ConfirmAction } from '@/components/ConfirmAction';
import { loadClients } from '@/server/clients';
import { loadMeasurementSets } from '@/server/measurements';
import { getOrder, loadAttachments } from '@/server/orders';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';
import { AddGarmentForm } from './AddGarmentForm';
import { GarmentCard } from './GarmentCard';
import { OrderDetailsForm } from './OrderDetailsForm';
import { PhotoCard } from './PhotoCard';
import { UploadForm } from './UploadForm';
import { deleteDraft } from './actions';

/** The design brief: what is being made, how it should look, and the order's own details. */
export default async function OrderBriefPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const order = await getOrder(id);
  if (!order) notFound();

  const supabase = await createSupabase();
  const [clients, sets, pictures] = await Promise.all([
    loadClients(supabase),
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
          <div className="card card--warn" role="status">
            <p>This order has no garment yet. Add one before it can be confirmed.</p>
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
            Her sketches, the client&apos;s inspiration, fabric swatches. A revised sketch is kept next to the
            first.
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

      <section className="section" aria-labelledby="details-heading">
        <div className="section__head">
          <h2 id="details-heading">Order details</h2>
        </div>
        {closed && (
          <dl className="facts card">
            <dt>Client</dt>
            <dd>{order.client.name}</dd>
            <dt>Handover day</dt>
            <dd>{formatDay(order.deliveryOn)}</dd>
            <dt>Days kept free</dt>
            <dd>{order.bufferDays}</dd>
          </dl>
        )}
        <OrderDetailsForm
          order={{
            id: order.id,
            status: order.status,
            clientId: order.client.id,
            deliveryOn: order.deliveryOn,
            bufferDays: order.bufferDays,
            notes: order.notes,
          }}
          clients={clients.map((c) => ({ id: c.id, name: c.name }))}
        />
      </section>

      {order.status === 'draft' && (
        <section className="section" aria-labelledby="delete-heading">
          <div className="section__head">
            <h2 id="delete-heading">Delete this draft</h2>
            <p className="hint">
              A draft has made no promise, so it can be deleted completely. To keep a record of an order that
              is called off, cancel it instead.
            </p>
          </div>
          <ConfirmAction
            action={deleteDraft}
            fields={{ id: order.id }}
            label="Delete this draft"
            question={`Delete order #${order.number}, with its garments, preparation list and pictures? This cannot be undone.`}
            confirmLabel="Yes, delete"
            pendingText="Deleting…"
          />
        </section>
      )}
    </>
  );
}
