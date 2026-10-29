'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { idle, type ActionState } from '@/lib/action-state';

/**
 * A button for something that cannot be undone (removing a garment, a picture, a client). The first press asks
 * the question in words; the second does it. Keyboard focus follows, so nobody is left on a button that has gone.
 */
export function ConfirmAction({
  action,
  fields,
  label,
  question,
  confirmLabel,
  pendingText = 'Removing…',
}: {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  /** Sent with the form (usually the id of what is removed). */
  fields: Record<string, string>;
  /** On the first button, for example "Remove". */
  label: string;
  question: string;
  confirmLabel: string;
  pendingText?: string;
}) {
  const [state, formAction] = useActionState(action, idle);
  const [asking, setAsking] = useState(false);
  const panel = useRef<HTMLFormElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const moved = useRef(false);

  useEffect(() => {
    if (asking) {
      moved.current = true;
      panel.current?.querySelector('button')?.focus();
    } else if (moved.current) {
      opener.current?.focus();
    }
  }, [asking]);

  if (!asking) {
    return (
      <div className="confirm">
        <button ref={opener} type="button" className="btn btn--warn" onClick={() => setAsking(true)}>
          {label}
        </button>
        <FormNotice state={state} />
      </div>
    );
  }

  return (
    <form ref={panel} action={formAction} className="confirm confirm--asking">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <p className="confirm__question">{question}</p>
      <div className="btn-row">
        <SubmitButton className="btn btn--warn" pendingText={pendingText}>
          {confirmLabel}
        </SubmitButton>
        <button type="button" className="btn btn--quiet" onClick={() => setAsking(false)}>
          Keep it
        </button>
      </div>
      <FormNotice state={state} />
    </form>
  );
}
