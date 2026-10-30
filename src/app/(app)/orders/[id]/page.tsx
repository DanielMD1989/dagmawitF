import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { AddStepForm } from '@/components/steps/AddStepForm';
import { StepEditor } from '@/components/steps/StepEditor';
import { TickButton } from '@/components/steps/TickButton';
import { formatDay } from '@/domain/dates';
import { isUuid } from '@/domain/form-input';
import { isClosed } from '@/domain/orders/status';
import { isOverdue, jobWarnings, lastDayOf } from '@/domain/steps/agenda';
import { daysLabel, timeLabel } from '@/domain/steps/words';
import { loadClients } from '@/server/clients';
import { getOrder } from '@/server/orders';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { loadJobSteps, loadTemplates, loadUsedStepTitles } from '@/server/steps';
import { createSupabase } from '@/server/supabase';
import { OrderDetailsForm } from './OrderDetailsForm';
import { TemplateStepsForm } from './TemplateStepsForm';
import { usualSteps } from '@/domain/steps/usual';
import { deleteJob } from './actions';

/** A job's steps, each on its day, and the job itself (docs/calendar-first.md). */
export default async function JobStepsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const order = await getOrder(id);
  if (!order) notFound();

  const supabase = await createSupabase();
  const [steps, templates, clients, prefs, used] = await Promise.all([
    loadJobSteps(supabase, order.id),
    loadTemplates(supabase),
    loadClients(supabase),
    loadPreferences(supabase),
    loadUsedStepTitles(supabase),
  ]);
  const closed = isClosed(order.status);
  const warnings = closed ? [] : jobWarnings(steps, order.deliveryOn, prefs.today);
  const done = steps.filter((s) => s.doneOn !== null).length;
  const templateOptions = templates
    .filter((t) => t.steps.length > 0)
    .map((t) => ({ id: t.id, label: `${t.name}: ${t.steps.map((x) => x.title).join(', ')}` }));
  const usual = usualSteps(used);

  return (
    <>
      <section className="section" aria-labelledby="steps-heading">
        <div className="section__head">
          <h2 id="steps-heading">Steps</h2>
          {steps.length > 0 && (
            <p className="hint">
              {done} of {steps.length} done. Tick a step when it is done; change its day if plans change.
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

        {steps.length === 0 ? (
          <div className="card">
            <p>No steps yet.</p>
            {!closed && templateOptions.length > 0 && (
              <TemplateStepsForm orderId={order.id} templates={templateOptions} preferred={null} />
            )}
          </div>
        ) : (
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
                      <TickButton stepId={s.id} orderId={order.id} title={s.title} done={s.doneOn !== null} />
                    )}
                    <div className="item__main">
                      <span className={s.doneOn ? 'item__title today__done' : 'item__title'}>{s.title}</span>
                      <span className="hint">
                        {daysLabel(s)}
                        {time && ` · ${time}`}
                        {s.doneOn && ` · done ${formatDay(s.doneOn)}`}
                      </span>
                      {late && <span className="item__note">Not done yet.</span>}
                      {after && <span className="item__note">After the job’s day.</span>}
                    </div>
                  </div>
                  {!closed && <StepEditor orderId={order.id} step={s} />}
                </li>
              );
            })}
          </ul>
        )}

        {!closed && (
          <>
            <AddStepForm
              orderId={order.id}
              day={prefs.today}
              summary="Add a step"
              idPrefix="new-step"
              usual={usual}
            />
            {steps.length > 0 && templateOptions.length > 0 && (
              <details className="disclosure disclosure--link">
                <summary>Add the steps of a list</summary>
                <div className="disclosure__panel">
                  <TemplateStepsForm orderId={order.id} templates={templateOptions} preferred={null} />
                </div>
              </details>
            )}
          </>
        )}
      </section>

      <section className="section" aria-labelledby="details-heading">
        <div className="section__head">
          <h2 id="details-heading">About this job</h2>
        </div>
        {closed && (
          <dl className="facts card">
            <dt>For</dt>
            <dd>{order.client?.name ?? 'Nobody: an event'}</dd>
            <dt>What it is</dt>
            <dd>{order.title || '—'}</dd>
            <dt>{order.client ? 'Delivery day' : 'Event day'}</dt>
            <dd>{formatDay(order.deliveryOn)}</dd>
          </dl>
        )}
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
      </section>

      <section className="section" aria-labelledby="delete-heading">
        <div className="section__head">
          <h2 id="delete-heading">Delete this job</h2>
          <p className="hint">
            For a job added by mistake: it goes completely, with its steps, pictures and history. To keep a
            record of a job that is called off, cancel it instead.
          </p>
        </div>
        <ConfirmAction
          action={deleteJob}
          fields={{ id: order.id }}
          label="Delete this job"
          question={`Delete job #${order.number} completely? This cannot be undone.`}
          confirmLabel="Yes, delete"
          pendingText="Deleting…"
        />
      </section>
    </>
  );
}
