import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StatusChip } from '@/components/StatusChip';
import { formatDay } from '@/domain/dates';
import { isUuid } from '@/domain/form-input';
import { KIND_WORDS } from '@/domain/jobs/kinds';
import { describeHandover, orderTitle } from '@/domain/orders/display';
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
  return { title: order ? `Job #${order.number}` : 'Job' };
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

  const handover = describeHandover(order.deliveryOn, prefs.today);
  const garments = order.garments.map((g) => g.garmentType);

  return (
    <>
      <div className="page-head">
        <p className="crumbs">
          <Link href="/orders">Jobs</Link> / #{order.number}
        </p>
        <div className="title-row">
          <h1>
            {KIND_WORDS[order.kind].label} {orderTitle(order.number, garments)}
          </h1>
          <StatusChip status={order.status} />
        </div>
        <p className="lede">
          <Link href={`/clients/${order.client.id}`}>{order.client.name}</Link> ·{' '}
          {KIND_WORDS[order.kind].dueLabel} {formatDay(order.deliveryOn)}
          {!isClosed(order.status) && (
            <>
              {' '}
              (<span className={handover.past ? 'late' : undefined}>{handover.text}</span>)
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
        order={{ id: order.id, status: order.status, deliveryOn: order.deliveryOn }}
        today={prefs.today}
      />
      <OrderTabs orderId={order.id} />
      {children}
    </>
  );
}
