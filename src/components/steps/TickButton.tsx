'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { toggleStep } from '@/app/(app)/steps/actions';
import { idle } from '@/lib/action-state';

function Mark({ title, done }: { title: string; done: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={done ? 'tick tick--done' : 'tick'}
      aria-label={done ? `${title}: done. Mark as not done` : `Mark ${title} as done`}
      aria-busy={pending}
      disabled={pending}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </button>
  );
}

/** The round mark beside a step: one tap ticks it done today, another opens it again. */
export function TickButton({
  stepId,
  orderId,
  title,
  done,
}: {
  stepId: string;
  orderId: string | null;
  title: string;
  done: boolean;
}) {
  const [state, action] = useActionState(toggleStep, idle);
  return (
    <form action={action} className="tick-form">
      <input type="hidden" name="step-id" value={stepId} />
      {orderId && <input type="hidden" name="order-id" value={orderId} />}
      <input type="hidden" name="saw-done" value={String(done)} />
      <Mark title={title} done={done} />
      {state.status === 'error' && (
        <span className="error tick-form__error" role="alert">
          {state.message}
        </span>
      )}
    </form>
  );
}
