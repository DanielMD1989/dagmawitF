import type { Metadata } from 'next';
import Link from 'next/link';
import { JobDueRow } from '@/components/JobDueRow';
import { QuickActions } from '@/components/QuickActions';
import { SaveForOffline } from '@/components/offline/SaveForOffline';
import { AddStepForm } from '@/components/steps/AddStepForm';
import { StepEntry } from '@/components/steps/StepEntry';
import { openDayRule } from '@/domain/calendar/open';
import { formatDay, formatDayLong, hourIn } from '@/domain/dates';
import { greetingFor } from '@/domain/greeting';
import { dueNotShown } from '@/domain/jobs/words';
import { buildAgenda } from '@/domain/steps/agenda';
import { makeSnapshot } from '@/domain/steps/offline';
import { dayHeading, partLabel } from '@/domain/steps/words';
import { loadCalendarSettings } from '@/server/calendar';
import { loadOrders } from '@/server/orders';
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
  const [{ profile, week, exceptions, today }] = await Promise.all([
    loadCalendarSettings(supabase),
    carryOver(supabase),
  ]);
  const [steps, jobs] = await Promise.all([loadCalendarSteps(supabase, today), jobsLoading]);
  const agenda = buildAgenda(steps, today, 7);
  const isOpen = openDayRule(
    week.map((d) => d.weekday),
    exceptions,
  );
  const firstName = profile.name.split(/\s+/)[0] ?? '';
  const snapshot = makeSnapshot({
    ownerId: user.id,
    today,
    timezone: profile.timezone,
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
  const nothingAhead = agenda.days.every((d) => d.entries.length === 0) && agenda.overdue.length === 0;

  return (
    <>
      <SaveForOffline snapshot={snapshot} />
      <div className="page-head">
        <p className="eyebrow">{formatDayLong(today).replace(' ', ' · ')}</p>
        <div className="title-row">
          <h1>
            {greetingFor(hourIn(profile.timezone))}
            {firstName ? `, ${firstName}` : ''}.
          </h1>
        </div>
      </div>
      <QuickActions
        actions={[
          { href: '/orders/new', label: 'New job', icon: 'add' },
          { href: '/orders/new?event=1', label: 'New event', icon: 'event' },
          { href: '/coming-up', label: 'Coming up', icon: 'upcoming' },
          { href: '/calendar', label: 'Month', icon: 'month' },
        ]}
      />

      {agenda.overdue.length > 0 && (
        <section className="section" aria-labelledby="overdue-heading">
          <div className="section__head">
            <h2 id="overdue-heading">Not done yet</h2>
          </div>
          <ul className="items">
            {agenda.overdue.map((s) => (
              <StepEntry key={s.id} step={s} overdue />
            ))}
          </ul>
        </section>
      )}

      {first && (
        <section className="section day-list" aria-labelledby="today-heading">
          <div className="day-list__head">
            <h2 id="today-heading" className="h3">
              Today
            </h2>
            {!isOpen(today) && <span className="chip chip--muted">Not a working day</span>}
          </div>
          {dueToday.length > 0 && (
            <ul className="rows rows--links" aria-label="Due today">
              {dueToday.map((job) => (
                <JobDueRow key={job.id} job={job} day={formatDay(today)} left="today" />
              ))}
            </ul>
          )}
          {first.entries.length > 0 ? (
            <ul className="items">
              {first.entries.map((e) => (
                <StepEntry key={e.step.id} step={e.step} part={partLabel(e)} clash={e.clash} />
              ))}
            </ul>
          ) : (
            dueToday.length === 0 && <p className="day-list__empty">Nothing on today.</p>
          )}
          <AddStepForm orderId={null} day={today} summary="Add something for yourself" idPrefix="own" />
        </section>
      )}

      {later.map((d) => (
        <section key={d.day} className="section day-list" aria-labelledby={`day-${d.day}`}>
          <div className="day-list__head">
            <h2 id={`day-${d.day}`} className="h3">
              {dayHeading(d.day, today)}
              {dayHeading(d.day, today) === 'Tomorrow' && <span className="hint"> · {formatDay(d.day)}</span>}
            </h2>
            {!isOpen(d.day) && <span className="chip chip--muted">Not a working day</span>}
          </div>
          <ul className="items">
            {d.entries.map((e) => (
              <StepEntry key={e.step.id} step={e.step} part={partLabel(e)} clash={e.clash} />
            ))}
          </ul>
        </section>
      ))}

      {nothingAhead && (
        <div className="card">
          <p>Nothing on the calendar for the coming week.</p>
          <p className="hint">
            Take a job with <strong>New job</strong>: its steps get their days and show here.
          </p>
        </div>
      )}

      {agenda.undated.length > 0 && (
        <section className="section" aria-labelledby="undated-heading">
          <div className="section__head">
            <h2 id="undated-heading">Steps with no day yet</h2>
          </div>
          <ul className="items">
            {agenda.undated.map((s) => (
              <StepEntry key={s.id} step={s} />
            ))}
          </ul>
        </section>
      )}

      <p className="hint">
        <Link href="/calendar">See the whole month</Link>
      </p>
    </>
  );
}
