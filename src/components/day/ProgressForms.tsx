'use client';

import { useActionState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { HoursMinutes } from '@/components/HoursMinutes';
import { SubmitButton } from '@/components/SubmitButton';
import { TextField } from '@/components/fields';
import { fieldValue, idle, type ActionState } from '@/lib/action-state';
import type { TaskStatus } from '@/domain/day/today';
import { estimateFields } from '@/domain/planning/forms';
import {
  finishTask,
  holdTask,
  keepGoing,
  releaseTask,
  reopenTask,
  startTask,
} from '@/app/(app)/today/actions';

/**
 * The actions on one task of the day: start, done (with the time it took), still going (with what is left), hold
 * and release, and not done after all. Each is its own small form, so a refusal shows next to what she typed.
 */

/** Hours and minutes, showing what she typed if the form was refused, else the saved value. */
function Minutes({
  state,
  prefix,
  id,
  saved,
  legend,
}: {
  state: ActionState;
  prefix: string;
  id: string;
  saved: number | null;
  legend: string;
}) {
  const values = estimateFields(saved);
  return (
    <HoursMinutes
      prefix={prefix}
      id={id}
      legend={legend}
      error={state.errors[`${prefix}-hours`]}
      hours={fieldValue(state, `${prefix}-hours`, values.hours)}
      minutes={fieldValue(state, `${prefix}-minutes`, values.minutes)}
    />
  );
}

/** Each progress form says which status it was shown for: the server leaves a task that has moved since. */
function Seen({ status }: { status: TaskStatus }) {
  return <input type="hidden" name="seen" value={status} />;
}

export function StartButton({ id, title }: { id: string; title: string }) {
  const [state, action] = useActionState(startTask, idle);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <Seen status="not_started" />
      <SubmitButton
        className="btn btn--quiet btn--small"
        pendingText="Starting…"
        aria-label={`Start ${title}`}
      >
        Start
      </SubmitButton>
      <FormNotice state={state} />
    </form>
  );
}

export function DoneForm({
  id,
  title,
  status,
  needsTime,
  suggested,
  today,
}: {
  id: string;
  title: string;
  status: TaskStatus;
  needsTime: boolean;
  /** What to offer as the time it took: her estimate. */
  suggested: number | null;
  today: string;
}) {
  const [state, action] = useActionState(finishTask, idle);
  return (
    <details className="disclosure disclosure--link">
      <summary>
        Done<span className="sr-only">: {title}</span>
      </summary>
      <div className="disclosure__panel">
        <form action={action} className="form" noValidate>
          <input type="hidden" name="id" value={id} />
          <Seen status={status} />
          {needsTime && (
            <Minutes
              state={state}
              prefix="actual"
              id={id}
              saved={suggested}
              legend="How long it took, in total"
            />
          )}
          <TextField
            name="done-on"
            id={`${id}-done-on`}
            label="Finished on"
            type="date"
            max={today}
            state={state}
            saved={today}
          />
          <FormNotice state={state} />
          <div className="btn-row">
            <SubmitButton pendingText="Saving…">Mark as done</SubmitButton>
          </div>
        </form>
      </div>
    </details>
  );
}

export function StillGoingForm({
  id,
  title,
  status,
  left,
}: {
  id: string;
  title: string;
  status: TaskStatus;
  left: number | null;
}) {
  const [state, action] = useActionState(keepGoing, idle);
  return (
    <details className="disclosure disclosure--link">
      <summary>
        Still going<span className="sr-only">: {title}</span>
      </summary>
      <div className="disclosure__panel">
        <form action={action} className="form" noValidate>
          <input type="hidden" name="id" value={id} />
          <Seen status={status} />
          <Minutes state={state} prefix="remaining" id={id} saved={left} legend="About how long is left" />
          <FormNotice state={state} />
          <div className="btn-row">
            <SubmitButton pendingText="Saving…">Save what is left</SubmitButton>
          </div>
        </form>
      </div>
    </details>
  );
}

export function HoldForm({ id, title }: { id: string; title: string }) {
  const [state, action] = useActionState(holdTask, idle);
  return (
    <details className="disclosure disclosure--link">
      <summary>
        Hold<span className="sr-only">: {title}</span>
      </summary>
      <div className="disclosure__panel">
        <form action={action} className="form" noValidate>
          <input type="hidden" name="id" value={id} />
          <TextField
            name="reason"
            id={`${id}-reason`}
            label="Why is it on hold?"
            state={state}
            maxLength={200}
            required
          />
          <FormNotice state={state} />
          <div className="btn-row">
            <SubmitButton pendingText="Saving…">Put on hold</SubmitButton>
          </div>
        </form>
      </div>
    </details>
  );
}

export function ReleaseButton({ id, title }: { id: string; title: string }) {
  const [state, action] = useActionState(releaseTask, idle);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton
        className="btn btn--quiet btn--small"
        pendingText="Releasing…"
        aria-label={`Release ${title}`}
      >
        Release
      </SubmitButton>
      <FormNotice state={state} />
    </form>
  );
}

export function ReopenButton({ id, title }: { id: string; title: string }) {
  const [state, action] = useActionState(reopenTask, idle);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <Seen status="done" />
      <SubmitButton
        className="btn btn--quiet btn--small"
        pendingText="Saving…"
        aria-label={`${title} is not done after all`}
      >
        Not done
      </SubmitButton>
      <FormNotice state={state} />
    </form>
  );
}
