'use client';

import { useActionState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { idle } from '@/lib/action-state';
import { tidyPictures } from './actions';

/** Settings → Data → Tidy stored pictures (docs/harden.md). */
export function TidyForm() {
  const [state, action] = useActionState(tidyPictures, idle);
  return (
    <form action={action} className="form">
      <FormNotice state={state} />
      <div className="btn-row">
        <SubmitButton className="btn btn--quiet" pendingText="Tidying…">
          Tidy stored pictures
        </SubmitButton>
      </div>
    </form>
  );
}
