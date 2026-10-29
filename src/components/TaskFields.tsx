'use client';

import { useState } from 'react';
import { HoursMinutes } from '@/components/HoursMinutes';
import { SelectField, TextField } from '@/components/fields';
import { fieldValue, type ActionState } from '@/lib/action-state';
import type { TaskKind } from '@/domain/engine/types';
import { estimateFields } from '@/domain/planning/forms';
import { KIND_CHOICE, TASK_KINDS, isTaskKind } from '@/domain/planning/words';

export interface TaskValues {
  title: string;
  kind: TaskKind;
  minutes: number | null;
  days: number | null;
  /** An order's task only. */
  fixedOn?: string | null;
  fixedTime?: string | null;
  notBefore?: string | null;
  pinnedOn?: string | null;
}

/**
 * The fields of one task, for a template (no days: they belong to an order) or for an order. Only the fields its
 * kind uses are shown, and only those are sent. The form around it is the caller's.
 */
export function TaskFields({
  state,
  idPrefix,
  saved,
  scope,
}: {
  state: ActionState;
  /** Unique on the page, for ids. */
  idPrefix: string;
  saved: TaskValues | null;
  scope: 'template' | 'order';
}) {
  const startKind = fieldValue(state, 'kind', saved?.kind ?? 'work');
  const [kind, setKind] = useState<TaskKind>(isTaskKind(startKind) ? startKind : 'work');
  const estimate = estimateFields(saved?.minutes ?? null);
  const id = (name: string) => `${idPrefix}-${name}`;
  // A hint that is shown under the pair of estimate fields, and its error, sit on the hours field.
  const estimateError = state.errors['estimate-hours'];

  return (
    <>
      <TextField
        name="title"
        id={id('title')}
        label="Task"
        state={state}
        saved={saved?.title ?? ''}
        maxLength={120}
        autoComplete="off"
        required
      />
      <SelectField
        name="kind"
        id={id('kind')}
        label="What kind of task"
        state={state}
        saved={kind}
        options={TASK_KINDS.map((k) => ({ value: k, label: KIND_CHOICE[k] }))}
        onChange={(v) => {
          if (isTaskKind(v)) setKind(v);
        }}
      />
      {(kind === 'work' || kind === 'fixed') && (
        <HoursMinutes
          prefix="estimate"
          id={idPrefix}
          legend="How long it takes"
          error={estimateError}
          hours={fieldValue(state, 'estimate-hours', estimate.hours)}
          minutes={fieldValue(state, 'estimate-minutes', estimate.minutes)}
        />
      )}
      {kind === 'wait' && (
        <TextField
          name="days"
          id={id('days')}
          label="How many days"
          type="number"
          inputMode="numeric"
          min={1}
          max={60}
          state={state}
          saved={saved?.days === null || saved?.days === undefined ? '' : String(saved.days)}
          hint="Days that pass with none of her time: fabric drying, a garment resting."
        />
      )}
      {scope === 'order' && kind === 'fixed' && (
        <div className="form-grid form-grid--2">
          <TextField
            name="fixed-on"
            id={id('fixed-on')}
            label="Day"
            type="date"
            state={state}
            saved={saved?.fixedOn ?? ''}
            hint="Leave empty until it is agreed with the client."
          />
          <TextField
            name="fixed-time"
            id={id('fixed-time')}
            label="Time"
            type="time"
            state={state}
            saved={saved?.fixedTime ?? ''}
          />
        </div>
      )}
      {scope === 'order' && kind !== 'fixed' && kind !== 'milestone' && (
        <TextField
          name="not-before"
          id={id('not-before')}
          label="Not before (optional)"
          type="date"
          state={state}
          saved={saved?.notBefore ?? ''}
          hint="The earliest day it can start, if something else decides it."
        />
      )}
      {scope === 'order' && kind === 'work' && (
        <TextField
          name="pinned-on"
          id={id('pinned-on')}
          label="Pin to a day (optional)"
          type="date"
          state={state}
          saved={saved?.pinnedOn ?? ''}
          hint="All of it is planned on this day, and the rest is planned around it."
        />
      )}
    </>
  );
}
