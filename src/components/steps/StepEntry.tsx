import Link from 'next/link';
import { formatDay, type IsoDate } from '@/domain/dates';
import { lastDayOf, type Step } from '@/domain/steps/agenda';
import { jobLabel, timeLabel } from '@/domain/steps/words';
import { TickButton } from './TickButton';

/** One step on Today, the calendar or the offline page: its mark, its title, when, and whose job. */
export function StepEntry({
  step,
  part = null,
  clash = false,
  overdue = false,
  showJob = true,
}: {
  step: Step;
  part?: string | null;
  clash?: boolean;
  overdue?: boolean;
  showJob?: boolean;
}) {
  const done = step.doneOn !== null;
  const time = timeLabel(step);
  const last: IsoDate | null = lastDayOf(step);
  return (
    <li className={overdue ? 'item item--late' : 'item'}>
      <div className="item__head">
        <TickButton stepId={step.id} orderId={step.job?.id ?? null} title={step.title} done={done} />
        {time && <span className="today__time">{time}</span>}
        <div className="item__main">
          <span className={done ? 'item__title today__done' : 'item__title'}>{step.title}</span>
          {(part || showJob) && (
            <span className="hint">
              {part}
              {part && showJob && ' · '}
              {showJob &&
                (step.job ? (
                  <Link href={`/orders/${step.job.id}`} className="step-job">
                    {jobLabel(step.job)}
                  </Link>
                ) : (
                  'Your own'
                ))}
            </span>
          )}
          {overdue && last && <span className="item__note">Was for {formatDay(last)}, not done yet.</span>}
          {clash && (
            <span className="item__note item__note--warn">
              Its time crosses another step’s. Move one of them.
            </span>
          )}
        </div>
      </div>
    </li>
  );
}
