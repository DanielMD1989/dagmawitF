import type { Metadata } from 'next';
import Link from 'next/link';
import { AddLink, PageTitle } from '@/components/PageTitle';
import { Chevron } from '@/components/Sheet';
import { StatusChip } from '@/components/StatusChip';
import { DeliverNowButton } from '@/components/steps/DeliverNowButton';
import { formatDay } from '@/domain/dates';
import { daysLeft, jobHeadline } from '@/domain/jobs/words';
import {
  activeOrders,
  handoverWords,
  historyByMonth,
  historyDay,
  nextIsLate,
  nextWords,
  type OrdersTab,
} from '@/domain/orders/lists';
import { loadOrders, type OrderListItem } from '@/server/orders';
import { carryOver } from '@/server/steps';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';

export const metadata: Metadata = { title: 'Orders' };

/**
 * Her customers' orders under two tabs (decision 0090): Active, what she is working through, soonest first, with
 * drafts and paused orders marked; History, what is finished or cancelled, newest first by month. An event is not an
 * order: it has its own list (/events).
 */
export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireUser();
  const tab: OrdersTab = (await searchParams).tab === 'history' ? 'history' : 'active';
  const supabase = await createSupabase();
  // Unfinished steps move to today first (decision 0080), so each order's next step is where it now is.
  await carryOver(supabase);
  const [prefs, orders] = await Promise.all([loadPreferences(supabase), loadOrders(supabase)]);
  const active = activeOrders(orders);
  const history = historyByMonth(orders);
  const historyCount = history.reduce((n, m) => n + m.orders.length, 0);

  return (
    <>
      <PageTitle title="Orders" action={<AddLink href="/orders/new" label="New order" />} />

      <nav aria-label="Orders">
        <div className="segmented segmented--bar">
          <Link href="/orders" aria-current={tab === 'active' ? 'true' : undefined}>
            Active ({active.length})
          </Link>
          <Link href="/orders?tab=history" aria-current={tab === 'history' ? 'true' : undefined}>
            History ({historyCount})
          </Link>
        </div>
      </nav>

      {tab === 'active' ? (
        active.length === 0 ? (
          <div className="card">
            <p>
              {historyCount === 0
                ? 'No orders yet. Press + to take the first one.'
                : 'Nothing in progress. Finished orders are under History.'}
            </p>
          </div>
        ) : (
          <ul className="rows rows--links" aria-label="Active orders">
            {active.map((o) => (
              <ActiveRow key={o.id} order={o} today={prefs.today} />
            ))}
          </ul>
        )
      ) : historyCount === 0 ? (
        <div className="card">
          <p>
            No finished orders yet. An order comes here once its Delivery is ticked, or it is marked finished.
          </p>
        </div>
      ) : (
        history.map(({ month, orders: inMonth }) => (
          <section key={month} className="section" aria-label={month}>
            <h2 className="h3">{month}</h2>
            <ul className="rows rows--links">
              {inMonth.map((o) => (
                <li key={o.id}>
                  <Link href={`/orders/${o.id}`} className="row-link order-row">
                    <DateTile day={historyDay(o)} tone={o.status === 'cancelled' ? 'late' : 'done'} />
                    <span className="order-row__main">
                      <span className="row-link__title">
                        {o.clientName}
                        {o.status === 'cancelled' && (
                          <>
                            {' '}
                            <StatusChip status={o.status} />
                          </>
                        )}
                      </span>
                      <span className="order-row__what">
                        {o.title ? `${o.title} · ` : ''}#{o.number}
                      </span>
                      <span className="order-row__done">{handoverWords(o)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {/* Her events, kept apart from her orders (decision 0090). */}
      <nav className="link-rows" aria-label="More">
        <Link href="/events" className="sheet__row">
          Events
          <Chevron />
        </Link>
      </nav>
    </>
  );
}

/** "Tue / 10 / Nov": the day an order is due, as a phone calendar shows a date (decision 0105). */
function DateTile({ day, tone = 'due' }: { day: string; tone?: 'due' | 'late' | 'done' }) {
  const [weekday, date, month] = formatDay(day).split(' ');
  return (
    <span className={tone === 'due' ? 'date-tile' : `date-tile date-tile--${tone}`} aria-hidden="true">
      <span className="date-tile__small">{weekday}</span>
      <span className="date-tile__big">{date}</span>
      <span className="date-tile__small">{month}</span>
    </span>
  );
}

/**
 * An order in progress (decision 0105): its day as a date, who it is for, what it is, and what comes next. A draft or
 * a paused one says so.
 */
function ActiveRow({ order: o, today }: { order: OrderListItem; today: string }) {
  const late = o.status === 'active' && o.deliveryOn < today;
  // Only an active order is handed over: a draft or a paused one is started or resumed first.
  const deliverNow = o.status === 'active' && o.next.kind === 'step' && o.next.deliverNow;
  return (
    <li className={deliverNow ? 'row--action' : undefined}>
      <Link href={`/orders/${o.id}`} className="row-link order-row">
        <DateTile day={o.deliveryOn} tone={late ? 'late' : 'due'} />
        <span className="order-row__main">
          <span className="row-link__title">
            {o.clientName}
            {o.status !== 'active' && (
              <>
                {' '}
                <StatusChip status={o.status} />
              </>
            )}
          </span>
          <span className="order-row__what">
            {o.title ? `${o.title} · ` : ''}#{o.number}
            <span className="sr-only">, delivery {formatDay(o.deliveryOn)}</span>
            {' · '}
            <span className={late ? 'late' : undefined}>{daysLeft(o.deliveryOn, today)}</span>
          </span>
          <span className={nextIsLate(o.next, today) ? 'order-row__next late' : 'order-row__next'}>
            {nextWords(o.next, today)}
          </span>
        </span>
      </Link>
      {/* Only its Delivery left: delivered now, even ahead of its day (decision 0097). */}
      {deliverNow && <DeliverNowButton orderId={o.id} today={today} whose={jobHeadline(o)} />}
    </li>
  );
}
