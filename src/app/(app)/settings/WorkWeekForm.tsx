'use client';

import { useActionState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { fieldTicked, fieldValue, idle } from '@/lib/action-state';
import { WEEKDAY_NAMES } from '@/domain/dates';
import type { WorkDay } from '@/domain/calendar/types';
import { saveWorkWeek } from './actions';

// What a day looks like the moment she ticks it.
const DEFAULT_DAY = { start: '08:30', end: '17:00', breakStart: '12:30', breakEnd: '13:30' };

export function WorkWeekForm({ week }: { week: WorkDay[] }) {
  const [state, action] = useActionState(saveWorkWeek, idle);

  return (
    <form action={action} className="form" noValidate>
      <div className="week">
        {WEEKDAY_NAMES.map((name, index) => {
          const weekday = index + 1;
          const saved = week.find((d) => d.weekday === weekday);
          // The screen edits one break per day; the database can hold more (see docs/architecture.md).
          const firstBreak = saved?.breaks[0];
          const dayError = state.errors[`day-${weekday}`];
          const breakError = state.errors[`break-${weekday}`];
          return (
            <fieldset key={weekday} className="week__day">
              <legend className="sr-only">{name}</legend>
              <label className="week__works-label">
                <input
                  type="checkbox"
                  name={`works-${weekday}`}
                  className="week__works"
                  defaultChecked={fieldTicked(state, `works-${weekday}`, Boolean(saved))}
                />
                {name}
              </label>
              <p className="week__off">Not working</p>
              <div className="week__times">
                <div className="field">
                  <label htmlFor={`start-${weekday}`}>Starts</label>
                  <input
                    id={`start-${weekday}`}
                    name={`start-${weekday}`}
                    type="time"
                    className="input"
                    defaultValue={fieldValue(state, `start-${weekday}`, saved?.start ?? DEFAULT_DAY.start)}
                    aria-invalid={Boolean(dayError)}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`end-${weekday}`}>Ends</label>
                  <input
                    id={`end-${weekday}`}
                    name={`end-${weekday}`}
                    type="time"
                    className="input"
                    defaultValue={fieldValue(state, `end-${weekday}`, saved?.end ?? DEFAULT_DAY.end)}
                    aria-invalid={Boolean(dayError)}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`break-start-${weekday}`}>Break from</label>
                  <input
                    id={`break-start-${weekday}`}
                    name={`break-start-${weekday}`}
                    type="time"
                    className="input"
                    defaultValue={fieldValue(
                      state,
                      `break-start-${weekday}`,
                      saved ? (firstBreak?.start ?? '') : DEFAULT_DAY.breakStart,
                    )}
                    aria-invalid={Boolean(breakError)}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`break-end-${weekday}`}>Break until</label>
                  <input
                    id={`break-end-${weekday}`}
                    name={`break-end-${weekday}`}
                    type="time"
                    className="input"
                    defaultValue={fieldValue(
                      state,
                      `break-end-${weekday}`,
                      saved ? (firstBreak?.end ?? '') : DEFAULT_DAY.breakEnd,
                    )}
                    aria-invalid={Boolean(breakError)}
                  />
                </div>
                {(dayError || breakError) && (
                  <p className="error field--wide" role="alert">
                    {dayError ?? breakError}
                  </p>
                )}
              </div>
            </fieldset>
          );
        })}
      </div>
      <FormNotice state={state} />
      <div className="btn-row">
        <SubmitButton>Save working week</SubmitButton>
      </div>
    </form>
  );
}
