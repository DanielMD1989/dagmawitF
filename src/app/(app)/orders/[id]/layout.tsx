import type { Metadata } from 'next';
import Link from 'next/link';
import { BackLink } from '@/components/BackLink';
import { notFound } from 'next/navigation';
import { StatusChip } from '@/components/StatusChip';
import { formatDay } from '@/domain/dates';
import { isUuid } from '@/domain/form-input';
import { daysLeft, jobHeadline } from '@/domain/jobs/words';
import { isClosed } from '@/domain/orders/status';
import { getOrder } from '@/server/orders';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';
import { OrderTabs } from './OrderTabs';
import { StatusActions } from './StatusActions';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const order = isUuid(id) ? await getOrder(id) : null;
  if (!order) return { title: 'Job' };
  return { title: order.client ? `Job #${order.number}` : order.title };
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
  const order = await getOrder(id);
  if (!order) notFound();
  const prefs = await loadPreferences(await createSupabase());

  return (
    <>
      <div className="page-head">
        <BackLink href="/orders">Jobs</BackLink>
        <div className="title-row">
          <h1>
            {jobHeadline({
              number: order.number,
              title: order.title,
              clientName: order.client?.name ?? null,
            })}
          </h1>
          <StatusChip status={order.status} />
        </div>
        <p className="lede">
          #{order.number} ·{' '}
          {order.client ? <Link href={`/clients/${order.client.id}`}>{order.client.name}</Link> : 'Event'} ·{' '}
          {order.client ? 'Delivery' : 'On'} {formatDay(order.deliveryOn)}
          {!isClosed(order.status) && (
            <>
              {' '}
              (
              <span className={order.deliveryOn < prefs.today ? 'late' : undefined}>
                {daysLeft(order.deliveryOn, prefs.today)}
              </span>
              )
            </>
          )}
        </p>
        {order.status === 'draft' && (
          <p className="hint">A draft is not on your calendar until it is confirmed.</p>
        )}
        {order.status === 'on_hold' && <p className="hint">On hold: {order.holdReason}</p>}
        {order.status === 'delivered' && order.deliveredOn && (
          <p className="hint">Finished on {formatDay(order.deliveredOn)}.</p>
        )}
        {order.status === 'cancelled' && (
          <p className="hint">Cancelled{order.cancelReason ? `: ${order.cancelReason}` : '.'}</p>
        )}
      </div>

      <StatusActions
        order={{ id: order.id, status: order.status, deliveryOn: order.deliveryOn, event: !order.client }}
        today={prefs.today}
      />
      <OrderTabs orderId={order.id} event={!order.client} />
      {children}
    </>
  );
}
