import Link from 'next/link';
import { formatDay, type IsoDate } from '@/domain/dates';
import { jobHeadline } from '@/domain/jobs/words';
import { isDeliveryStep, isRecord, lastDayOf, offersPartDone, type Step } from '@/domain/steps/agenda';
import { partDoneLabel, timeLabel } from '@/domain/steps/words';
import { Chevron, Sheet } from '@/components/Sheet';
import { DeliveredForm } from './DeliveredForm';
import { DeliveryTick } from './DeliveryTick';
import { PartDoneForm } from './PartDoneForm';
import { RemoveStep, StepEditor } from './StepEditor';
import { TickButton } from './TickButton';

/** An active order's Delivery, not yet ticked: ticking it hands the order over, on a day she gives (decision 0101). */
function delivers(step: Step): boolean {
  return (
    step.doneOn === null &&
    step.job !== null &&
    step.job.clientName !== null &&
    step.job.status === 'active' &&
    isDeliveryStep(step.title)
  );
}

/** "Today · 10:00 AM", "Thu 19 Nov", "Done Sun 8 Nov", "No day yet". */
function whenWords(step: Step, today: IsoDate): string {
  if (step.doneOn) return `Done ${step.doneOn === today ? 'today' : formatDay(step.doneOn)}`;
  if (!step.onDay) return 'No day yet';
  const day = step.onDay === today ? 'Today' : formatDay(step.onDay);
  const until = step.untilDay ? ` – ${formatDay(step.untilDay)}` : '';
  const time = timeLabel(step);
  return `${day}${until}${time ? ` · ${time}` : ''}`;
}

/**
 * One step on Today, the calendar or its order (decision 0105): a row with its round mark, which ticks it, and the
 * rest of the row, which opens its sheet: Done, Part done, Change day or time, Open the order, Remove. In its order's
 * card or on its order's page (`inWork`) the order is said once above, so the row is the step; on its own it says
 * whose it is under the step.
 */
export function StepEntry({
  step,
  part = null,
  clash = false,
  overdue = false,
  inWork = false,
  showDay = false,
  atOrder = false,
  today,
}: {
  step: Step;
  part?: string | null;
  clash?: boolean;
  overdue?: boolean;
  inWork?: boolean;
  /** On its order's page each row says its day; on a day's list the day is the list's. */
  showDay?: boolean;
  /** On its order's page: its sheet does not offer to open the order. */
  atOrder?: boolean;
  /** Her today: "Part done" is offered for today's work and late work, not days to come (decision 0100). */
  today: IsoDate;
}) {
  const done = step.doneOn !== null;
  const record = isRecord(step);
  const time = timeLabel(step);
  const last: IsoDate | null = lastDayOf(step);
  const work = step.job ? jobHeadline(step.job) : null;
  const partDone = partDoneLabel(step);
  const delivery = step.job !== null && step.job.clientName !== null && isDeliveryStep(step.title);
  // On its order's page the order is plain, so the mark says the step alone.
  const label = work && !atOrder ? `${step.title}, ${work}` : step.title;
  // A step planned after its order is due, while it can still be moved.
  const after = !done && !record && !delivery && step.job !== null && last !== null && last > step.job.dueOn;
  // Under the step: its day on its order's page; whose it is when it stands alone; which day of several.
  const rest = [
    showDay ? whenWords(step, today) : null,
    part,
    !inWork && step.job ? `#${step.job.number}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const row = (
    <>
      {time && !showDay && <span className="item__time">{time}</span>}
      <span
        className={['item__title', inWork ? 'item__title--step' : '', done ? 'today__done' : '']
          .filter(Boolean)
          .join(' ')}
      >
        {step.title}
      </span>
      {(!inWork || rest) && (
        <span className="item__sub">
          {!inWork && <span className="item__work">{work ?? 'Your own'}</span>}
          {!inWork && rest && ' · '}
          {rest}
        </span>
      )}
      {overdue && last && <span className="item__note late">Was for {formatDay(last)}</span>}
      {partDone && <span className="item__note item__note--started">{partDone}</span>}
      {!done && step.movedFrom && (
        <span className="item__note item__note--moved">Moved from {formatDay(step.movedFrom)}</span>
      )}
      {clash && <span className="item__note item__note--warn">Its time crosses another step’s</span>}
      {after && <span className="item__note item__note--warn">After the order’s day</span>}
    </>
  );

  return (
    <li className={['item', overdue ? 'item--late' : '', done ? 'item--done' : ''].filter(Boolean).join(' ')}>
      <div className="item__head">
        {record ? (
          // Its order is finished: the step is shown as it was left.
          <span
            className={done ? 'item__mark item__mark--done' : 'item__mark'}
            aria-label={done ? 'Done' : 'Not done'}
            role="img"
          />
        ) : delivers(step) ? (
          <DeliveryTick orderId={step.job!.id} title={label} today={today} />
        ) : (
          <TickButton
            stepId={step.id}
            orderId={step.job?.id ?? null}
            title={label}
            done={done}
            started={partDone !== null}
          />
        )}
        {record ? (
          <div className="item__open item__open--still">{row}</div>
        ) : (
          <Sheet title={step.title} opener={row} openerClass="item__open">
            <p className="sheet__when">
              {whenWords(step, today)}
              {work && <> · {work}</>}
            </p>
            {partDone && <p className="sheet__when">{partDone}</p>}
            {delivers(step) ? (
              <DeliveredForm orderId={step.job!.id} today={today} idPrefix={`sheet-${step.id}`} />
            ) : (
              <TickButton
                stepId={step.id}
                orderId={step.job?.id ?? null}
                title={label}
                done={done}
                started={partDone !== null}
                wide
              />
            )}
            <div className="sheet__group">
              {offersPartDone(step, today) && (
                <PartDoneForm
                  stepId={step.id}
                  orderId={step.job?.id ?? null}
                  title={step.title}
                  started={partDone !== null}
                  leftNote={step.leftNote ?? null}
                />
              )}
              <StepEditor orderId={step.job?.id ?? null} step={step} delivery={delivery} />
              {step.job && !atOrder && (
                <Link href={`/orders/${step.job.id}`} className="sheet__row">
                  Open the order
                  <Chevron />
                </Link>
              )}
            </div>
            {!delivery && (
              <div className="sheet__group sheet__group--warn">
                <RemoveStep stepId={step.id} orderId={step.job?.id ?? null} title={step.title} />
              </div>
            )}
          </Sheet>
        )}
      </div>
    </li>
  );
}
