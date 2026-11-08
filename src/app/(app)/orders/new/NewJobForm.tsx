'use client';

import { startTransition, useActionState, useState, type FormEvent } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { TextArea, TextField } from '@/components/fields';
import { fieldValue, idle } from '@/lib/action-state';
import { isIsoDate } from '@/domain/dates';
import { daysLeft } from '@/domain/jobs/words';
import { NEW_CLIENT, NO_CLIENT } from '@/domain/orders/forms';
import { StepBuilder } from '@/components/steps/StepBuilder';
import { createJob } from '../actions';

/**
 * A new job (decisions 0068, 0075, 0079): who it is for; what it is; its delivery day, with a time if she has one; and
 * the steps she builds by tapping her usual ones, each with its day and, if it has one, its time. Nothing is guessed: the days are hers. An event (a bazaar, a fashion show) is
 * only its name and its day, counted down on Today; the tailoring steps are not for it.
 */
export function NewJobForm({
  clients,
  initialClient,
  usual,
  today,
  nextNumber,
  garmentTypes,
}: {
  clients: { id: string; name: string }[];
  initialClient: string | null;
  usual: string[];
  today: string;
  nextNumber: number;
  garmentTypes: string[];
}) {
  const [state, action, pending] = useActionState(createJob, idle);
  // Sent by hand rather than through the form's action: React resets a form natively after its action, which would
  // put her chosen client back and empty the steps she built. A refusal must leave everything as she left it.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  };

  // An event is made from "New event", an order from "New order": the form is one or the other from the start, so an
  // event is never asked which customer it is for (decision 0084).
  const event = initialClient === NO_CLIENT;
  const [client, setClient] = useState(
    event ? NO_CLIENT : fieldValue(state, 'client', initialClient ?? (clients.length ? '' : NEW_CLIENT)),
  );
  const [due, setDue] = useState('');

  return (
    <form onSubmit={submit} className="form" noValidate aria-busy={pending}>
      {event ? (
        <input type="hidden" name="client" value={NO_CLIENT} />
      ) : (
        <section className="section" aria-labelledby="who-heading">
          <h2 id="who-heading" className="sr-only">
            Who it is for
          </h2>
          <div className="field">
            <label htmlFor="client">For</label>
            <select
              id="client"
              name="client"
              className="select"
              value={client}
              onChange={(e) => setClient(e.target.value)}
              aria-invalid={Boolean(state.errors.client)}
              aria-describedby={state.errors.client ? 'client-error' : undefined}
            >
              <option value="">Choose a client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value={NEW_CLIENT}>+ A new client</option>
            </select>
            {state.errors.client && (
              <p id="client-error" className="error">
                {state.errors.client}
              </p>
            )}
          </div>
          {client === NEW_CLIENT && (
            <div className="form-grid form-grid--2">
              <TextField
                name="client-name"
                label="Client's name"
                state={state}
                autoComplete="off"
                maxLength={120}
              />
              <TextField
                name="client-phone"
                label="Phone (optional)"
                state={state}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                maxLength={30}
              />
            </div>
          )}
        </section>
      )}

      <section className="section" aria-labelledby="what-heading">
        <h2 id="what-heading" className="sr-only">
          {event ? 'The event' : 'What it is'}
        </h2>
        <TextField
          name="title"
          label={event ? 'Name of the event' : 'What it is (optional)'}
          state={state}
          list={event ? undefined : 'garment-types'}
          autoComplete="off"
          maxLength={120}
        />
        <datalist id="garment-types">
          {garmentTypes.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
        <div className="form-grid form-grid--pair">
          <TextField
            name="due-on"
            label={event ? 'Event day' : 'Delivery day'}
            type="date"
            state={state}
            min={today}
            onChange={(e) => setDue(e.target.value)}
          />
          {!event && <TextField name="due-at" label="Time (optional)" type="time" state={state} />}
        </div>
        {isIsoDate(due) && due >= today && <p className="hint">That is {daysLeft(due, today)}.</p>}
      </section>

      {event ? (
        <>
          <input type="hidden" name="steps" value={0} />
        </>
      ) : (
        <section className="section" aria-labelledby="steps-heading">
          <h2 id="steps-heading">Steps</h2>
          <StepBuilder usual={usual} today={today} errors={state.errors} emptyHint="No steps yet." />
          {state.errors.steps && <p className="error">{state.errors.steps}</p>}
        </section>
      )}

      {/* What can wait comes last, folded (decision 0100): the brief, notes and number. Open when one needs fixing. */}
      <details
        className="disclosure disclosure--link"
        open={Boolean(state.errors.brief || state.errors.notes || state.errors.number) || undefined}
      >
        <summary>{event ? 'Notes and number' : 'Design brief, notes and order number'}</summary>
        <div className="disclosure__panel">
          {!event && (
            <TextArea name="brief" label="Design brief (optional)" state={state} rows={3} maxLength={4000} />
          )}
          <TextArea name="notes" label="Notes (optional)" state={state} rows={3} maxLength={4000} />
          <TextField
            name="number"
            label="Order number"
            type="number"
            inputMode="numeric"
            min={1}
            state={state}
            placeholder={String(nextNumber)}
          />
        </div>
      </details>

      <FormNotice state={state} />
      <div className="btn-row form-bar">
        <button type="submit" className="btn btn--main" disabled={pending}>
          {pending ? 'Saving…' : event ? 'Save the event' : 'Save the order'}
        </button>
      </div>
    </form>
  );
}
