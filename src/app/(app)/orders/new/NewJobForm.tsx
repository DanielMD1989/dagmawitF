'use client';

import { startTransition, useActionState, useRef, useState, type FormEvent } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { TextArea, TextField } from '@/components/fields';
import { fieldValue, idle } from '@/lib/action-state';
import { isIsoDate } from '@/domain/dates';
import { daysLeft } from '@/domain/jobs/words';
import { NEW_CLIENT, NO_CLIENT } from '@/domain/orders/forms';
import { createJob } from '../actions';

interface Row {
  key: number;
  title: string;
  day: string;
  until: string;
  from: string;
  to: string;
}
type RowField = Exclude<keyof Row, 'key'>;

const blank = (key: number, title = ''): Row => ({ key, title, day: '', until: '', from: '', to: '' });

/**
 * A new job (decision 0068): who it is for, or nobody for an event; what it is; its day; and the steps she builds by
 * tapping her usual ones, or a whole list, giving each its day. Nothing is guessed: the days are hers.
 */
export function NewJobForm({
  clients,
  initialClient,
  lists,
  usual,
  today,
  nextNumber,
  garmentTypes,
}: {
  clients: { id: string; name: string }[];
  initialClient: string | null;
  lists: { id: string; name: string; steps: string[] }[];
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
  const [list, setList] = useState(lists[0]?.id ?? '');
  const next = useRef(0);
  const add = (...titles: string[]) => setRows((r) => [...r, ...titles.map((t) => blank(next.current++, t))]);
  const change = (key: number, field: RowField, value: string) =>
    setRows((r) => r.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
  const move = (index: number, by: -1 | 1) =>
    setRows((r) => {
      const copy = [...r];
      [copy[index], copy[index + by]] = [copy[index + by]!, copy[index]!];
      return copy;
    });
  const remove = (key: number) => setRows((r) => r.filter((row) => row.key !== key));
  const err = (i: number, field: string) => state.errors[`step-${i}-${field}`];

  return (
    <form onSubmit={submit} className="form" noValidate aria-busy={pending}>
      <section className="section" aria-labelledby="who-heading">
        <h2 id="who-heading">Who it is for</h2>
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
            <option value={NO_CLIENT}>Nobody: an event, such as a bazaar</option>
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
        <h2 id="what-heading">{event ? 'The event' : 'What it is'}</h2>
        <TextField
          name="title"
          label={event ? 'Name of the event' : 'What it is (optional)'}
          state={state}
          list={event ? undefined : 'garment-types'}
          autoComplete="off"
          maxLength={120}
          hint={
            event ? 'For example “Bazaar at the Hyatt”.' : 'For example “Bridal gown” or “Shorten trousers”.'
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
        <TextField
          name="due-on"
          label={event ? 'Event day' : 'Delivery day'}
          type="date"
          state={state}
          min={today}
          onChange={(e) => setDue(e.target.value)}
          hint={isIsoDate(due) && due >= today ? `That is ${daysLeft(due, today)}.` : undefined}
        />
      </section>

      <section className="section" aria-labelledby="steps-heading">
        <h2 id="steps-heading">Steps</h2>
        <p className="hint">
          Tap the steps this job needs, in order, and give each its day. Add a time to anything with a client,
          such as an appointment or a fitting. Each step shows on that day of your calendar.
        </p>
        <div className="chips" role="group" aria-label="Your usual steps">
          {usual.map((t) => (
            <button key={t} type="button" className="chip-button" onClick={() => add(t)}>
              + {t}
            </button>
          ))}
          <button type="button" className="chip-button" onClick={() => add('')}>
            + Another step
          </button>
        </div>
        {lists.length > 0 && (
          <div className="field">
            <label htmlFor="list">Or all the steps of a list</label>
            <div className="inline-pick">
              <select id="list" className="select" value={list} onChange={(e) => setList(e.target.value)}>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.steps.length} steps)
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() => add(...(lists.find((l) => l.id === list)?.steps ?? []))}
              >
                Add them
              </button>
            </div>
          </div>
        )}

        <input type="hidden" name="steps" value={rows.length} />
        {rows.length === 0 ? (
          <p className="day-list__empty">No steps yet. Tap one above, or save the job and add them later.</p>
        ) : (
          <ol className="step-rows">
            {rows.map((row, i) => (
              <li key={row.key} className="step-row">
                <fieldset>
                  <legend className="sr-only">Step {i + 1}</legend>
                  <div className="step-row__head">
                    <span className="step-row__n" aria-hidden="true">
                      {i + 1}.
                    </span>
                    <div className="step-row__title">
                      <label htmlFor={`step-${row.key}-title`} className="sr-only">
                        Step {i + 1}
                      </label>
                      <input
                        id={`step-${row.key}-title`}
                        name={`step-${i}-title`}
                        className="input"
                        value={row.title}
                        onChange={(e) => change(row.key, 'title', e.target.value)}
                        placeholder="What is done"
                        maxLength={120}
                        list="usual-steps"
                        autoComplete="off"
                        aria-invalid={Boolean(err(i, 'title'))}
                        aria-describedby={err(i, 'title') ? `step-${row.key}-title-error` : undefined}
                      />
                    </div>
                    <div className="step-row__tools">
                      <button
                        type="button"
                        className="btn btn--quiet btn--small"
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                        aria-label={`Move step ${i + 1} earlier`}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn btn--quiet btn--small"
                        disabled={i === rows.length - 1}
                        onClick={() => move(i, 1)}
                        aria-label={`Move step ${i + 1} later`}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="btn btn--quiet btn--small"
                        onClick={() => remove(row.key)}
                        aria-label={`Remove step ${i + 1}${row.title ? `, ${row.title}` : ''}`}
                      >
                        ×
                      </button>
                    </div>
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
                      field="until"
                      label="Last day (optional)"
                      type="date"
                      min={row.day || today}
                      error={err(i, 'until')}
                      onChange={change}
                    />
                    <RowInput
                      row={row}
                      i={i}
                      field="from"
                      label="From (optional)"
                      type="time"
                      error={err(i, 'from')}
                      onChange={change}
                    />
                    <RowInput
                      row={row}
                      i={i}
                      field="to"
                      label="To (optional)"
                      type="time"
                      error={err(i, 'to')}
                      onChange={change}
                    />
                  </div>
                </fieldset>
              </li>
            ))}
          </ol>
        )}
        <datalist id="usual-steps">
          {usual.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        {state.errors.steps && <p className="error">{state.errors.steps}</p>}
      </section>

      <details className="disclosure disclosure--link">
        <summary>Notes and job number</summary>
        <div className="disclosure__panel">
          <TextArea
            name="notes"
            label="Notes (optional)"
            state={state}
            rows={3}
            maxLength={4000}
            hint="For you. For example: pays in two parts, collects with her mother."
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
          {pending ? 'Saving…' : 'Save the job'}
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
