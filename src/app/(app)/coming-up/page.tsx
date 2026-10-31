import type { Metadata } from 'next';
import Link from 'next/link';
import { BackLink } from '@/components/BackLink';
import { JobDueRow } from '@/components/JobDueRow';
import { byHorizon, comingUp } from '@/domain/jobs/words';
import { loadOrders } from '@/server/orders';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';

export const metadata: Metadata = { title: 'Coming up' };

/**
 * What is still to come (decision 0078): every confirmed delivery and event from tomorrow on, soonest first, with
 * the days left. Today's are on Today, with their steps; this page is the countdown, so the two never repeat.
 */
export default async function ComingUpPage() {
  await requireUser();
  const supabase = await createSupabase();
  const [prefs, jobs] = await Promise.all([loadPreferences(supabase), loadOrders(supabase)]);
  const upcoming = comingUp(
    jobs.map((j) => ({ ...j, dueOn: j.deliveryOn })),
    prefs.today,
  );
  const { week, later } = byHorizon(upcoming, prefs.today);

  return (
    <>
      <div className="page-head">
        <BackLink href="/">Today</BackLink>
        <h1>Coming up</h1>
        <p className="lede">Deliveries and events ahead, soonest first.</p>
      </div>

      {upcoming.length === 0 ? (
        <div className="card">
          <p>Nothing due after today.</p>
          <p className="hint">
            A job&apos;s delivery day or an event&apos;s day shows here, counted down.{' '}
            <Link href="/orders/new?event=1">Add an event</Link>
          </p>
        </div>
      ) : (
        <>
          {week.length > 0 && (
            <section className="section" aria-labelledby="week-heading">
              <h2 id="week-heading">This week</h2>
              <ul className="rows rows--links">
                {week.map((u) => (
                  <JobDueRow key={u.job.id} job={u.job} day={u.day} left={u.left} />
                ))}
              </ul>
            </section>
          )}
          {later.length > 0 && (
            <section className="section" aria-labelledby="later-heading">
              <h2 id="later-heading">Later</h2>
              <ul className="rows rows--links">
                {later.map((u) => (
                  <JobDueRow key={u.job.id} job={u.job} day={u.day} left={u.left} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}
