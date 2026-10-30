import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { AddStepForm } from '@/components/steps/AddStepForm';
import { StepEditor } from '@/components/steps/StepEditor';
import { TickButton } from '@/components/steps/TickButton';
import { formatDay } from '@/domain/dates';
import { isUuid } from '@/domain/form-input';
import { KIND_WORDS } from '@/domain/jobs/kinds';
import { pickTemplate } from '@/domain/jobs/templates';
import { isClosed } from '@/domain/orders/status';
import { isOverdue, jobWarnings, lastDayOf } from '@/domain/steps/agenda';
import { daysLabel, timeLabel } from '@/domain/steps/words';
import { loadClients } from '@/server/clients';
import { getOrder } from '@/server/orders';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { loadJobSteps, loadTemplates } from '@/server/steps';
import { createSupabase } from '@/server/supabase';
import { OrderDetailsForm } from './OrderDetailsForm';
import { TemplateStepsForm } from './TemplateStepsForm';
import { deleteDraft } from './actions';

/** A job's steps, each on its day, and the job itself (docs/calendar-first.md). */
export default async function JobStepsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const order = await getOrder(id);
  if (!order) notFound();

  const supabase = await createSupabase();
  const [steps, templates, clients, prefs] = await Promise.all([
    loadJobSteps(supabase, order.id),
    loadTemplates(supabase),
    loadClients(supabase),
    loadPreferences(supabase),
  ]);
  const closed = isClosed(order.status);
  const warnings = closed ? [] : jobWarnings(steps, order.deliveryOn, prefs.today);
  const done = steps.filter((s) => s.doneOn !== null).length;
  const ofKind = templates.filter((t) => t.kind === order.kind);
  const preferred = pickTemplate(templates, order.kind, order.garments[0]?.garmentType ?? '')?.id ?? null;
  const templateOptions = [...ofKind, ...templates.filter((t) => t.kind !== order.kind)].map((t) => ({
    id: t.id,
    label: `${t.name} (${t.steps.length} step${t.steps.length === 1 ? '' : 's'})`,
  }));

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
            {!closed && templates.length > 0 && (
              <TemplateStepsForm orderId={order.id} templates={templateOptions} preferred={preferred} />
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
            <AddStepForm orderId={order.id} day={prefs.today} summary="Add a step" idPrefix="new-step" />
            {steps.length > 0 && templates.length > 0 && (
              <details className="disclosure disclosure--link">
                <summary>Add the steps of a template</summary>
                <div className="disclosure__panel">
                  <TemplateStepsForm orderId={order.id} templates={templateOptions} preferred={preferred} />
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
            <dt>Kind</dt>
            <dd>{KIND_WORDS[order.kind].label}</dd>
            <dt>Client</dt>
            <dd>{order.client.name}</dd>
            <dt>{KIND_WORDS[order.kind].dueLabel}</dt>
            <dd>{formatDay(order.deliveryOn)}</dd>
          </dl>
        )}
        <OrderDetailsForm
          order={{
            id: order.id,
            status: order.status,
            kind: order.kind,
            clientId: order.client.id,
            dueOn: order.deliveryOn,
            notes: order.notes,
          }}
          clients={clients.map((c) => ({ id: c.id, name: c.name }))}
        />
      </section>

      {order.status === 'draft' && (
        <section className="section" aria-labelledby="delete-heading">
          <div className="section__head">
            <h2 id="delete-heading">Delete this draft</h2>
            <p className="hint">
              A draft has made no promise, so it can be deleted completely. To keep a record of a job that is
              called off, cancel it instead.
            </p>
          </div>
          <ConfirmAction
            action={deleteDraft}
            fields={{ id: order.id }}
            label="Delete this draft"
            question={`Delete job #${order.number}, with its garments, steps and pictures? This cannot be undone.`}
            confirmLabel="Yes, delete"
            pendingText="Deleting…"
          />
        </section>
      )}
    </>
  );
}
