import { chars, parseWholeNumber, text, ticked, type FieldErrors, type Result } from '../form-input';
import { isJobKind, type JobKind } from '../jobs/kinds';

/**
 * Her templates: a named list of steps for one kind of job, each with how many days before the job's day it starts
 * and how many days it runs (decision 0066). The database holds the same limits.
 */

export interface TemplateFields {
  name: string;
  kind: JobKind;
  notes: string;
}

export function parseTemplate(data: FormData): Result<TemplateFields> {
  const errors: FieldErrors = {};
  const name = text(data, 'name');
  if (chars(name) === 0) errors.name = 'Give it a name, for example “Bridal gown”.';
  else if (chars(name) > 80) errors.name = 'Keep the name under 80 characters.';
  const kind = text(data, 'kind');
  if (!isJobKind(kind)) errors.kind = 'Choose the kind of job it is for.';
  const notes = text(data, 'notes');
  if (chars(notes) > 2000) errors.notes = 'Keep the notes under 2000 characters.';
  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, value: { name, kind: kind as JobKind, notes } };
}

export interface TemplateStepFields {
  title: string;
  daysBefore: number;
  spanDays: number;
  withClient: boolean;
}

export const MAX_DAYS_BEFORE = 365;
export const MAX_SPAN_DAYS = 60;

export function parseTemplateStep(data: FormData): Result<TemplateStepFields> {
  const errors: FieldErrors = {};
  const title = text(data, 'title');
  if (chars(title) === 0) errors.title = 'Say what the step is, for example “Cutting”.';
  else if (chars(title) > 120) errors.title = 'Keep this under 120 characters.';

  const before = parseWholeNumber(text(data, 'days-before'));
  if (before === null || before > MAX_DAYS_BEFORE)
    errors['days-before'] = `Use a whole number of days from 0 (on the day itself) to ${MAX_DAYS_BEFORE}.`;

  const rawSpan = text(data, 'span-days');
  const span = rawSpan === '' ? 1 : parseWholeNumber(rawSpan);
  if (span === null || span < 1 || span > MAX_SPAN_DAYS)
    errors['span-days'] = `Use a whole number of days from 1 to ${MAX_SPAN_DAYS}.`;

  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : {
        ok: true,
        value: { title, daysBefore: before!, spanDays: span!, withClient: ticked(data, 'with-client') },
      };
}

/** "28 days before", "the day before", "on the day"; and "for 7 days". */
export function whenLabel(daysBefore: number, spanDays: number): string {
  const when =
    daysBefore === 0 ? 'On the day' : daysBefore === 1 ? 'The day before' : `${daysBefore} days before`;
  return spanDays > 1 ? `${when}, for ${spanDays} days` : when;
}
