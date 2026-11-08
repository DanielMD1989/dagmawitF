import type { Metadata } from 'next';
import Link from 'next/link';
import { BackLink } from '@/components/BackLink';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { Sheet } from '@/components/Sheet';
import { StatusChip } from '@/components/StatusChip';
import { formatDay } from '@/domain/dates';
import { isUuid } from '@/domain/form-input';
import { daysLeft } from '@/domain/jobs/words';
import { isClosed } from '@/domain/orders/status';
import { loadClients } from '@/server/clients';
import { getOrder } from '@/server/orders';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';
import { deleteJob } from './actions';
import { OrderDetailsForm } from './OrderDetailsForm';
import { OrderTabs } from './OrderTabs';
import { StatusActions } from './StatusActions';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const order = isUuid(id) ? await getOrder(id) : null;
  if (!order) return { title: 'Order' };
  return { title: order.client ? `Order #${order.number}` : order.title };
}

export default async function OrderLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  // Both at once: each is a trip to the database.
  const supabase = await createSupabase();
  const [order, prefs, clients] = await Promise.all([
    getOrder(id),
    loadPreferences(supabase),
    loadClients(supabase),
  ]);
  if (!order) notFound();

  const event = !order.client;
  const closed = isClosed(order.status);
  const noun = event ? 'event' : 'order';
  const late = !closed && order.deliveryOn < prefs.today;

  return (
    <>
      <div className="topbar">
        {/* Back to the list it is on (decision 0090): an event to Events, a finished order to History. */}
        {event ? (
          <BackLink href="/events">Events</BackLink>
        ) : closed ? (
          <BackLink href="/orders?tab=history">History</BackLink>
        ) : (
          <BackLink href="/orders">Orders</BackLink>
        )}
        {/* What is done less often, together in one sheet (decision 0105): the other moves, its details, deleting. */}
        <Sheet
          title={event ? 'This event' : `Order #${order.number}`}
          opener={
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="19" cy="12" r="2" />
            </svg>
          }
          openerClass="icon-btn icon-btn--round"
          openerLabel={`More for this ${noun}`}
          chevron={false}
        >
          <StatusActions
            order={{ id: order.id, status: order.status, deliveryOn: order.deliveryOn, event }}
            today={prefs.today}
            part="more"
          />
          <div className="sheet__group">
            <details className="disclosure disclosure--row">
              <summary>{closed ? 'Change the notes' : `Change the ${noun} details`}</summary>
              <div className="disclosure__panel">
                <OrderDetailsForm
                  order={{
                    id: order.id,
                    status: order.status,
                    clientId: order.client?.id ?? null,
                    title: order.title,
                    dueOn: order.deliveryOn,
                    notes: order.notes,
                  }}
                  clients={clients.map((c) => ({ id: c.id, name: c.name }))}
                />
              </div>
            </details>
          </div>
          <div className="sheet__group sheet__group--warn">
            <ConfirmAction
              action={deleteJob}
              fields={{ id: order.id }}
              label={`Delete this ${noun}`}
              question={`Delete ${event ? `“${order.title}”` : `order #${order.number}`} completely? This cannot be undone. To keep a record, cancel it instead.`}
              confirmLabel="Yes, delete"
              pendingText="Deleting…"
            />
          </div>
        </Sheet>
      </div>

      <div className="page-head order-head">
        <p className="eyebrow">
          {order.client ? (
            <Link href={`/clients/${order.client.id}`} className="quiet-link">
              {order.client.name}
            </Link>
          ) : (
            'Event'
          )}{' '}
          · #{order.number}
        </p>
        <h1>{order.title || order.client?.name || `Order #${order.number}`}</h1>
        <p className="order-head__due">
          {order.client ? 'Delivery' : 'On'} {formatDay(order.deliveryOn)}
          {!closed && (
            <span className={late ? 'pill pill--late' : 'pill'}>
              {daysLeft(order.deliveryOn, prefs.today)}
            </span>
          )}
        </p>
        {order.status !== 'active' && (
          <p className="order-head__state">
            <StatusChip status={order.status} />
            {order.status === 'draft' && ' Not on your calendar yet.'}
            {order.status === 'on_hold' && order.holdReason && ` ${order.holdReason}`}
            {order.status === 'delivered' && order.deliveredOn && ` On ${formatDay(order.deliveredOn)}.`}
            {order.status === 'cancelled' && order.cancelReason && ` ${order.cancelReason}`}
          </p>
        )}
      </div>

      <StatusActions
        order={{ id: order.id, status: order.status, deliveryOn: order.deliveryOn, event }}
        today={prefs.today}
        part="main"
      />
      <OrderTabs orderId={order.id} event={event} />
      {children}
    </>
  );
}
