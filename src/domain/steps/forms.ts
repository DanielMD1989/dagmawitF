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

export function parseStep(data: FormData): Result<StepFields> {
  const errors: FieldErrors = {};
  const title = text(data, 'title');
  if (chars(title) === 0) errors.title = 'Say what the step is, for example “Cutting”.';
  else if (chars(title) > 120) errors.title = 'Keep this under 120 characters.';

  const onDay = day(data, 'day', errors);
  const untilDay = day(data, 'until', errors);
  const startsAt = time(data, 'from', errors);
  const endsAt = time(data, 'to', errors);

  if (untilDay && !errors.day) {
    if (!onDay) errors.until = 'Choose the first day too.';
    else if (untilDay <= onDay)
      errors.until = 'The last day comes after the first. Leave it empty for one day.';
  }
  if (startsAt && !onDay && !errors.day) errors.from = 'Choose a day for the time.';
  if (endsAt && !errors.to) {
    if (!startsAt) errors.to = 'Give the start time too.';
    else if (endsAt <= startsAt) errors.to = 'The end comes after the start.';
  }

  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, value: { title, onDay, untilDay, startsAt, endsAt } };
}
