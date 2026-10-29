'use client';

import { useActionState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { idle } from '@/lib/action-state';
import { useFormStatus } from 'react-dom';
import { addSuggestion } from './actions';

/** One tap adds a thing almost every order waits for. Each is added as "needed", holding work back. */
export function Suggestions({ orderId, labels }: { orderId: string; labels: string[] }) {
  const [state, action] = useActionState(addSuggestion, idle);
  if (labels.length === 0) return null;
  return (
    <div className="section">
      <p className="eyebrow">Quick add</p>
      <form action={action} className="suggestions">
        <input type="hidden" name="order-id" value={orderId} />
        {labels.map((label) => (
          <SuggestionButton key={label} label={label} />
        ))}
      </form>
      <FormNotice state={state} />
    </div>
  );
}

function SuggestionButton({ label }: { label: string }) {
  const { pending, data } = useFormStatus();
  const mine = pending && data?.get('suggestion') === label;
  return (
    <button type="submit" name="suggestion" value={label} className="suggest" disabled={pending}>
      {mine ? 'Adding…' : `+ ${label}`}
    </button>
  );
}
