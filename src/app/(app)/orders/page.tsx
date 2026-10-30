import type { Metadata } from 'next';
import Link from 'next/link';
import { QuickActions } from '@/components/QuickActions';
import { StatusChip } from '@/components/StatusChip';
import { formatDay } from '@/domain/dates';
import { daysLeft, jobHeadline } from '@/domain/jobs/words';
import { isClosed, isOrderStatus, STATUS_LABEL, type OrderStatus } from '@/domain/orders/status';
import { loadOrders } from '@/server/orders';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';

export const metadata: Metadata = { title: 'Jobs' };

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
  const orders = await loadOrders(supabase);

  const count = (f: Filter) => (f === 'all' ? orders.length : orders.filter((o) => o.status === f).length);
  const shown = orders.filter((o) => filter === 'all' || o.status === filter);
  // A finished job is looked up by when it was handed over, newest first. The rest by what is due next.
  if (filter === 'delivered' || filter === 'cancelled') shown.reverse();

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Jobs</p>
        <h1>Your jobs</h1>
        <p className="lede">Soonest first.</p>
      </div>

      <QuickActions
        actions={[
          { href: '/orders/new', label: 'New job', icon: 'add' },
          { href: '/orders/new?event=1', label: 'New event', icon: 'event' },
          { href: '/clients', label: 'Clients', icon: 'clients' },
        ]}
      />

      <nav aria-label="Filter jobs">
        <div className="segmented segmented--swipe">
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
              ? 'No jobs yet. Press “New job” to take the first one.'
              : `No ${filter === 'all' ? '' : STATUS_LABEL[filter].toLowerCase() + ' '}jobs.`}
          </p>
        </div>
      ) : (
        <ul className="rows rows--links">
          {shown.map((o) => {
            const late = !isClosed(o.status) && o.deliveryOn < prefs.today;
            return (
              <li key={o.id}>
                <Link href={`/orders/${o.id}`} className="row-link">
                  <span className="row-link__title">{jobHeadline(o)}</span>
                  {/* Two short lines: when it is due, then how its steps stand. */}
                  <span className="hint">
                    #{o.number} · {o.clientName ? 'Delivery' : 'Event'} {formatDay(o.deliveryOn)}
                    {!isClosed(o.status) && (
                      <>
                        {' '}
                        (
                        <span className={late ? 'late' : undefined}>
                          {daysLeft(o.deliveryOn, prefs.today)}
                        </span>
                        )
                      </>
                    )}
                  </span>
                  {o.steps > 0 && (
                    <span className="hint">
                      {o.done} of {o.steps} steps done
                      {!isClosed(o.status) && o.next && (
                        <span className={o.next.onDay < prefs.today ? 'late' : undefined}>
                          {' '}
                          · Next: {o.next.title}, {formatDay(o.next.onDay)}
                        </span>
                      )}
                    </span>
                  )}
                  {/* Under one status the chip would say the same on every card; under All it tells them apart. */}
                  {filter === 'all' && (
                    <span className="row-link__side">
                      <StatusChip status={o.status} />
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
