import type { Metadata } from 'next';
import Link from 'next/link';
import { SaveForOffline } from '@/components/offline/SaveForOffline';
import { AddStepForm } from '@/components/steps/AddStepForm';
import { StepEntry } from '@/components/steps/StepEntry';
import { openDayRule } from '@/domain/calendar/open';
import { formatDay, formatDayLong, hourIn } from '@/domain/dates';
import { greetingFor } from '@/domain/greeting';
import { comingUp, jobHeadline } from '@/domain/jobs/words';
import { buildAgenda } from '@/domain/steps/agenda';
import { makeSnapshot } from '@/domain/steps/offline';
import { dayHeading, partLabel } from '@/domain/steps/words';
import { loadCalendarSettings } from '@/server/calendar';
import { loadOrders } from '@/server/orders';
import { requireUser } from '@/server/session';
import { loadCalendarSteps } from '@/server/steps';
import { createSupabase } from '@/server/supabase';

export const metadata: Metadata = { title: 'Today' };

/** Today and the week ahead: every step of her jobs and her own work, by day (docs/calendar-first.md). */
export default async function TodayPage() {
  const user = await requireUser();
  const supabase = await createSupabase();
  const { profile, week, exceptions, today } = await loadCalendarSettings(supabase);
  const [steps, jobs] = await Promise.all([loadCalendarSteps(supabase, today), loadOrders(supabase)]);
  const upcoming = comingUp(
    jobs.map((j) => ({ ...j, dueOn: j.deliveryOn })),
    today,
  );
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
        <div className="btn-row">
          <Link href="/orders/new" className="btn">
            New job
          </Link>
          <Link href="/calendar" className="btn btn--quiet">
            Month
          </Link>
        </div>
      </div>

      {upcoming.length > 0 && (
        <section className="section" aria-labelledby="coming-heading">
          <div className="section__head">
            <h2 id="coming-heading" className="eyebrow">
              Coming up
            </h2>
          </div>
          <ul className="rows rows--links">
            {upcoming.map(({ job, day, left }) => (
              <li key={job.id}>
                <Link href={`/orders/${job.id}`} className="row-link">
                  <span className="row-link__title">{jobHeadline(job)}</span>
                  <span className="hint">
                    {job.clientName ? 'Delivery' : 'Event'} {day}
                  </span>
                  <span className="row-link__side">
                    <span
                      className={
                        left === 'today' || left === 'tomorrow' ? 'chip chip--sand' : 'chip chip--line'
                      }
                    >
                      {left}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {agenda.overdue.length > 0 && (
        <section className="section" aria-labelledby="overdue-heading">
          <div className="section__head">
            <h2 id="overdue-heading" className="eyebrow">
              Not done yet
            </h2>
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
          {first.entries.length > 0 ? (
            <ul className="items">
              {first.entries.map((e) => (
                <StepEntry key={e.step.id} step={e.step} part={partLabel(e)} clash={e.clash} />
              ))}
            </ul>
          ) : (
            <p className="day-list__empty">Nothing on today.</p>
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
            <h2 id="undated-heading" className="eyebrow">
              Steps with no day yet
            </h2>
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
