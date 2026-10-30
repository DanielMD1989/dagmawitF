import { isIsoDate, type IsoDate } from '../dates';
import { chars, text, type FieldErrors, type Result } from '../form-input';

/**
 * A step as she types it: a title, a day (or none yet), a last day for a step over several days, and a time if she
 * wants one. The database enforces the same rules (task's checks in 20261101090000_calendar_first.sql).
 */

export interface StepFields {
  title: string;
  onDay: IsoDate | null;
  untilDay: IsoDate | null;
  startsAt: string | null;
  endsAt: string | null;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function day(data: FormData, name: string, errors: FieldErrors): IsoDate | null {
  const raw = text(data, name);
  if (raw === '') return null;
  if (!isIsoDate(raw) || raw < '2000-01-01' || raw > '2099-12-31') {
    errors[name] = 'Choose a day.';
    return null;
  }
  return raw;
}

function time(data: FormData, name: string, errors: FieldErrors): string | null {
  const raw = text(data, name);
  if (raw === '') return null;
  // A browser's time field may send seconds ("09:00:00"); the minute is what she chose.
  const hhmm = raw.length === 8 && raw.endsWith(':00') ? raw.slice(0, 5) : raw;
  if (!TIME.test(hhmm)) {
    errors[name] = 'Use a time such as 09:30.';
    return null;
  }
  return hhmm;
}

/**
 * Reads one step. With a `prefix` it reads one row of several on a form ("step-2-title", "step-2-day", ...), and its
 * messages are keyed the same way, so each sits next to its own field.
 */
export function parseStep(data: FormData, prefix = ''): Result<StepFields> {
  const errors: FieldErrors = {};
  const name = (field: string) => `${prefix}${field}`;
  const title = text(data, name('title'));
  if (chars(title) === 0) errors[name('title')] = 'Say what the step is, for example “Cutting”.';
  else if (chars(title) > 120) errors[name('title')] = 'Keep this under 120 characters.';

  const onDay = day(data, name('day'), errors);
  const untilDay = day(data, name('until'), errors);
  const startsAt = time(data, name('from'), errors);
  const endsAt = time(data, name('to'), errors);

  if (untilDay && !errors[name('day')]) {
    if (!onDay) errors[name('until')] = 'Choose the first day too.';
    else if (untilDay <= onDay)
      errors[name('until')] = 'The last day comes after the first. Leave it empty for one day.';
  }
  if (startsAt && !onDay && !errors[name('day')]) errors[name('from')] = 'Choose a day for the time.';
  if (endsAt && !errors[name('to')]) {
    if (!startsAt) errors[name('to')] = 'Give the start time too.';
    else if (endsAt <= startsAt) errors[name('to')] = 'The end comes after the start.';
  }

  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, value: { title, onDay, untilDay, startsAt, endsAt } };
}

export const MAX_STEPS = 100;

/**
 * Reads the rows of steps on the new-job form: "step-0-…", "step-1-…", in the order they are on the form, for as many
 * rows as `steps` says. Two rows with the same title on the same day are one step typed twice (her Task 6).
 */
export function parseStepRows(data: FormData): Result<StepFields[]> {
  const raw = text(data, 'steps');
  const count = raw === '' ? 0 : Number(raw);
  if (!Number.isInteger(count) || count < 0 || count > MAX_STEPS)
    return { ok: false, errors: { steps: `Use at most ${MAX_STEPS} steps.` } };
  const errors: FieldErrors = {};
  const steps: StepFields[] = [];
  for (let i = 0; i < count; i++) {
    const r = parseStep(data, `step-${i}-`);
    if (!r.ok) Object.assign(errors, r.errors);
    else {
      const twice = steps.findIndex((s) => sameStep(s, r.value));
      if (twice >= 0) errors[`step-${i}-title`] = `“${r.value.title}” is already in the list for that day.`;
      steps.push(r.value);
    }
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: steps };
}

/** The same step: the same title, in any capitals, on the same day (or both with no day yet). */
export function sameStep(
  a: Pick<StepFields, 'title' | 'onDay'>,
  b: Pick<StepFields, 'title' | 'onDay'>,
): boolean {
  return a.title.trim().toLowerCase() === b.title.trim().toLowerCase() && a.onDay === b.onDay;
}
