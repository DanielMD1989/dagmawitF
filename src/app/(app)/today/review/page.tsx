import type { Metadata } from 'next';
import Link from 'next/link';
import { DoneForm, StillGoingForm } from '@/components/day/ProgressForms';
import { usableMinutes, describeDay } from '@/domain/calendar/capacity';
import { formatDayLong } from '@/domain/dates';
import { buildToday, toReview } from '@/domain/day/today';
import { formatMinutes } from '@/domain/duration';
import { loadCalendarSettings } from '@/server/calendar';
import { loadDayFacts } from '@/server/day';
import { loadApprovedPlan } from '@/server/planning';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';
import { MakeProposalForm } from '@/app/(app)/orders/[id]/plan/PlanForms';

export const metadata: Metadata = { title: 'Finish the day' };

/** The end-of-day review: what happened to each task of the day, then tomorrow's proposal (decision 0045). */
export default async function DayReviewPage() {
  await requireUser();
  const supabase = await createSupabase();
  const [{ profile, week, exceptions, today }, approved] = await Promise.all([
    loadCalendarSettings(supabase),
    loadApprovedPlan(supabase),
  ]);
  const slots = approved?.slots ?? [];
  const facts = await loadDayFacts(
    supabase,
    slots.filter((s) => s.day === today).map((s) => s.taskId),
  );
  const day = describeDay(today, week, exceptions);
  const plan = buildToday({
    today,
    usableMinutes: usableMinutes(day.minutes, profile.planningRatio),
    slots,
    ...facts,
  });
  const open = toReview(plan);
  const done = plan.entries.filter((e) => e.task.status === 'done');

  return (
    <>
      <div className="page-head">
        <p className="crumbs">
          <Link href="/">My Day</Link> / Finish the day
        </p>
        <h1>How did today go?</h1>
        <p className="lede">
          {formatDayLong(today)}. For each task not finished, say whether it is done or about how long is
          left. Then make tomorrow’s plan from what really happened.
        </p>
      </div>

      {done.length > 0 && <p className="hint">Done today: {done.map((e) => e.task.title).join(', ')}.</p>}

      {open.length === 0 ? (
        <div className="card">
          <p>Nothing is left open from today.</p>
        </div>
      ) : (
        <ul className="items">
          {open.map((e) => {
            const ownTime = e.task.kind === 'work' || e.task.kind === 'fixed';
            return (
              <li key={e.task.id} className="item">
                <div className="item__head">
                  <div className="item__main">
                    <span className="item__title">{e.task.title}</span>
                    <span className="hint">
                      {e.task.orderLabel ?? 'Studio work'}
                      {e.minutesToday > 0 && ` · ${formatMinutes(e.minutesToday)} planned today`}
                      {e.task.remainingMinutes !== null &&
                        ` · about ${formatMinutes(e.task.remainingMinutes)} left`}
                    </span>
                    {e.reason && <span className="item__note">{e.reason}</span>}
                  </div>
                </div>
                <div className="today__forms">
                  <DoneForm
                    id={e.task.id}
                    title={e.task.title}
                    status={e.task.status}
                    needsTime={ownTime}
                    suggested={e.task.minutes}
                    today={today}
                  />
                  {ownTime && (
                    <StillGoingForm
                      id={e.task.id}
                      title={e.task.title}
                      status={e.task.status}
                      left={e.task.remainingMinutes}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <section className="section" aria-labelledby="tomorrow-heading">
        <div className="section__head">
          <h2 id="tomorrow-heading">Tomorrow</h2>
          <p className="hint">
            The proposal plans every active order again from what is done and what is left. Nothing moves
            until you approve it.
          </p>
        </div>
        <MakeProposalForm label="Make tomorrow’s proposal" />
      </section>
    </>
  );
}
