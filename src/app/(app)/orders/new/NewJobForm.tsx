'use client';

import { startTransition, useActionState, useRef, useState, type FormEvent } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { TextArea, TextField } from '@/components/fields';
import { fieldValue, idle } from '@/lib/action-state';
import { isIsoDate } from '@/domain/dates';
import { daysLeft } from '@/domain/jobs/words';
import { DELIVERY_STEP, EVENT_LABEL, NEW_CLIENT, NO_CLIENT } from '@/domain/orders/forms';
import { createJob } from '../actions';

/** A step as she builds it here: what, which day, and a time if it has one (decision 0079). */
interface Row {
  key: number;
  title: string;
  day: string;
  from: string;
}
type RowField = Exclude<keyof Row, 'key'>;

const blank = (key: number, title = ''): Row => ({ key, title, day: '', from: '' });

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

  const [client, setClient] = useState(
    fieldValue(state, 'client', initialClient ?? (clients.length ? '' : NEW_CLIENT)),
  );
  const event = client === NO_CLIENT;
  const [due, setDue] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const next = useRef(0);
  const add = (...titles: string[]) => setRows((r) => [...r, ...titles.map((t) => blank(next.current++, t))]);
  const change = (key: number, field: RowField, value: string) =>
    setRows((r) => r.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
  const remove = (key: number) => setRows((r) => r.filter((row) => row.key !== key));
  const err = (i: number, field: string) => state.errors[`step-${i}-${field}`];
  // The delivery has its own day and time above; offering it again as a step was confusing (decision 0079).
  const offered = usual.filter((t) => t.trim().toLowerCase() !== DELIVERY_STEP.toLowerCase());

  return (
    <form onSubmit={submit} className="form" noValidate aria-busy={pending}>
      <section className="section" aria-labelledby="who-heading">
        <h2 id="who-heading">{event ? 'A job or an event' : 'Who it is for'}</h2>
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
            <option value={NO_CLIENT}>{EVENT_LABEL}</option>
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

      <section className="section" aria-labelledby="what-heading">
        <h2 id="what-heading">{event ? 'Its name and day' : 'What it is'}</h2>
        <TextField
          name="title"
          label={event ? 'Name of the event' : 'What it is (optional)'}
          state={state}
          list={event ? undefined : 'garment-types'}
          autoComplete="off"
          maxLength={120}
          hint={
            event
              ? 'For example “Bazaar at the Hyatt” or “Fashion show”.'
              : 'For example “Bridal gown” or “Shorten trousers”.'
          }
        />
        <datalist id="garment-types">
          {garmentTypes.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
        {!event && (
          <TextArea
            name="brief"
            label="Design brief (optional)"
            state={state}
            rows={3}
            maxLength={4000}
            hint="What the client asked for: neckline, sleeves, fabric ideas, the occasion."
          />
        )}
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
          <p className="hint">Today counts the days down to it.</p>
        </>
      ) : (
        <section className="section" aria-labelledby="steps-heading">
          <h2 id="steps-heading">Steps</h2>
          <p className="hint">Tap the steps this job needs, then give each its day.</p>
          <div className="chips" role="group" aria-label="Your usual steps">
            {offered.map((t) => (
              <button key={t} type="button" className="chip-button" onClick={() => add(t)}>
                + {t}
              </button>
            ))}
            <button type="button" className="chip-button" onClick={() => add('')}>
              + Another step
            </button>
          </div>

          <input type="hidden" name="steps" value={rows.length} />
          {rows.length === 0 ? (
            <p className="day-list__empty">
              No steps yet. Tap one above, or save the job and add them later.
            </p>
          ) : (
            <ol className="step-rows">
              {rows.map((row, i) => (
                <li key={row.key} className="step-row">
                  <fieldset>
                    <legend className="sr-only">Step {i + 1}</legend>
                    <div className="step-row__head">
                      <span className="step-row__n" aria-hidden="true">
                        {i + 1}
                      </span>
                      <label htmlFor={`step-${row.key}-title`} className="sr-only">
                        Step {i + 1}
                      </label>
                      <input
                        id={`step-${row.key}-title`}
                        name={`step-${i}-title`}
                        className="input step-row__title"
                        value={row.title}
                        onChange={(e) => change(row.key, 'title', e.target.value)}
                        placeholder="What is done"
                        maxLength={120}
                        list="usual-steps"
                        autoComplete="off"
                        aria-invalid={Boolean(err(i, 'title'))}
                        aria-describedby={err(i, 'title') ? `step-${row.key}-title-error` : undefined}
                      />
                      <button
                        type="button"
                        className="icon-btn icon-btn--quiet"
                        onClick={() => remove(row.key)}
                        aria-label={`Remove step ${i + 1}${row.title ? `, ${row.title}` : ''}`}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          aria-hidden="true"
                        >
                          <path d="M6 6l12 12 M18 6 6 18" />
                        </svg>
                      </button>
                    </div>
                    {err(i, 'title') && (
                      <p id={`step-${row.key}-title-error`} className="error">
                        {err(i, 'title')}
                      </p>
                    )}
                    <div className="form-grid form-grid--pair">
                      <RowInput
                        row={row}
                        i={i}
                        field="day"
                        label="Day"
                        type="date"
                        min={today}
                        error={err(i, 'day')}
                        onChange={change}
                      />
                      <RowInput
                        row={row}
                        i={i}
                        field="from"
                        label="Time (optional)"
                        type="time"
                        error={err(i, 'from')}
                        onChange={change}
                      />
                    </div>
                  </fieldset>
                </li>
              ))}
            </ol>
          )}
          <datalist id="usual-steps">
            {offered.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          {state.errors.steps && <p className="error">{state.errors.steps}</p>}
        </section>
      )}

      <details className="disclosure disclosure--link">
        <summary>{event ? 'Notes and number' : 'Notes and job number'}</summary>
        <div className="disclosure__panel">
          <TextArea
            name="notes"
            label="Notes (optional)"
            state={state}
            rows={3}
            maxLength={4000}
            hint={
              event
                ? 'For you. For example: the stand number, what to bring.'
                : 'For you. For example: pays in two parts, collects with her mother.'
            }
          />
          <TextField
            name="number"
            label="Job number"
            type="number"
            inputMode="numeric"
            min={1}
            state={state}
            placeholder={String(nextNumber)}
            hint={`Leave empty to continue from your highest number. The next one is #${nextNumber}.`}
          />
        </div>
      </details>

      <FormNotice state={state} />
      <div className="btn-row">
        <button type="submit" className="btn" disabled={pending}>
          {pending ? 'Saving…' : event ? 'Save the event' : 'Save the job'}
        </button>
      </div>
    </form>
  );
}

function RowInput({
  row,
  i,
  field,
  label,
  type,
  min,
  error,
  onChange,
}: {
  row: Row;
  i: number;
  field: Exclude<RowField, 'title'>;
  label: string;
  type: 'date' | 'time';
  min?: string;
  error: string | undefined;
  onChange: (key: number, field: RowField, value: string) => void;
}) {
  const id = `step-${row.key}-${field}`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={`step-${i}-${field}`}
        type={type}
        className="input"
        value={row[field]}
        min={min}
        onChange={(e) => onChange(row.key, field, e.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && (
        <p id={`${id}-error`} className="error">
          {error}
        </p>
      )}
    </div>
  );
}
