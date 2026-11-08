import type { Metadata } from 'next';
import Link from 'next/link';
import { BackLink } from '@/components/BackLink';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { Sheet } from '@/components/Sheet';
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
      <div className="topbar">
        <BackLink href="/clients">Clients</BackLink>
        {/* Changing her details and removing her, together in one sheet (decision 0105). */}
        <Sheet
          title={client.name}
          opener={
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="19" cy="12" r="2" />
            </svg>
          }
          openerClass="icon-btn icon-btn--round"
          openerLabel="More for this client"
          chevron={false}
        >
          <div className="sheet__group">
            <details className="disclosure disclosure--row">
              <summary>Change her details</summary>
              <div className="disclosure__panel">
                <ClientForm client={client} />
              </div>
            </details>
          </div>
          <div className="sheet__group sheet__group--warn">
            {client.orders.length > 0 ? (
              <p className="sheet__note">
                {client.name} has {client.orders.length === 1 ? 'an order' : 'orders'}, kept as a record, so
                she cannot be removed.
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
          </div>
        </Sheet>
      </div>

      <div className="page-head">
        <h1>{client.name}</h1>
        {client.phone && (
          <p>
            <a href={`tel:${client.phone.replace(/[^0-9+]/g, '')}`} className="pill pill--call">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
              </svg>
              {client.phone}
            </a>
          </p>
        )}
      </div>

      <section className="section" aria-labelledby="orders-heading">
        <h2 id="orders-heading">Orders</h2>
        {client.orders.length > 0 && (
          <ul className="rows rows--links">
            {client.orders.map((o) => (
              <li key={o.id}>
                <Link href={`/orders/${o.id}`} className="row-link">
                  <span className="row-link__title">{orderLabel(o.number, o.garmentTypes)}</span>
                  <span className="hint">{formatDay(o.deliveryOn)}</span>
                  <span className="row-link__side">
                    <StatusChip status={o.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link href={`/orders/new?client=${client.id}`} className="btn btn--main">
          New order for {client.name}
        </Link>
      </section>

      <section className="section" aria-labelledby="measurements-heading">
        <h2 id="measurements-heading">Measurements</h2>
        {sets.length > 0 && <MeasurementVersions sets={sets} fields={fields} />}
        <Link href={`/clients/${client.id}/measurements/new`} className="btn btn--quiet">
          {sets.length === 0 ? 'Record measurements' : 'Record new measurements'}
        </Link>
      </section>

      {client.notes && (
        <section className="section" aria-labelledby="notes-heading">
          <h2 id="notes-heading">Notes</h2>
          <p className="card brief">{client.notes}</p>
        </section>
      )}
    </>
  );
}
