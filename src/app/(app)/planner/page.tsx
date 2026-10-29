import type { Metadata } from 'next';
import Link from 'next/link';
import { addDays, formatDay, isIsoDate } from '@/domain/dates';
import { formatMinutes } from '@/domain/duration';
import { isCurrent } from '@/domain/planning/proposal';
import { mondayOf, weekBoard } from '@/domain/planning/week';
import { loadApprovedPlan, loadEpoch } from '@/server/planning';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';

export const metadata: Metadata = { title: 'Planner' };

/** The approved plan, a week at a time (docs/change.md, "The Planner's week board"). */
export default async function PlannerPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  await requireUser();
  const supabase = await createSupabase();
  const [approved, epoch, prefs] = await Promise.all([
    loadApprovedPlan(supabase),
    loadEpoch(supabase),
    loadPreferences(supabase),
  ]);
  const asked = (await searchParams).week;
  const week = mondayOf(asked && isIsoDate(asked) ? asked : prefs.today);
  const board = approved ? weekBoard(approved.stored, approved.slots, week) : null;
  const weekLink = (days: number) => `/planner?week=${addDays(week, days)}`;

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Planner</p>
        <h1>Week of {formatDay(week)}</h1>
        <p className="lede">
          {approved
            ? `The approved plan, plan ${approved.number}. Change a task or what an order waits for with “Save and see impact” to see what would move.`
            : 'No plan is approved yet.'}
        </p>
      </div>

      <nav aria-label="Weeks" className="btn-row">
        <Link href={weekLink(-7)} className="btn btn--quiet btn--small">
          Previous week
        </Link>
        <Link href="/planner" className="btn btn--quiet btn--small">
          This week
        </Link>
        <Link href={weekLink(7)} className="btn btn--quiet btn--small">
          Next week
        </Link>
        <Link href="/plan" className="btn btn--quiet btn--small">
          All plans
        </Link>
      </nav>

      {approved && !isCurrent(approved, epoch, prefs.today) && (
        <div className="card" role="status">
          <p className="attention">
            Something has changed since plan {approved.number} was approved. The board shows what you agreed
            to; a new proposal takes the changes in.
          </p>
          <Link href="/today/review" className="link-button">
            Review the day and make a proposal
          </Link>
        </div>
      )}

      {board && (
        <>
          <p className="hint">
            {formatMinutes(board.planned)} planned this week, of {formatMinutes(board.usable)} usable.
          </p>
          <ol className="board">
            {board.days.map((d) => {
              const closed = d.usable === 0;
              const isToday = d.day === prefs.today;
              return (
                <li key={d.day} className={isToday ? 'board__day board__day--today' : 'board__day'}>
                  <div className="board__head">
                    <h2 className="h3">
                      {formatDay(d.day)}
                      {isToday && <span className="sr-only"> (today)</span>}
                    </h2>
                    <span className="hint">
                      {d.usable === null
                        ? 'Before this plan'
                        : closed
                          ? 'Closed'
                          : `${formatMinutes(d.planned)} of ${formatMinutes(d.usable)}`}
                    </span>
                  </div>
                  {d.usable !== null && d.usable > 0 && (
                    <div className="meter" aria-hidden="true">
                      <span
                        style={{ width: `${Math.min(100, Math.round((d.planned / d.usable) * 100))}%` }}
                      />
                    </div>
                  )}
                  {d.tasks.length > 0 && (
                    <ul className="board__tasks">
                      {d.tasks.map((t) => (
                        <li key={t.taskId}>
                          <Link
                            href={t.orderId ? `/orders/${t.orderId}/plan#task-${t.taskId}` : '/'}
                            className="board__task"
                          >
                            <span className="board__title">
                              {t.time && <strong>{t.time} </strong>}
                              {t.title}
                            </span>
                            <span className="hint">
                              {t.orderLabel ?? 'Studio work'} · {formatMinutes(t.minutes)}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </>
  );
}
