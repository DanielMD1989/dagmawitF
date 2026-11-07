import Link from 'next/link';
import type { IsoDate } from '@/domain/dates';
import { jobHeadline } from '@/domain/jobs/words';
import { nextIsLate, nextWords, type NextUp } from '@/domain/orders/lists';
import { groupByWork, isRecord, type JobRef, type Step } from '@/domain/steps/agenda';
import { DeliverNowButton } from './DeliverNowButton';
import { StepEntry } from './StepEntry';

export interface DayItem {
  step: Step;
  part?: string | null;
  clash?: boolean;
  overdue?: boolean;
}

/**
 * A list of steps on Today or the calendar, by order (decision 0098): an order is shown once, its steps of the list
 * inside it; a step of her own work is on its own. Rendered inside a `<ul className="items">`.
 */
export function DayItems({
  items,
  nextOf,
  today,
}: {
  items: readonly DayItem[];
  /** What comes next for each order, said once its steps here are done (decisions 0094, 0097). */
  nextOf?: ReadonlyMap<string, NextUp>;
  today: IsoDate;
}) {
  return groupByWork(items).map((g) =>
    g.job ? (
      <WorkCard key={g.job.id} job={g.job} items={g.items} next={nextOf?.get(g.job.id)} today={today} />
    ) : (
      <StepEntry key={g.items[0]!.step.id} {...g.items[0]!} today={today} />
    ),
  );
}

function WorkCard({
  job,
  items,
  next,
  today,
}: {
  job: JobRef;
  items: readonly DayItem[];
  next?: NextUp;
  today: IsoDate;
}) {
  const work = jobHeadline(job);
  const allDone = items.every((i) => i.step.doneOn !== null);
  // What comes next, once its steps here are done, and only when it is not one of them (it is on this list already).
  const nextHere = next?.kind === 'step' && items.some((i) => i.step.id === next.stepId);
  const showNext = next && allDone && !nextHere && !isRecord(items[0]!.step);
  return (
    <li className="work">
      <div className="work__head">
        <Link href={`/orders/${job.id}`} className="work__title step-work">
          {work}
        </Link>
        <span className="hint">#{job.number}</span>
      </div>
      <ul className="work__steps">
        {items.map((i) => (
          <StepEntry key={i.step.id} {...i} inWork today={today} />
        ))}
      </ul>
      {showNext && (
        <div className="work__next">
          <span className={`item__note item__note--next${nextIsLate(next, today) ? ' late' : ''}`}>
            {nextWords(next)}
          </span>
          {next.kind === 'step' && next.deliverNow && (
            <DeliverNowButton stepId={next.stepId} orderId={job.id} whose={work} />
          )}
        </div>
      )}
    </li>
  );
}
