'use client';

import { useActionState, useRef } from 'react';
import { markPartDone } from '@/app/(app)/steps/actions';
import { FormNotice } from '@/components/FormNotice';
import { useCloseOnSaved } from '@/components/Sheet';
import { SubmitButton } from '@/components/SubmitButton';
import { TextField } from '@/components/fields';
import { MAX_LEFT_NOTE } from '@/domain/steps/forms';
import { idle, type ActionState } from '@/lib/action-state';

/** The action's answer, and how many times it was saved: each save closes the form again. */
type Saved = ActionState & { saves: number };

async function save(previous: Saved, data: FormData): Promise<Saved> {
  const r = await markPartDone(previous, data);
  return { ...r, saves: previous.saves + (r.status === 'success' ? 1 : 0) };
}

/**
 * "Part done…" under a step not done yet (decision 0087): part of it is done, not all, so it is not ticked. She can say
 * what is left; the step stays open and moves on to the next day like any unfinished step. Not offered for a Delivery,
 * which is done or not.
 */
export function PartDoneForm({
  stepId,
  orderId,
  title,
  started,
  leftNote,
}: {
  stepId: string;
  orderId: string | null;
  title: string;
  started: boolean;
  leftNote: string | null;
}) {
  const [state, action] = useActionState(save, { ...idle, saves: 0 });
  const form = useRef<HTMLFormElement>(null);
  useCloseOnSaved(form, state);
  return (
    // A new, closed form after each save: the step itself now says what is left.
    <details
      key={state.saves}
      className="disclosure disclosure--row"
      open={state.status === 'error' || undefined}
    >
      <summary>{started ? 'Change what is left' : 'Part done, say what is left'}</summary>
      <div className="disclosure__panel">
        <form ref={form} action={action} className="form" noValidate aria-label={`Part done: ${title}`}>
          <input type="hidden" name="step-id" value={stepId} />
          {orderId && <input type="hidden" name="order-id" value={orderId} />}
          <TextField
            name="left"
            id={`left-${stepId}`}
            label="What is left (optional)"
            state={state}
            saved={leftNote ?? ''}
            placeholder="Bodice and sleeves"
            maxLength={MAX_LEFT_NOTE}
            autoComplete="off"
          />
          <FormNotice state={state} />
          <div className="btn-row">
            <SubmitButton pendingText="Saving…">{started ? 'Save' : 'Mark part done'}</SubmitButton>
          </div>
        </form>
      </div>
    </details>
  );
}
