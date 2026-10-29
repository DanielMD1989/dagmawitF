import type { Metadata } from 'next';
import Link from 'next/link';
import { QuickAddForm, RemoveQuickTask } from '@/components/day/QuickAdd';
import { TodayEntryCard } from '@/components/day/TodayEntryCard';
import { SaveForOffline } from '@/components/offline/SaveForOffline';
import { describeDay, usableMinutes } from '@/domain/calendar/capacity';
import { formatDay, formatDayLong, hourIn } from '@/domain/dates';
import { makeSnapshot } from '@/domain/day/offline';
import { buildToday } from '@/domain/day/today';
import { formatMinutes } from '@/domain/duration';
import { greetingFor } from '@/domain/greeting';
import { isCurrent } from '@/domain/planning/proposal';
import { loadCalendarSettings } from '@/server/calendar';
import { loadDayFacts, loadOpenOrders } from '@/server/day';
import { loadApprovedPlan, loadEpoch } from '@/server/planning';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';

export const metadata: Metadata = { title: 'My Day' };

/** Today, from the approved plan (docs/my-day.md). */
export default async function MyDayPage() {
  const user = await requireUser();
  const supabase = await createSupabase();
  const [{ profile, week, exceptions, today }, approved, epoch, orders] = await Promise.all([
    loadCalendarSettings(supabase),
    loadApprovedPlan(supabase),
    loadEpoch(supabase),
    loadOpenOrders(supabase),
  ]);
  const slots = approved?.slots ?? [];
  const facts = await loadDayFacts(
    supabase,
    slots.filter((s) => s.day === today).map((s) => s.taskId),
  );

  const day = describeDay(today, week, exceptions);
  const usable = usableMinutes(day.minutes, profile.planningRatio);
  const plan = buildToday({ today, usableMinutes: usable, slots, ...facts });
  const greeting = greetingFor(hourIn(profile.timezone));
  const firstName = profile.name.split(/\s+/)[0] ?? '';
  const dateLabel = formatDayLong(today).replace(' ', ' · ');
  const fixed = plan.entries.filter((e) => e.time !== null);
  const work = plan.entries.filter((e) => e.time === null);
  const snapshot = makeSnapshot({
    ownerId: user.id,
    day: today,
    timezone: profile.timezone,
    madeAt: new Date(),
    firstName,
    planNumber: approved?.number ?? null,
    plan,
  });
  const share = usable > 0 ? Math.min(100, Math.round((plan.plannedMinutes / usable) * 100)) : 0;

  return (
    <>
      <SaveForOffline snapshot={snapshot} />
      <div className="page-head">
        <p className="eyebrow">{dateLabel}</p>
        <div className="title-row">
          <h1>
            {greeting}
            {firstName ? `, ${firstName}` : ''}.
          </h1>
        </div>
      </div>

      {week.length === 0 && (
        <div className="card card--warn" role="status">
          <strong>Her working week is not set yet.</strong>
          <span>Without it the planner does not know how much time she has.</span>
          <Link href="/settings" className="link-button">
            Set the working week
          </Link>
        </div>
      )}

      <section className="card" aria-label="Time today">
        {day.kind === 'working' || day.kind === 'shortened-by-exception' ? (
          <>
            <div className="big-number">
              {formatMinutes(plan.plannedMinutes)} planned <small>of {formatMinutes(usable)} usable</small>
            </div>
            <div className="meter" role="img" aria-label={`${share}% of today's usable time is planned`}>
              <span style={{ width: `${share}%` }} />
            </div>
            <p className="hint">
              {formatMinutes(plan.freeMinutes)} left free for alterations that walk in
              {day.kind === 'shortened-by-exception' && day.reason ? ` (${day.reason})` : ''}.
              {approved && ` From plan ${approved.number}.`}
            </p>
          </>
        ) : (
          <>
            <div className="big-number">
              {day.kind === 'closed-by-exception' ? 'Closed today' : 'Day off'}
            </div>
            {day.reason && <p className="hint">{day.reason}</p>}
          </>
        )}
      </section>

      <QuickAddForm orders={orders} />

      {approved === null ? (
        <section className="card" aria-labelledby="plan-heading">
          <h2 id="plan-heading" className="h3">
            No plan approved yet
          </h2>
          <p className="hint">
            Give an order its tasks on its Plan tab, then make a proposal and approve it. Today’s list comes
            from it.
          </p>
          <Link href="/plan" className="link-button">
            See plans
          </Link>
        </section>
      ) : (
        !isCurrent(approved, epoch, today) && (
          <div className="card" role="status">
            <p className="attention">
              Something has changed since plan {approved.number} was approved
              {approved.madeFor !== today ? ` on ${formatDay(approved.madeFor)}` : ''}. Today’s list is still
              what you agreed to; a new proposal takes the changes in.
            </p>
            <Link href="/today/review" className="link-button">
              Finish the day and plan tomorrow
            </Link>
          </div>
        )
      )}

      {fixed.length > 0 && (
        <section className="section" aria-labelledby="fixed-heading">
          <div className="section__head">
            <h2 id="fixed-heading" className="eyebrow">
              Fixed
            </h2>
          </div>
          <ul className="items">
            {fixed.map((e) => (
              <TodayEntryCard key={e.task.id} entry={e} today={today} />
            ))}
          </ul>
        </section>
      )}

      {work.length > 0 && (
        <section className="section" aria-labelledby="work-heading">
          <div className="section__head">
            <h2 id="work-heading" className="eyebrow">
              Planned, in suggested order
            </h2>
          </div>
          <ul className="items">
            {work.map((e) => (
              <TodayEntryCard key={e.task.id} entry={e} today={today} />
            ))}
          </ul>
        </section>
      )}

      {approved !== null && plan.entries.length === 0 && (
        <div className="card">
          <p>Nothing is planned for today in plan {approved.number}.</p>
        </div>
      )}

      {plan.alsoStarted.length > 0 && (
        <section className="section" aria-labelledby="started-heading">
          <div className="section__head">
            <h2 id="started-heading" className="eyebrow">
              Also started
            </h2>
          </div>
          <ul className="items">
            {plan.alsoStarted.map((e) => (
              <TodayEntryCard key={e.task.id} entry={e} today={today} />
            ))}
          </ul>
        </section>
      )}

      {plan.waitingForADay.length > 0 && (
        <section className="section" aria-labelledby="waiting-heading">
          <div className="section__head">
            <h2 id="waiting-heading" className="eyebrow">
              {plan.waitingForADay.length} quick-added item{plan.waitingForADay.length === 1 ? '' : 's'}{' '}
              waiting for a day
            </h2>
          </div>
          <ul className="items">
            {plan.waitingForADay.map((t) => (
              <li key={t.id} className="item">
                <div className="item__head">
                  <div className="item__main">
                    <span className="item__title">{t.title}</span>
                    <span className="hint">
                      Studio work{t.minutes ? ` · ${formatMinutes(t.minutes)}` : ''}
                    </span>
                  </div>
                </div>
                <RemoveQuickTask id={t.id} title={t.title} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="btn-row">
        <Link href="/today/review" className="btn">
          Finish the day
        </Link>
        <Link href="/plan" className="btn btn--quiet">
          See plans
        </Link>
      </div>
    </>
  );
}
