import type { Metadata } from 'next';
import Link from 'next/link';
import { AddStepForm } from '@/components/steps/AddStepForm';
import { StepEntry } from '@/components/steps/StepEntry';
import { formatDayLong, isIsoDate, WEEKDAY_NAMES } from '@/domain/dates';
import { entriesOn, isOverdue, monthCounts } from '@/domain/steps/agenda';
import { monthGrid } from '@/domain/steps/month';
import { partLabel } from '@/domain/steps/words';
import { loadCalendarSettings } from '@/server/calendar';
import { requireUser } from '@/server/session';
import { loadStepsBetween } from '@/server/steps';
import { createSupabase } from '@/server/supabase';

export const metadata: Metadata = { title: 'Calendar' };

/** The month: how many steps each day holds, and the list of the day she picks (docs/calendar-first.md). */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; day?: string }>;
}) {
  await requireUser();
  const params = await searchParams;
  const supabase = await createSupabase();
  const { today } = await loadCalendarSettings(supabase);
  const grid = monthGrid(
    params.month ?? (params.day && isIsoDate(params.day) ? params.day.slice(0, 7) : undefined),
    today,
  );
  const steps = await loadStepsBetween(supabase, grid.from, grid.to);
  const counts = monthCounts(steps, grid.from, grid.to);
  const chosen =
    params.day && isIsoDate(params.day) && params.day >= grid.from && params.day <= grid.to
      ? params.day
      : today >= grid.first && today <= grid.last
        ? today
        : grid.first;
  const entries = entriesOn(steps, chosen);

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Calendar</p>
        <div className="title-row">
          <h1>{grid.title}</h1>
        </div>
        <nav className="btn-row" aria-label="Months">
          <Link href={`/calendar?month=${grid.previous}`} className="btn btn--quiet btn--small">
            Previous month
          </Link>
          <Link href="/calendar" className="btn btn--quiet btn--small">
            This month
          </Link>
          <Link href={`/calendar?month=${grid.next}`} className="btn btn--quiet btn--small">
            Next month
          </Link>
        </nav>
      </div>

      <section className="card" aria-label={`Days of ${grid.title}`}>
        <ol className="month">
          {WEEKDAY_NAMES.map((name) => (
            <li key={name} className="month__weekday" aria-hidden="true">
              {name.slice(0, 3)}
            </li>
          ))}
          {grid.days.map(({ day, inMonth }) => {
            const n = counts.get(day) ?? 0;
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
                  {Number(day.slice(8))}
                  <span className="sr-only">
                    {' '}
                    {formatDayLong(day)}
                    {day === today ? ', today' : ''}: {n === 0 ? 'nothing' : `${n} step${n === 1 ? '' : 's'}`}
                  </span>
                  {n > 0 && (
                    <span className="month__count" aria-hidden="true">
                      {n}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="section day-list" aria-labelledby="chosen-heading">
        <div className="day-list__head">
          <h2 id="chosen-heading" className="h3">
            {formatDayLong(chosen)}
            {chosen === today ? ' · today' : ''}
          </h2>
        </div>
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
          <p className="day-list__empty">Nothing on this day.</p>
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
