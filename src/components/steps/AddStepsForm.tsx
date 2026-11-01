'use client';

import { startTransition, useActionState, type FormEvent } from 'react';
import { addSteps } from '@/app/(app)/steps/actions';
import { FormNotice } from '@/components/FormNotice';
import { StepBuilder } from '@/components/steps/StepBuilder';
import { idle, type ActionState } from '@/lib/action-state';

/** The action's answer, and how many times steps were saved: each save starts a new, empty builder. */
type Added = ActionState & { saves: number };

async function add(previous: Added, data: FormData): Promise<Added> {
  const r = await addSteps(previous, data);
  return { ...r, saves: previous.saves + (r.status === 'success' ? 1 : 0) };
}

/**
 * Steps added to an order on its page with the same step buttons as a new order (decision 0085): an order taken in a
 * hurry gets its steps here afterwards, several at once. Open by itself while the order has none.
 */
export function AddStepsForm({
  orderId,
  today,
  usual,
  open,
}: {
  orderId: string;
  today: string;
  usual: readonly string[];
  /** Shown open, not behind "Add steps": the order has no steps yet. */
  open: boolean;
}) {
  const [state, action, pending] = useActionState(add, { ...idle, saves: 0 });
  // Sent by hand: React's own form reset would empty the rows she built even when they are refused.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  };

  const form = (
    <form onSubmit={submit} className="form" noValidate aria-label="Add steps" aria-busy={pending}>
      <input type="hidden" name="order-id" value={orderId} />
      <StepBuilder
        // A new builder, empty, once the steps are saved; on a refusal the rows stay as she left them.
        key={state.saves}
        usual={usual}
        today={today}
        errors={state.errors}
        emptyHint="Tap a step above, then give it its day."
      />
      <FormNotice state={state} />
      <div className="btn-row">
        <button type="submit" className="btn" disabled={pending}>
          {pending ? 'Adding…' : 'Add these steps'}
        </button>
      </div>
    </form>
  );

  // Open after a save too: what was added is said, and more can be added (it folds once the order has steps).
  if (open) return form;
  return (
    <details className="disclosure disclosure--link" open={state.status !== 'idle' || undefined}>
      <summary>Add steps</summary>
      <div className="disclosure__panel">{form}</div>
    </details>
  );
}
