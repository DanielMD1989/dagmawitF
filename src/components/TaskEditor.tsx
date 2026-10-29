'use client';

import { useActionState } from 'react';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { TaskFields, type TaskValues } from '@/components/TaskFields';
import { SelectField, TextField } from '@/components/fields';
import { idle, type ActionState } from '@/lib/action-state';

type Action = (previous: ActionState, formData: FormData) => Promise<ActionState>;

export interface TaskEditorActions {
  save: Action;
  remove: Action;
  addLink: Action;
  removeLink: Action;
  saveNeeds: Action;
}

/**
 * Everything about one task, behind one "Edit" tap: its fields, what it comes after, what it waits for, and
 * removing it. Used by the library (a template's task) and by an order's Plan tab (an order's task); `owner` is
 * the template or the order, sent with the forms that need it.
 */
export function TaskEditor({
  task,
  scope,
  owner,
  before,
  candidates,
  items,
  actions,
  impact = false,
}: {
  task: TaskValues & { id: string };
  scope: 'template' | 'order';
  owner: { name: 'template-id' | 'order-id'; id: string };
  /** The tasks it comes after, with the days of rest. */
  before: { id: string; title: string; lagDays: number }[];
  /** The tasks it could come after without making a loop. */
  candidates: { id: string; title: string }[];
  /** What it could wait for, and whether it does. */
  items: { id: string; label: string; ticked: boolean }[];
  actions: TaskEditorActions;
  /** Offer "Save and see impact" (an active order's task: docs/change.md). */
  impact?: boolean;
}) {
  const [saved, save] = useActionState(actions.save, idle);
  const [linked, link] = useActionState(actions.addLink, idle);
  const [needed, saveNeeds] = useActionState(actions.saveNeeds, idle);
  const prefix = `task-${task.id}`;

  return (
    <details className="disclosure disclosure--link" id={`task-${task.id}`}>
      <summary>
        Edit<span className="sr-only"> {task.title}</span>
      </summary>
      <div className="disclosure__panel">
        <form action={save} className="form" noValidate>
          <input type="hidden" name="id" value={task.id} />
          <input type="hidden" name={owner.name} value={owner.id} />
          <TaskFields state={saved} idPrefix={prefix} saved={task} scope={scope} />
          <FormNotice state={saved} />
          <div className="btn-row">
            <SubmitButton name="intent" value="save">
              Save task
            </SubmitButton>
            {impact && (
              <SubmitButton name="intent" value="impact" className="btn btn--quiet" pendingText="Planning…">
                Save and see impact
              </SubmitButton>
            )}
          </div>
        </form>

        <section className="subsection" aria-labelledby={`${prefix}-after`}>
          <h4 id={`${prefix}-after`}>Comes after</h4>
          {before.length === 0 ? (
            <p className="hint">Nothing: it can start as soon as there is time.</p>
          ) : (
            <ul className="plain-list">
              {before.map((b) => (
                <li key={b.id} className="link-row">
                  <span>
                    {b.title}
                    {b.lagDays > 0 && (
                      <span className="hint">
                        {' '}
                        · then {b.lagDays} day{b.lagDays === 1 ? '' : 's'} of rest
                      </span>
                    )}
                  </span>
                  <RemoveLink action={actions.removeLink} from={b.id} to={task.id} title={b.title} />
                </li>
              ))}
            </ul>
          )}
          {candidates.length > 0 && (
            <form action={link} className="form" noValidate>
              <input type="hidden" name={owner.name} value={owner.id} />
              <input type="hidden" name="to" value={task.id} />
              <div className="form-grid form-grid--2">
                <SelectField
                  name="from"
                  id={`${prefix}-from`}
                  label="Add a task it comes after"
                  state={linked}
                  saved=""
                  options={[
                    { value: '', label: 'Choose a task…' },
                    ...candidates.map((c) => ({ value: c.id, label: c.title })),
                  ]}
                />
                <TextField
                  name="lag-days"
                  id={`${prefix}-lag`}
                  label="Days of rest between (optional)"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={30}
                  state={linked}
                />
              </div>
              <FormNotice state={linked} />
              <div className="btn-row">
                <SubmitButton className="btn btn--quiet" pendingText="Linking…">
                  Link
                </SubmitButton>
              </div>
            </form>
          )}
        </section>

        {items.length > 0 && (
          <section className="subsection" aria-labelledby={`${prefix}-needs`}>
            <h4 id={`${prefix}-needs`}>Waits for</h4>
            <form action={saveNeeds} className="form" noValidate>
              <input type="hidden" name={owner.name} value={owner.id} />
              <input type="hidden" name="task-id" value={task.id} />
              <div className="checks">
                {items.map((i) => (
                  <label key={i.id} className="check">
                    <input type="checkbox" name="needs" value={i.id} defaultChecked={i.ticked} />
                    {i.label}
                  </label>
                ))}
              </div>
              <FormNotice state={needed} />
              <div className="btn-row">
                <SubmitButton className="btn btn--quiet">Save what it waits for</SubmitButton>
              </div>
            </form>
          </section>
        )}

        <ConfirmAction
          action={actions.remove}
          fields={{ id: task.id }}
          label="Remove this task"
          question={`Remove “${task.title}” and its links?`}
          confirmLabel="Yes, remove"
        />
      </div>
    </details>
  );
}

function RemoveLink({
  action,
  from,
  to,
  title,
}: {
  action: Action;
  from: string;
  to: string;
  title: string;
}) {
  const [state, remove] = useActionState(action, idle);
  return (
    <form action={remove}>
      <input type="hidden" name="from" value={from} />
      <input type="hidden" name="to" value={to} />
      <SubmitButton
        className="btn btn--quiet btn--small"
        pendingText="Removing…"
        aria-label={`No longer after ${title}`}
      >
        Unlink
      </SubmitButton>
      <FormNotice state={state} />
    </form>
  );
}
