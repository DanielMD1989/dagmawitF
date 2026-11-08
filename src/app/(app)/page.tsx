import type { Metadata } from 'next';
import Link from 'next/link';
import { JobDueRow } from '@/components/JobDueRow';
import { PageTitle, Plus } from '@/components/PageTitle';
import { Chevron, Sheet } from '@/components/Sheet';
import { SaveForOffline } from '@/components/offline/SaveForOffline';
import { AddStepForm } from '@/components/steps/AddStepForm';
import { DayItems } from '@/components/steps/DayItems';
import { formatDay, formatDayLong } from '@/domain/dates';
import { dueNotShown } from '@/domain/jobs/words';
import { buildAgenda } from '@/domain/steps/agenda';
import { makeSnapshot } from '@/domain/steps/offline';
import { dayHeading, partLabel } from '@/domain/steps/words';
import { loadOrders } from '@/server/orders';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { carryOver, loadCalendarSteps } from '@/server/steps';
import { createSupabase } from '@/server/supabase';

export const metadata: Metadata = { title: 'Today' };

/**
 * Today and the week ahead: every step of her jobs and her own work, by day (docs/calendar-first.md). What is due
 * further on is on its own page, Coming up (decision 0078).
 */
export default async function TodayPage() {
  const user = await requireUser();
  const supabase = await createSupabase();
  // Her jobs need nothing else, so they load while her day is worked out; the steps need her day.
  const jobsLoading = loadOrders(supabase);
  // Yesterday's unfinished steps move to today (decision 0080) while her day is worked out, before her steps are read.
  const [{ name, timezone, today }] = await Promise.all([loadPreferences(supabase), carryOver(supabase)]);
  const [steps, jobs] = await Promise.all([loadCalendarSteps(supabase, today), jobsLoading]);
  const agenda = buildAgenda(steps, today, 7);
  const firstName = name.split(/\s+/)[0] ?? '';
  const snapshot = makeSnapshot({
    ownerId: user.id,
    today,
    timezone,
    madeAt: new Date(),
    firstName,
    agenda,
  });
  const [first, ...rest] = agenda.days;
  // A job due today is shown once: by its step today when it has one, else here as due today (decision 0078).
  const dueToday = dueNotShown(
    jobs.filter((j) => j.status === 'active' && j.deliveryOn === today),
    (first?.entries ?? []).map((e) => e.step.job?.id ?? null),
  );
  const later = rest.filter((d) => d.entries.length > 0);
  // What comes next for each order, said under a step once it is ticked (decision 0094).
  const nextOf = new Map(jobs.map((j) => [j.id, j.next]));
  const nothingAhead = agenda.days.every((d) => d.entries.length === 0) && agenda.overdue.length === 0;

  return (
    <>
      <SaveForOffline snapshot={snapshot} />
      <PageTitle
        eyebrow={formatDayLong(today)}
        title="Today"
        action={
          // What can be added from Today, in one sheet behind one "+" (decision 0105).
          <Sheet
            title="New"
            opener={<Plus />}
            openerClass="icon-btn icon-btn--round icon-btn--solid"
            openerLabel="New order, event, or something for yourself"
            chevron={false}
          >
            <div className="sheet__group">
              <Link href="/orders/new" className="sheet__row">
                New order
                <Chevron />
              </Link>
              <Link href="/orders/new?event=1" className="sheet__row">
                New event
                <Chevron />
              </Link>
              <AddStepForm orderId={null} day={today} summary="Something for yourself" idPrefix="own" row />
            </div>
          </Sheet>
        }
      />

      {agenda.overdue.length > 0 && (
        <section className="section" aria-labelledby="overdue-heading">
          <div className="section__head">
            <h2 id="overdue-heading">Not done yet</h2>
          </div>
          <ul className="items">
            <DayItems
              items={agenda.overdue.map((s) => ({ step: s, overdue: true }))}
              nextOf={nextOf}
              today={today}
            />
          </ul>
        </section>
      )}

      {first && (
        <section className="section day-list" aria-labelledby="today-heading">
          {/* The page is Today: its list needs no title of its own on screen. */}
          <h2 id="today-heading" className="sr-only">
            Today
          </h2>
          {dueToday.length > 0 && (
            <ul className="rows rows--links" aria-label="Due today">
              {dueToday.map((job) => (
                <JobDueRow key={job.id} job={job} day={formatDay(today)} left="today" />
              ))}
            </ul>
          )}
          {first.entries.length > 0 ? (
            <ul className="items">
              <DayItems
                items={first.entries.map((e) => ({ step: e.step, part: partLabel(e), clash: e.clash }))}
                nextOf={nextOf}
                today={today}
              />
            </ul>
          ) : (
            dueToday.length === 0 && <p className="day-list__empty">Nothing on today.</p>
          )}
        </section>
      )}

      {later.map((d) => (
        <section key={d.day} className="section day-list" aria-labelledby={`day-${d.day}`}>
          <div className="day-list__head">
            <h2 id={`day-${d.day}`} className="h3">
              {dayHeading(d.day, today)}
              {dayHeading(d.day, today) === 'Tomorrow' && <span className="hint"> · {formatDay(d.day)}</span>}
            </h2>
          </div>
          <ul className="items">
            <DayItems
              items={d.entries.map((e) => ({ step: e.step, part: partLabel(e), clash: e.clash }))}
              nextOf={nextOf}
              today={today}
            />
          </ul>
        </section>
      ))}

      {nothingAhead && (
        <div className="card">
          <p>Nothing on the calendar for the coming week.</p>
        </div>
      )}

      {agenda.undated.length > 0 && (
        <section className="section" aria-labelledby="undated-heading">
          <div className="section__head">
            <h2 id="undated-heading">Steps with no day yet</h2>
          </div>
          <ul className="items">
            <DayItems items={agenda.undated.map((s) => ({ step: s }))} nextOf={nextOf} today={today} />
          </ul>
        </section>
      )}

      <nav className="link-rows" aria-label="Further on">
        <Link href="/coming-up" className="sheet__row">
          Coming up
          <Chevron />
        </Link>
        <Link href="/calendar" className="sheet__row">
          The whole month
          <Chevron />
        </Link>
      </nav>
    </>
  );
}
