import type { Metadata } from 'next';
import Link from 'next/link';
import { BackLink } from '@/components/BackLink';
import { todayIn } from '@/domain/dates';
import { compared, orderNumbers, type Period } from '@/domain/orders/numbers';
import { loadOrders } from '@/server/orders';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';

export const metadata: Metadata = { title: 'Numbers' };

/**
 * How her orders are going (decision 0091): this week or month against the last, the last twelve as bars, on-time
 * handovers, what is in hand now and who orders most. Customer orders only.
 */
export default async function NumbersPage({ searchParams }: { searchParams: Promise<{ by?: string }> }) {
  await requireUser();
  const period: Period = (await searchParams).by === 'month' ? 'month' : 'week';
  const supabase = await createSupabase();
  const [prefs, orders] = await Promise.all([loadPreferences(supabase), loadOrders(supabase)]);
  const n = orderNumbers(
    orders.map((o) => ({ ...o, takenOn: todayIn(prefs.timezone, new Date(o.createdAt)) })),
    prefs.today,
    period,
  );
  const [last, current] = [n.buckets.at(-2)!, n.buckets.at(-1)!];
  const span = `${n.buckets.length} ${period}s`;
  const most = Math.max(1, ...n.buckets.flatMap((b) => [b.taken, b.delivered]));
  const onTime = n.onTime.delivered === 0 ? null : Math.round((100 * n.onTime.onTime) / n.onTime.delivered);

  return (
    <>
      <BackLink href="/orders">Orders</BackLink>
      <div className="page-head">
        <p className="eyebrow">Numbers</p>
        <h1>How it’s going</h1>
      </div>

      <nav aria-label="By week or by month">
        <div className="segmented">
          <Link href="/numbers" aria-current={period === 'week' ? 'true' : undefined}>
            By week
          </Link>
          <Link href="/numbers?by=month" aria-current={period === 'month' ? 'true' : undefined}>
            By month
          </Link>
        </div>
      </nav>

      <section className="section" aria-labelledby="this-heading">
        <h2 id="this-heading" className="h3">
          This {period}
        </h2>
        <ul className="stats">
          <li className="stat">
            <span className="stat__label">Orders taken</span>
            <span className="stat__value">{current.taken}</span>
            <span className="stat__note">{compared(current.taken, last.taken, period)}</span>
          </li>
          <li className="stat">
            <span className="stat__label">Delivered</span>
            <span className="stat__value">{current.delivered}</span>
            <span className="stat__note">{compared(current.delivered, last.delivered, period)}</span>
          </li>
          <li className="stat">
            <span className="stat__label">On time</span>
            <span className="stat__value">{onTime === null ? '–' : `${onTime}%`}</span>
            <span className="stat__note">
              {n.onTime.delivered === 0
                ? `none delivered in ${span}`
                : `${n.onTime.onTime} of ${n.onTime.delivered} in ${span}`}
            </span>
          </li>
          <li className="stat">
            <span className="stat__label">Days per order</span>
            <span className="stat__value">{n.averageDays ?? '–'}</span>
            <span className="stat__note">from taking to delivering, on average</span>
          </li>
        </ul>
      </section>

      <section className="section card" aria-labelledby="chart-heading">
        <h2 id="chart-heading" className="h3">
          Taken and delivered, last {span}
        </h2>
        <ul className="chart__key" aria-label="Key">
          <li>
            <span className="chart__swatch chart__swatch--taken" aria-hidden="true" /> Taken
          </li>
          <li>
            <span className="chart__swatch chart__swatch--delivered" aria-hidden="true" /> Delivered
          </li>
        </ul>
        {/* The bars are for the eye; the same numbers are in the table below for everyone. */}
        <div className={`chart chart--${period}`} aria-hidden="true">
          <div className="chart__plot">
            <span className="chart__top">{most}</span>
            {n.buckets.map((b) => (
              <div key={b.start} className="chart__col">
                <span
                  className="chart__bar chart__bar--taken"
                  style={{ height: `${(100 * b.taken) / most}%` }}
                />
                <span
                  className="chart__bar chart__bar--delivered"
                  style={{ height: `${(100 * b.delivered) / most}%` }}
                />
                <span className="chart__tip">
                  {b.long}
                  <br />
                  {b.taken} taken · {b.delivered} delivered
                </span>
              </div>
            ))}
          </div>
          <div className="chart__labels">
            {n.buckets.map((b) => (
              <span key={b.start}>{b.label}</span>
            ))}
          </div>
        </div>
        <details className="disclosure disclosure--link">
          <summary>See as a table</summary>
          <div className="disclosure__panel">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{period === 'week' ? 'Week of' : 'Month'}</th>
                  <th scope="col">Taken</th>
                  <th scope="col">Delivered</th>
                </tr>
              </thead>
              <tbody>
                {[...n.buckets].reverse().map((b) => (
                  <tr key={b.start}>
                    <th scope="row">{b.long.replace('Week of ', '')}</th>
                    <td>{b.taken}</td>
                    <td>{b.delivered}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section className="section" aria-labelledby="now-heading">
        <h2 id="now-heading" className="h3">
          In hand now
        </h2>
        <ul className="stats">
          <li className="stat">
            <span className="stat__label">In progress</span>
            <span className="stat__value">{n.now.active}</span>
          </li>
          <li className="stat">
            <span className="stat__label">Late</span>
            <span className={n.now.late > 0 ? 'stat__value late' : 'stat__value'}>{n.now.late}</span>
            <span className="stat__note">past their delivery day</span>
          </li>
          <li className="stat">
            <span className="stat__label">Drafts</span>
            <span className="stat__value">{n.now.drafts}</span>
          </li>
          <li className="stat">
            <span className="stat__label">On hold</span>
            <span className="stat__value">{n.now.onHold}</span>
          </li>
        </ul>
      </section>

      <section className="section" aria-labelledby="clients-heading">
        <h2 id="clients-heading" className="h3">
          Who orders most, last {span}
        </h2>
        {n.topClients.length === 0 ? (
          <p className="day-list__empty">No orders in these {span}.</p>
        ) : (
          <ol className="rows">
            {n.topClients.map((c) => (
              <li key={c.name}>
                <span>{c.name}</span>
                <span className="hint">
                  {c.orders} order{c.orders === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ol>
        )}
        {n.cancelled > 0 && (
          <p className="hint">
            {n.cancelled} order{n.cancelled === 1 ? ' was' : 's were'} cancelled in these {span}.
          </p>
        )}
      </section>
    </>
  );
}
