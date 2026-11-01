import type { Metadata } from 'next';
import Link from 'next/link';
import { AddStepForm } from '@/components/steps/AddStepForm';
import { StepEntry } from '@/components/steps/StepEntry';
import { formatDayLong, isIsoDate, WEEKDAY_NAMES } from '@/domain/dates';
import { byDueDay, dueNotShown, dueWord, jobHeadline } from '@/domain/jobs/words';
import { entriesOn, isOverdue } from '@/domain/steps/agenda';
import { dayMarks, monthGrid } from '@/domain/steps/month';
import { partLabel } from '@/domain/steps/words';
import { loadCalendarSettings } from '@/server/calendar';
import { loadJobDays } from '@/server/orders';
import { requireUser } from '@/server/session';
import { carryOver, loadStepsBetween } from '@/server/steps';
import { createSupabase } from '@/server/supabase';

export const metadata: Metadata = { title: 'Calendar' };

/**
 * The month (docs/calendar-first.md): each day shows what it holds by name, the orders due by the client's first name,
 * the events, then the steps (decision 0086), and below it the list of the day she picks. An order's own day is
 * marked whether or not it has steps (decision 0070).
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; day?: string }>;
}) {
  await requireUser();
  const params = await searchParams;
  const supabase = await createSupabase();
  const [{ today }] = await Promise.all([loadCalendarSettings(supabase), carryOver(supabase)]);
  const grid = monthGrid(
    params.month ?? (params.day && isIsoDate(params.day) ? params.day.slice(0, 7) : undefined),
    today,
  );
  const [steps, jobDays] = await Promise.all([
    loadStepsBetween(supabase, grid.from, grid.to),
    loadJobDays(supabase, grid.from, grid.to),
  ]);
  const due = byDueDay(jobDays);
  const chosen =
    params.day && isIsoDate(params.day) && params.day >= grid.from && params.day <= grid.to
      ? params.day
      : today >= grid.first && today <= grid.last
        ? today
        : grid.first;
  const entries = entriesOn(steps, chosen);
  // A job whose step is in the day's list is not listed again as due.
  const dueOnChosen = dueNotShown(
    due.get(chosen) ?? [],
    entries.map((e) => e.step.job?.id ?? null),
  );

  return (
    <>
      <div className="page-head">
        <div className="month-head">
          <p className="eyebrow">Calendar</p>
          <Link href="/calendar" className="month-head__today">
            This month
          </Link>
        </div>
        {/* The month between its arrows, as a phone calendar has it: one line at any phone width. */}
        <div className="month-head">
          <h1>{grid.title}</h1>
          <nav className="month-head__nav" aria-label="Months">
            <Link href={`/calendar?month=${grid.previous}`} className="icon-btn" aria-label="Previous month">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
            </Link>
            <Link href={`/calendar?month=${grid.next}`} className="icon-btn" aria-label="Next month">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
            </Link>
          </nav>
        </div>
      </div>

      <section className="card" aria-label={`Days of ${grid.title}`}>
        <ol className="month">
          {WEEKDAY_NAMES.map((name) => (
            <li key={name} className="month__weekday" aria-hidden="true">
              {name.slice(0, 3)}
            </li>
          ))}
          {grid.days.map(({ day, inMonth }) => {
            const marks = dayMarks(steps, due.get(day) ?? [], day);
            const classes = [
              'month__day',
              inMonth ? '' : 'month__day--other',
              day === today ? 'month__day--today' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <li key={day}>
                <Link
                  href={`/calendar?month=${grid.month}&day=${day}`}
                  className={classes}
                  aria-current={day === chosen ? 'date' : undefined}
                >
                  <span className="month__num">{Number(day.slice(8))}</span>
                  <span className="sr-only">
                    {' '}
                    {formatDayLong(day)}
                    {day === today ? ', today' : ''}:{' '}
                    {marks.length === 0 ? 'nothing' : marks.map((m) => m.full).join(', ')}
                  </span>
                  {marks.length > 0 && (
                    // Two labels on a phone, three on a wider screen; the rest are counted (decision 0086).
                    <span className="month__tags" aria-hidden="true">
                      {marks.slice(0, 3).map((m, i) => (
                        <span
                          key={i}
                          className={`month__tag month__tag--${m.kind}${i === 2 ? ' month__tag--wide' : ''}`}
                        >
                          {m.text}
                        </span>
                      ))}
                      {marks.length > 2 && (
                        <span className="month__more month__more--narrow">+{marks.length - 2} more</span>
                      )}
                      {marks.length > 3 && (
                        <span className="month__more month__more--wide">+{marks.length - 3} more</span>
                      )}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ol>
        <ul className="month__key" aria-label="What the labels are">
          <li>
            <span className="month__tag month__tag--due" aria-hidden="true" /> Order due
          </li>
          <li>
            <span className="month__tag month__tag--step" aria-hidden="true" /> Step
          </li>
          <li>
            <span className="month__tag month__tag--event" aria-hidden="true" /> Event
          </li>
        </ul>
      </section>

      <section className="section day-list" aria-labelledby="chosen-heading">
        <div className="day-list__head">
          <h2 id="chosen-heading" className="h3">
            {formatDayLong(chosen)}
            {chosen === today ? ' · today' : ''}
          </h2>
        </div>
        {dueOnChosen.length > 0 && (
          <ul className="rows rows--links day-list__due" aria-label="Due this day">
            {dueOnChosen.map((job) => (
              <li key={job.id}>
                <Link href={`/orders/${job.id}`} className="row-link">
                  <span className="row-link__title">{jobHeadline(job)}</span>
                  <span className="hint">
                    {dueWord(job)} · #{job.number}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {entries.length > 0 ? (
          <ul className="items">
            {entries.map((e) => (
              <StepEntry
                key={e.step.id}
                step={e.step}
                part={partLabel(e)}
                clash={e.clash}
                overdue={isOverdue(e.step, today)}
              />
            ))}
          </ul>
        ) : (
          dueOnChosen.length === 0 && <p className="day-list__empty">Nothing on this day.</p>
        )}
        <AddStepForm
          orderId={null}
          day={chosen}
          summary="Add something for yourself on this day"
          idPrefix="day"
        />
      </section>
    </>
  );
}
