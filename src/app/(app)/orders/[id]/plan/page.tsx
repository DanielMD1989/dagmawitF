import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AddTaskForm } from '@/components/AddTaskForm';
import { ConfirmAction } from '@/components/ConfirmAction';
import { TaskList } from '@/components/TaskList';
import { formatDay } from '@/domain/dates';
import { formatMinutes } from '@/domain/duration';
import { isUuid } from '@/domain/form-input';
import { isClosed, isPlanned } from '@/domain/orders/status';
import { isCurrent } from '@/domain/planning/proposal';
import { formatSpan, reviewOrder } from '@/domain/planning/review';
import { getOrder, loadPrerequisites } from '@/server/orders';
import {
  loadApprovedPlan,
  loadEpoch,
  loadOrderPlanning,
  loadPlanList,
  loadTemplates,
} from '@/server/planning';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';
import { addLink, addTask, clearGarmentTasks, removeLink, removeTask, saveNeeds, saveTask } from './actions';
import { ApplyTemplateForm, MakeProposalForm } from './PlanForms';

/** The order's tasks per garment, and where the order stands in the approved plan. */
export default async function OrderPlanPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const order = await getOrder(id);
  if (!order) notFound();

  const supabase = await createSupabase();
  const [planning, items, templates, prefs, epoch, approved, plans] = await Promise.all([
    loadOrderPlanning(supabase, order.id),
    loadPrerequisites(supabase, order.id),
    loadTemplates(supabase),
    loadPreferences(supabase),
    loadEpoch(supabase),
    loadApprovedPlan(supabase),
    loadPlanList(supabase),
  ]);
  const editable = !isClosed(order.status);
  const review = approved ? reviewOrder(approved.stored, approved.slots, order.id) : null;
  const current = approved !== null && isCurrent(approved, epoch, prefs.today);
  const openProposal = plans.find((p) => p.status === 'proposed' && isCurrent(p, epoch, prefs.today)) ?? null;
  const undated = planning.tasks.filter((t) => t.kind === 'fixed' && !t.fixedOn).length;

  // When each task is planned in the approved plan.
  const planned: Record<string, string> = {};
  if (approved) {
    for (const t of approved.stored.tasks) {
      if (t.start === null || t.finish === null) continue;
      const time = approved.slots.find((s) => s.taskId === t.id && s.time)?.time;
      planned[t.id] = `${formatSpan(t.start, t.finish)}${time ? `, ${time}` : ''}`;
    }
  }

  const actions = { save: saveTask, remove: removeTask, addLink, removeLink, saveNeeds };
  const itemList = items.map((i) => ({ id: i.id, label: i.label }));

  return (
    <>
      <section className="section" aria-labelledby="plan-heading">
        <div className="card">
          <h2 id="plan-heading" className="h3">
            {review === null
              ? 'Not in an approved plan yet'
              : review.taskCount === 0
                ? `No tasks in plan ${approved?.number}`
                : `${review.stateLabel} in plan ${approved?.number}`}
          </h2>
          {review && review.taskCount > 0 && (
            <p>
              {review.readyOn
                ? `Ready ${formatDay(review.readyOn)}; handover ${formatDay(review.deliveryOn)}.`
                : `Not all of its work could be planned. Handover ${formatDay(review.deliveryOn)}.`}{' '}
              {formatMinutes(review.placedMinutes)} of {formatMinutes(review.neededMinutes)} placed.
            </p>
          )}
          {approved && !current && (
            <p className="attention">
              Something has changed since plan {approved.number} was approved, or it was made for an earlier
              day. Make a new proposal to see where things stand now.
            </p>
          )}
          {!isPlanned(order.status) && (
            <p className="hint">
              Only active orders are planned. This one is{' '}
              {order.status === 'draft' ? 'a draft' : order.status.replace('_', ' ')}.
            </p>
          )}
          {undated > 0 && isPlanned(order.status) && (
            <p className="attention">
              {undated} appointment{undated === 1 ? ' has' : 's have'} no day yet, so the work after{' '}
              {undated === 1 ? 'it' : 'them'} cannot be planned.
            </p>
          )}
          <div className="btn-row">
            {openProposal && (
              <Link href={`/plan/${openProposal.number}?order=${order.id}`} className="btn btn--quiet">
                Review proposal {openProposal.number}
              </Link>
            )}
            <Link href="/plan" className="btn btn--quiet">
              All plans
            </Link>
          </div>
          {isPlanned(order.status) && planning.tasks.length > 0 && (
            <MakeProposalForm
              orderId={order.id}
              label={openProposal ? 'Make a new proposal' : 'Make a proposal'}
            />
          )}
        </div>
      </section>

      {order.garments.map((g) => {
        const tasks = planning.tasks.filter((t) => t.garmentId === g.id);
        const from = planning.garments.find((x) => x.id === g.id);
        const match = templates.find((t) => t.garmentType.toLowerCase() === g.garmentType.toLowerCase());
        return (
          <section key={g.id} className="section" aria-labelledby={`garment-${g.id}`}>
            <div className="section__head">
              <h2 id={`garment-${g.id}`}>{g.garmentType}</h2>
              {from?.templateVersion && (
                <p className="hint">
                  Planned from {from.templateName ? `“${from.templateName}”` : 'a template since deleted'},
                  version {from.templateVersion}.
                </p>
              )}
            </div>
            {tasks.length === 0 && editable && (
              <div className="card">
                {templates.length > 0 ? (
                  <ApplyTemplateForm
                    garmentId={g.id}
                    garmentType={g.garmentType}
                    templates={templates.map((t) => ({ id: t.id, name: t.name }))}
                    suggested={match?.id ?? ''}
                  />
                ) : (
                  <p>
                    No templates yet. <Link href="/library/new">Make one</Link>, or add the tasks one by one
                    below.
                  </p>
                )}
              </div>
            )}
            {tasks.length === 0 && !editable && <p className="hint">No tasks.</p>}
            <TaskList
              tasks={tasks}
              links={planning.links}
              items={itemList}
              needs={planning.needs}
              scope="order"
              owner={{ name: 'order-id', id: order.id }}
              actions={actions}
              editable={editable}
              planned={current ? planned : {}}
              impact={isPlanned(order.status)}
            />
            {editable && (
              <AddTaskForm
                action={addTask}
                hidden={{ 'order-id': order.id, 'garment-id': g.id }}
                scope="order"
                idPrefix={`new-task-${g.id}`}
                summary={tasks.length === 0 ? 'Or add tasks one by one' : 'Add a task'}
              />
            )}
            {editable && tasks.length > 0 && (
              <ConfirmAction
                action={clearGarmentTasks}
                fields={{ 'garment-id': g.id }}
                label="Remove all tasks of this garment"
                question={`Remove all ${tasks.length} tasks of ${g.garmentType}, with their links? Its preparation stays.`}
                confirmLabel="Yes, remove them"
              />
            )}
          </section>
        );
      })}
    </>
  );
}
