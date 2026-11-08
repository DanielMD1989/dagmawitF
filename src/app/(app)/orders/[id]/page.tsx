import { notFound } from 'next/navigation';
import { AddStepForm } from '@/components/steps/AddStepForm';
import { AddStepsForm } from '@/components/steps/AddStepsForm';
import { StepEntry } from '@/components/steps/StepEntry';
import { isUuid } from '@/domain/form-input';
import { isClosed } from '@/domain/orders/status';
import { inDayOrder, isDeliveryStep, isOverdue, jobWarnings } from '@/domain/steps/agenda';
import { usualSteps } from '@/domain/steps/usual';
import { getOrder } from '@/server/orders';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { carryOver, loadJobSteps, loadUsedStepTitles } from '@/server/steps';
import { createSupabase } from '@/server/supabase';

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
  const [loaded, prefs, used] = await Promise.all([
    loadJobSteps(supabase, order.id),
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

  return (
    <>
      <section className="section" aria-labelledby="steps-heading">
        <div className="section__head section__head--row">
          <h2 id="steps-heading">{event ? 'To prepare' : 'Steps'}</h2>
          {event && steps.length === 0 && <p className="hint">Nothing yet</p>}
          {steps.length > 0 && (
            <p className="hint">
              {done} of {steps.length} done
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
            <p>No steps yet.</p>
          </div>
        )}
        {/* Her steps in the order they happen, joined by a seam that is sewn as they are done (decision 0105). */}
        {steps.length > 0 && (
          <ol className="items seam" aria-label={event ? 'To prepare' : 'Steps, in the order they happen'}>
            {steps.map((s) => (
              <StepEntry
                key={s.id}
                step={s}
                overdue={!closed && isOverdue(s, prefs.today)}
                inWork
                showDay
                atOrder
                today={prefs.today}
              />
            ))}
          </ol>
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

      {order.notes && (
        <section className="section" aria-labelledby="notes-heading">
          <h2 id="notes-heading">Notes</h2>
          <p className="card brief">{order.notes}</p>
        </section>
      )}
    </>
  );
}
