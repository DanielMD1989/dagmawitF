import Link from 'next/link';
import { formatDay, type IsoDate } from '@/domain/dates';
import { jobHeadline } from '@/domain/jobs/words';
import { canBePartDone, isRecord, lastDayOf, type Step } from '@/domain/steps/agenda';
import { partDoneLabel, timeLabel } from '@/domain/steps/words';
import { PartDoneForm } from './PartDoneForm';
import { TickButton } from './TickButton';

/**
 * One step on Today or the calendar. On its own, the work comes first, in large: "Megan · Bridal gown" (her Task 7);
 * the step and its time under it; her own steps, of no job, are their own title. In its order's card (`inWork`,
 * decision 0098) the order is said once above, so the step is the title.
 */
export function StepEntry({
  step,
  part = null,
  clash = false,
  overdue = false,
  inWork = false,
}: {
  step: Step;
  part?: string | null;
  clash?: boolean;
  overdue?: boolean;
  inWork?: boolean;
}) {
  const done = step.doneOn !== null;
  const time = timeLabel(step);
  const last: IsoDate | null = lastDayOf(step);
  const work = step.job ? jobHeadline(step.job) : null;
  const titleClass = done ? 'item__title today__done' : 'item__title';
  const partDone = partDoneLabel(step);
  return (
    <li className={overdue ? 'item item--late' : 'item'}>
      <div className="item__head">
        {isRecord(step) ? (
          // Its order is finished: the step is shown as it was left.
          <span
            className={done ? 'item__mark item__mark--done' : 'item__mark'}
            aria-label={done ? 'Done' : 'Not done'}
            role="img"
          />
        ) : (
          <TickButton
            stepId={step.id}
            orderId={step.job?.id ?? null}
            title={work ? `${step.title}, ${work}` : step.title}
            done={done}
            started={partDone !== null}
          />
        )}
        <div className="item__main">
          {time && <span className="item__time">{time}</span>}
          {inWork ? (
            <>
              <span className={`${titleClass} item__title--step`}>{step.title}</span>
              {part && <span className="hint">{part}</span>}
            </>
          ) : (
            <>
              {step.job && work ? (
                <Link href={`/orders/${step.job.id}`} className={`${titleClass} step-work`}>
                  {work}
                </Link>
              ) : (
                <span className={titleClass}>{step.title}</span>
              )}
              <span className="hint">
                {step.job ? <span className="item__step">{step.title}</span> : 'Your own'}
                {part && ` · ${part}`}
                {step.job && ` · #${step.job.number}`}
              </span>
            </>
          )}
          {overdue && last && <span className="item__note">Was for {formatDay(last)}, not done yet.</span>}
          {partDone && <span className="item__note item__note--started">{partDone}</span>}
          {!done && step.movedFrom && (
            <span className="item__note item__note--moved">Moved from {formatDay(step.movedFrom)}</span>
          )}
          {clash && (
            <span className="item__note item__note--warn">
              Its time crosses another step’s. Move one of them.
            </span>
          )}
        </div>
      </div>
      {canBePartDone(step) && !isRecord(step) && (
        <PartDoneForm
          stepId={step.id}
          orderId={step.job?.id ?? null}
          title={step.title}
          started={partDone !== null}
          leftNote={step.leftNote ?? null}
        />
      )}
    </li>
  );
}
