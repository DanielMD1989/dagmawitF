'use client';

import { useActionState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { TaskFields } from '@/components/TaskFields';
import { idle, type ActionState } from '@/lib/action-state';

/** A new task, at the end of the list. Hidden fields say where it goes (the template, or the order and garment). */
export function AddTaskForm({
  action,
  hidden,
  scope,
  idPrefix,
  summary = 'Add a task',
}: {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  hidden: Record<string, string>;
  scope: 'template' | 'order';
  idPrefix: string;
  summary?: string;
}) {
  const [state, add] = useActionState(action, idle);
  return (
    <details className="disclosure">
      <summary>{summary}</summary>
      <div className="disclosure__panel">
        <form action={add} className="form" noValidate>
          {Object.entries(hidden).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <TaskFields state={state} idPrefix={idPrefix} saved={null} scope={scope} />
          <FormNotice state={state} />
          <div className="btn-row">
            <SubmitButton pendingText="Adding…">Add task</SubmitButton>
          </div>
        </form>
      </div>
    </details>
  );
}
