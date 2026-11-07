import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { AddStepForm } from '@/components/steps/AddStepForm';
import { AddStepsForm } from '@/components/steps/AddStepsForm';
import { PartDoneForm } from '@/components/steps/PartDoneForm';
import { StepEditor } from '@/components/steps/StepEditor';
import { TickButton } from '@/components/steps/TickButton';
import { formatDay } from '@/domain/dates';
import { isUuid } from '@/domain/form-input';
import { isClosed } from '@/domain/orders/status';
import {
  inDayOrder,
  isDeliveryStep,
  isOverdue,
  jobWarnings,
  lastDayOf,
  offersPartDone,
} from '@/domain/steps/agenda';
import { daysLabel, partDoneLabel, timeLabel } from '@/domain/steps/words';
import { loadClients } from '@/server/clients';
import { getOrder } from '@/server/orders';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { carryOver, loadJobSteps, loadUsedStepTitles } from '@/server/steps';
import { createSupabase } from '@/server/supabase';
import { OrderDetailsForm } from './OrderDetailsForm';
import { usualSteps } from '@/domain/steps/usual';
import { deleteJob } from './actions';

/**
 * A job's steps, each on its day, and the job itself (docs/calendar-first.md). An event (no client) is its name and
 * day; what she prepares for it can be noted on its days, without the tailoring steps of a client's job.
 */
export default async function JobStepsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const order = await getOrder(id);
  if (!order) notFound();

  const supabase = await createSupabase();
  await carryOver(supabase);
  const [loaded, clients, prefs, used] = await Promise.all([
    loadJobSteps(supabase, order.id),
    loadClients(supabase),
    loadPreferences(supabase),
    loadUsedStepTitles(supabase),
  ]);
  // In the order they happen (decision 0100), not the order they were added.
  const steps = inDayOrder(loaded);
  const closed = isClosed(order.status);
  const warnings = closed ? [] : jobWarnings(steps, order.deliveryOn, prefs.today);
  const done = steps.filter((s) => s.doneOn !== null).length;
  // The steps besides the Delivery, which every customer order has (decision 0096).
  const work = steps.filter((s) => !isDeliveryStep(s.title));
  const usual = usualSteps(used);
  const event = !order.client;
  const noun = event ? 'event' : 'order';

  return (
    <>
      <section className="section" aria-labelledby="steps-heading">
        <div className="section__head">
          <h2 id="steps-heading">{event ? 'To prepare' : 'Steps'}</h2>
          {event && steps.length === 0 && (
            <p className="hint">
              Nothing yet. If it needs work on certain days (sewing stock, packing), add it here and it shows
              on those days of your calendar.
            </p>
          )}
          {steps.length > 0 && (
            <p className="hint">
              {done} of {steps.length} done.
            </p>
          )}
        </div>

        {warnings.length > 0 && (
          <div className="card card--warn" role="status">
            <ul className="plain-list">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Its Delivery is always there (decision 0096): "no steps" is none besides it. */}
        {!event && work.length === 0 && (
          <div className="card">
            <p>No steps yet.{!closed && ' Tap the ones this order needs, and give each its day.'}</p>
          </div>
        )}
        {steps.length > 0 && (
          <ul className="items">
            {steps.map((s) => {
              const late = !closed && isOverdue(s, prefs.today);
              const after = s.doneOn === null && (lastDayOf(s) ?? '') > order.deliveryOn;
              const time = timeLabel(s);
              return (
                <li key={s.id} className={late || after ? 'item item--late' : 'item'}>
                  <div className="item__head">
                    {closed ? (
                      <span
                        className={s.doneOn ? 'item__mark item__mark--done' : 'item__mark'}
                        aria-label={s.doneOn ? 'Done' : 'Not done'}
                        role="img"
                      />
                    ) : (
                      <TickButton
                        stepId={s.id}
                        orderId={order.id}
                        title={s.title}
                        done={s.doneOn !== null}
                        started={partDoneLabel(s) !== null}
                      />
                    )}
                    <div className="item__main">
                      <span className={s.doneOn ? 'item__title today__done' : 'item__title'}>{s.title}</span>
                      <span className="hint">
                        {daysLabel(s)}
                        {time && ` · ${time}`}
                        {s.doneOn && ` · done ${formatDay(s.doneOn)}`}
                      </span>
                      {late && <span className="item__note">Not done yet.</span>}
                      {partDoneLabel(s) && (
                        <span className="item__note item__note--started">{partDoneLabel(s)}</span>
                      )}
                      {!s.doneOn && s.movedFrom && (
                        <span className="item__note item__note--moved">
                          Moved from {formatDay(s.movedFrom)}
                        </span>
                      )}
                      {after && <span className="item__note">After the order’s day.</span>}
                    </div>
                  </div>
                  {!closed && offersPartDone(s, prefs.today) && (
                    <PartDoneForm
                      stepId={s.id}
                      orderId={order.id}
                      title={s.title}
                      started={partDoneLabel(s) !== null}
                      leftNote={s.leftNote ?? null}
                    />
                  )}
                  {!closed && (
                    <StepEditor orderId={order.id} step={s} delivery={!event && isDeliveryStep(s.title)} />
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {!closed &&
          (event ? (
            <AddStepForm
              orderId={order.id}
              day={prefs.today}
              summary="Add something to prepare"
              idPrefix="new-step"
            />
          ) : (
            // The same step buttons as a new order, for an order taken in a hurry (decision 0085).
            <AddStepsForm orderId={order.id} today={prefs.today} usual={usual} open={work.length === 0} />
          ))}
      </section>

      <section className="section" aria-labelledby="details-heading">
        <div className="section__head">
          <h2 id="details-heading">About this {noun}</h2>
        </div>
        {/* What is saved, to read; changing it is folded away until she wants to (decision 0100). */}
        {(closed || order.notes) && (
          <dl className="facts card">
            {closed && (
              <>
                <dt>For</dt>
                <dd>{order.client?.name ?? 'An event'}</dd>
                <dt>What it is</dt>
                <dd>{order.title || '—'}</dd>
                <dt>{order.client ? 'Delivery day' : 'Event day'}</dt>
                <dd>{formatDay(order.deliveryOn)}</dd>
              </>
            )}
            {order.notes && (
              <>
                <dt>Notes</dt>
                <dd className="brief">{order.notes}</dd>
              </>
            )}
          </dl>
        )}
        <details className="disclosure">
          <summary>{closed ? 'Change the notes' : `Change the ${noun} details`}</summary>
          <div className="disclosure__panel">
            <OrderDetailsForm
              order={{
                id: order.id,
                status: order.status,
                clientId: order.client?.id ?? null,
                title: order.title,
                dueOn: order.deliveryOn,
                notes: order.notes,
              }}
              clients={clients.map((c) => ({ id: c.id, name: c.name }))}
            />
          </div>
        </details>
      </section>

      <section className="section" aria-labelledby="delete-heading">
        <div className="section__head">
          <h2 id="delete-heading">Delete this {noun}</h2>
          <p className="hint">
            For {event ? 'an event' : 'an order'} added by mistake: it goes completely, with everything on it
            and its history. To keep a record of one that is called off, cancel it instead.
          </p>
        </div>
        <ConfirmAction
          action={deleteJob}
          fields={{ id: order.id }}
          label={`Delete this ${noun}`}
          question={`Delete ${event ? `“${order.title}”` : `order #${order.number}`} completely? This cannot be undone.`}
          confirmLabel="Yes, delete"
          pendingText="Deleting…"
        />
      </section>
    </>
  );
}
