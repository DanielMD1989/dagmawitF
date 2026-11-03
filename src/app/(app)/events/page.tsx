import type { Metadata } from 'next';
import Link from 'next/link';
import { BackLink } from '@/components/BackLink';
import { QuickActions } from '@/components/QuickActions';
import { StatusChip } from '@/components/StatusChip';
import { formatDay } from '@/domain/dates';
import { daysLeft } from '@/domain/jobs/words';
import { eventsList } from '@/domain/orders/lists';
import { loadOrders, type OrderListItem } from '@/server/orders';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';

export const metadata: Metadata = { title: 'Events' };

/**
 * Her events, bazaars and shows (decision 0090): not orders, so listed apart from them. Coming, soonest first; then
 * the past ones, newest first.
 */
export default async function EventsPage() {
  await requireUser();
  const supabase = await createSupabase();
  const [prefs, orders] = await Promise.all([loadPreferences(supabase), loadOrders(supabase)]);
  const { coming, past } = eventsList(orders, prefs.today);

  return (
    <>
      <BackLink href="/orders">Orders</BackLink>
      <div className="page-head">
        <p className="eyebrow">Events</p>
        <h1>Your events</h1>
      </div>

      <QuickActions actions={[{ href: '/orders/new?event=1', label: 'New event', icon: 'event' }]} />

      <section className="section" aria-labelledby="coming-heading">
        <h2 id="coming-heading" className="h3">
          Coming
        </h2>
        {coming.length === 0 ? (
          <p className="day-list__empty">No events coming. Press “New event” to add one.</p>
        ) : (
          <ul className="rows rows--links">
            {coming.map((e) => (
              <EventRow key={e.id} event={e} today={prefs.today} />
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <section className="section" aria-labelledby="past-heading">
          <h2 id="past-heading" className="h3">
            Past
          </h2>
          <ul className="rows rows--links">
            {past.map((e) => (
              <EventRow key={e.id} event={e} today={prefs.today} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function EventRow({ event: e, today }: { event: OrderListItem; today: string }) {
  const coming = e.deliveryOn >= today && e.status !== 'delivered' && e.status !== 'cancelled';
  return (
    <li>
      <Link href={`/orders/${e.id}`} className="row-link">
        <span className="row-link__title">{e.title}</span>
        <span className="hint">
          {formatDay(e.deliveryOn)}
          {coming && ` (${daysLeft(e.deliveryOn, today)})`}
          {e.steps > 0 && ` · ${e.done} of ${e.steps} to prepare done`}
        </span>
        {e.status === 'cancelled' && (
          <span className="row-link__side">
            <StatusChip status={e.status} />
          </span>
        )}
      </Link>
    </li>
  );
}
