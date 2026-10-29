'use client';

import { useActionState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { fieldValue, idle } from '@/lib/action-state';
import { addException } from './actions';

export function ExceptionForm({ today }: { today: string }) {
  const [state, action] = useActionState(addException, idle);

  return (
    <form action={action} className="form" noValidate>
      <div className="field">
        <label htmlFor="exception-day">Date</label>
        <input
          id="exception-day"
          name="day"
          type="date"
          className="input"
          min={today}
          required
          defaultValue={fieldValue(state, 'day', '')}
          aria-invalid={Boolean(state.errors.day)}
        />
        {state.errors.day && <p className="error">{state.errors.day}</p>}
      </div>
      <fieldset className="field">
        <legend>What happens that day</legend>
        <div className="segmented">
          <label>
            <input
              type="radio"
              name="kind"
              value="closed"
              defaultChecked={fieldValue(state, 'kind', 'closed') === 'closed'}
            />
            Closed
          </label>
          <label>
            <input
              type="radio"
              name="kind"
              value="shortened"
              defaultChecked={fieldValue(state, 'kind', 'closed') === 'shortened'}
            />
            A shorter day
          </label>
        </div>
        {state.errors.kind && <p className="error">{state.errors.kind}</p>}
      </fieldset>
      <div className="time-pair">
        <div className="field">
          <label htmlFor="exception-hours">Working hours (shorter day only)</label>
          <input
            id="exception-hours"
            name="hours"
            type="number"
            inputMode="numeric"
            min={0}
            max={24}
            className="input"
            placeholder="0"
            defaultValue={fieldValue(state, 'hours', '')}
            aria-invalid={Boolean(state.errors.hours)}
          />
          {state.errors.hours && <p className="error">{state.errors.hours}</p>}
        </div>
        <div className="field">
          <label htmlFor="exception-minutes">And minutes</label>
          <input
            id="exception-minutes"
            name="minutes"
            type="number"
            inputMode="numeric"
            min={0}
            max={59}
            className="input"
            placeholder="0"
            defaultValue={fieldValue(state, 'minutes', '')}
            aria-invalid={Boolean(state.errors.minutes)}
          />
          {state.errors.minutes && <p className="error">{state.errors.minutes}</p>}
        </div>
      </div>
      <div className="field">
        <label htmlFor="exception-reason">Reason (optional)</label>
        <input
          id="exception-reason"
          name="reason"
          className="input"
          maxLength={200}
          placeholder="Holiday, fabric trip, leave"
          defaultValue={fieldValue(state, 'reason', '')}
          aria-invalid={Boolean(state.errors.reason)}
        />
        {state.errors.reason && <p className="error">{state.errors.reason}</p>}
      </div>
      <FormNotice state={state} />
      <div className="btn-row">
        <SubmitButton>Add this day</SubmitButton>
      </div>
    </form>
  );
}
