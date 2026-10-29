import type { Metadata } from 'next';
import Link from 'next/link';
import { StatusChip } from '@/components/StatusChip';
import { formatDay } from '@/domain/dates';
import { describeHandover, orderLabel } from '@/domain/orders/display';
import { readinessWarnings, readyCount } from '@/domain/orders/prerequisites';
import { isClosed, isOrderStatus, STATUS_LABEL, type OrderStatus } from '@/domain/orders/status';
import { loadOrders } from '@/server/orders';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';

export const metadata: Metadata = { title: 'Orders' };

type Filter = OrderStatus | 'all';

// Active first, because that is what she is working through; the rest are a tap away.
const FILTERS: readonly Filter[] = ['active', 'draft', 'on_hold', 'delivered', 'cancelled', 'all'];

function readFilter(value: string | undefined): Filter {
  if (value === 'all') return 'all';
  return isOrderStatus(value) ? value : 'active';
}

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireUser();
  const filter = readFilter((await searchParams).status);
  const supabase = await createSupabase();
  const prefs = await loadPreferences(supabase);
  const orders = await loadOrders(supabase, prefs.today);

  const count = (f: Filter) => (f === 'all' ? orders.length : orders.filter((o) => o.status === f).length);
  const shown = orders.filter((o) => filter === 'all' || o.status === filter);
  // A finished order is looked up by when it was handed over, newest first. The rest by what is due next.
  if (filter === 'delivered' || filter === 'cancelled') shown.reverse();

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Orders</p>
        <h1>What she is making</h1>
        <p className="lede">
          Soonest handover first. Open an order for its brief, measurements and what it is waiting for.
        </p>
      </div>

      <div className="btn-row">
        <Link href="/orders/new" className="btn">
          New order
        </Link>
        <Link href="/clients" className="btn btn--quiet">
          Clients
        </Link>
      </div>

      <nav aria-label="Filter orders">
        <div className="segmented">
          {FILTERS.map((f) => (
            <Link
              key={f}
              href={f === 'active' ? '/orders' : `/orders?status=${f}`}
              aria-current={f === filter ? 'true' : undefined}
            >
              {f === 'all' ? 'All' : STATUS_LABEL[f]} ({count(f)})
            </Link>
          ))}
        </div>
      </nav>

      {shown.length === 0 ? (
        <div className="card">
          <p>
            {orders.length === 0
              ? 'No orders yet. Press “New order” to enter the first one.'
              : `No ${filter === 'all' ? '' : STATUS_LABEL[filter].toLowerCase() + ' '}orders.`}
          </p>
        </div>
      ) : (
        <ul className="rows rows--links">
          {shown.map((o) => {
            const handover = describeHandover(o.deliveryOn, prefs.today);
            const planned = o.status === 'active' || o.status === 'on_hold' || o.status === 'draft';
            const warnings = o.status === 'active' ? readinessWarnings(o.readiness) : [];
            return (
              <li key={o.id}>
                <Link href={`/orders/${o.id}`} className="row-link">
                  <span className="row-link__title">{orderLabel(o.number, o.garmentTypes)}</span>
                  <span className="hint">
                    {o.clientName} · Handover {formatDay(o.deliveryOn)}
                    {!isClosed(o.status) && (
                      <>
                        {' '}
                        (<span className={handover.past ? 'late' : undefined}>{handover.text}</span>)
                      </>
                    )}
                    {planned && o.readiness.total > 0 && ` · ${readyCount(o.readiness)}`}
                    {warnings.length > 0 && <span className="late"> · {warnings.join(', ')}</span>}
                  </span>
                  <span className="row-link__side">
                    <StatusChip status={o.status} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
