import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { MeasurementVersions } from '@/components/MeasurementVersions';
import { StatusChip } from '@/components/StatusChip';
import { formatDay } from '@/domain/dates';
import { isUuid } from '@/domain/form-input';
import { orderLabel } from '@/domain/orders/display';
import { loadClient } from '@/server/clients';
import { loadMeasurementFields, loadMeasurementSets } from '@/server/measurements';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';
import { ClientForm } from '../ClientForm';
import { deleteClient } from '../actions';

export const metadata: Metadata = { title: 'Client' };

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const supabase = await createSupabase();
  const [client, sets, fields] = await Promise.all([
    loadClient(supabase, id),
    loadMeasurementSets(supabase, id),
    loadMeasurementFields(supabase),
  ]);
  if (!client) notFound();

  return (
    <>
      <div className="page-head">
        <p className="crumbs">
          <Link href="/clients">Clients</Link> / {client.name}
        </p>
        <h1>{client.name}</h1>
        {client.phone && (
          <p className="lede">
            <a href={`tel:${client.phone.replace(/[^0-9+]/g, '')}`}>{client.phone}</a>
          </p>
        )}
      </div>

      <section className="section" aria-labelledby="orders-heading">
        <div className="section__head">
          <h2 id="orders-heading">Orders</h2>
        </div>
        {client.orders.length === 0 ? (
          <div className="card">
            <p>No orders for {client.name} yet.</p>
          </div>
        ) : (
          <ul className="rows rows--links">
            {client.orders.map((o) => (
              <li key={o.id}>
                <Link href={`/orders/${o.id}`} className="row-link">
                  <span className="row-link__title">{orderLabel(o.number, o.garmentTypes)}</span>
                  <span className="hint">Handover {formatDay(o.deliveryOn)}</span>
                  <span className="row-link__side">
                    <StatusChip status={o.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="btn-row">
          <Link href={`/orders/new?client=${client.id}`} className="btn">
            New order for {client.name}
          </Link>
        </div>
      </section>

      <section className="section" aria-labelledby="measurements-heading">
        <div className="section__head">
          <h2 id="measurements-heading">Measurements</h2>
          <p className="hint">
            Every time she is measured is saved as a new version, so a garment can always be traced to the
            numbers it was made to.
          </p>
        </div>
        {sets.length === 0 ? (
          <div className="card">
            <p>No measurements recorded for {client.name} yet.</p>
          </div>
        ) : (
          <MeasurementVersions sets={sets} fields={fields} />
        )}
        <div className="btn-row">
          <Link href={`/clients/${client.id}/measurements/new`} className="btn btn--quiet">
            {sets.length === 0 ? 'Record measurements' : 'Record new measurements'}
          </Link>
        </div>
      </section>

      <section className="section" aria-labelledby="details-heading">
        <div className="section__head">
          <h2 id="details-heading">Details</h2>
        </div>
        <ClientForm client={client} />
      </section>

      <section className="section" aria-labelledby="delete-heading">
        <div className="section__head">
          <h2 id="delete-heading">Remove this client</h2>
        </div>
        {client.orders.length > 0 ? (
          <p className="hint">
            {client.name} has {client.orders.length === 1 ? 'an order' : 'orders'} (
            {orderLabel(client.orders[0]!.number, client.orders[0]!.garmentTypes)}
            {client.orders.length > 1 ? ' and more' : ''}), and orders are kept as a record, so she cannot be
            removed.
          </p>
        ) : (
          <ConfirmAction
            action={deleteClient}
            fields={{ id: client.id }}
            label="Remove this client"
            question={`Remove ${client.name}, with all her saved measurements? This cannot be undone.`}
            confirmLabel="Yes, remove"
          />
        )}
      </section>
    </>
  );
}
