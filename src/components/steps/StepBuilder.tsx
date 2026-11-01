'use client';

import { useRef, useState } from 'react';
import type { FieldErrors } from '@/lib/action-state';

/** A step as she builds it: what, which day, and a time if it has one (decision 0079). */
interface Row {
  key: number;
  title: string;
  day: string;
  from: string;
}
type RowField = Exclude<keyof Row, 'key'>;

const blank = (key: number, title = ''): Row => ({ key, title, day: '', from: '' });

/**
 * Steps built by tapping her usual ones, each given its day and, if it has one, its time (decisions 0068, 0079,
 * 0084). The same on a new job and on a job's page, where the details are often filled in after a job taken in a
 * hurry. Its fields are read by `parseStepRows`: `steps` (how many), then `step-0-title`, `step-0-day`, … ; a message
 * keyed the same way shows beside its field.
 */
export function StepBuilder({
  usual,
  today,
  errors,
  emptyHint = 'No steps yet. Tap one above.',
}: {
  /** Her usual steps, offered as buttons; "Delivery" is the job's own day and is left out. */
  usual: readonly string[];
  today: string;
  errors: FieldErrors;
  emptyHint?: string;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const next = useRef(0);
  const add = (...titles: string[]) => setRows((r) => [...r, ...titles.map((t) => blank(next.current++, t))]);
  const change = (key: number, field: RowField, value: string) =>
    setRows((r) => r.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
  const remove = (key: number) => setRows((r) => r.filter((row) => row.key !== key));
  const err = (i: number, field: string) => errors[`step-${i}-${field}`];
  const offered = usual.filter((t) => t.trim().toLowerCase() !== 'delivery');

  return (
    <>
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
        <p className="day-list__empty">{emptyHint}</p>
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
    </>
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
