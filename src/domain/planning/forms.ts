import { isIsoDate, type IsoDate } from '../dates';
import { isTimeOfDay } from '../calendar/time';
import type { TaskKind } from '../engine/types';
import { chars, parseWholeNumber, text, ticked, type FieldErrors, type Result } from '../form-input';
import { isPrerequisiteKind, type PrerequisiteKind } from '../orders/prerequisites';
import { isTaskKind } from './words';

/**
 * The forms of the library and of an order's tasks. The database holds the same limits
 * (supabase/migrations/2026102709*); these give the plain messages (decision 0007).
 */

export const MAX_TASK_MINUTES = 6000; // 100 hours
export const MAX_WAIT_DAYS = 60;
export const MAX_LAG_DAYS = 30;

const FIRST_DAY = '2000-01-01';
const LAST_DAY = '2099-12-31';

/**
 * Hours and minutes from two fields (decision 0036). Either may be empty, not both. Writes its problem
 * under `<prefix>-hours`, where the pair is shown.
 */
export function readEstimate(data: FormData, prefix: string, errors: FieldErrors): number | null {
  const field = `${prefix}-hours`;
  const rawHours = text(data, `${prefix}-hours`);
  const rawMinutes = text(data, `${prefix}-minutes`);
  if (rawHours === '' && rawMinutes === '') {
    errors[field] = 'Say how long it takes.';
    return null;
  }
  const hours = rawHours === '' ? 0 : parseWholeNumber(rawHours);
  const minutes = rawMinutes === '' ? 0 : parseWholeNumber(rawMinutes);
  if (hours === null || minutes === null || minutes > 59) {
    errors[field] = 'Use whole hours, and minutes from 0 to 59.';
    return null;
  }
  const total = hours * 60 + minutes;
  if (total < 1) {
    errors[field] = 'Say how long it takes.';
    return null;
  }
  if (total > MAX_TASK_MINUTES) {
    errors[field] = `Keep one task under ${MAX_TASK_MINUTES / 60} hours. Split a longer one in two.`;
    return null;
  }
  return total;
}

/** The two fields' values for a saved estimate: 90 → { hours: '1', minutes: '30' }. */
export function estimateFields(minutes: number | null): { hours: string; minutes: string } {
  if (minutes === null) return { hours: '', minutes: '' };
  return { hours: String(Math.floor(minutes / 60)), minutes: String(minutes % 60) };
}

function readDay(data: FormData, name: string, errors: FieldErrors): IsoDate | null {
  const raw = text(data, name);
  if (raw === '') return null;
  if (!isIsoDate(raw) || raw < FIRST_DAY || raw > LAST_DAY) {
    errors[name] = 'Choose a day.';
    return null;
  }
  return raw;
}

export interface TaskFields {
  title: string;
  kind: TaskKind;
  /** Work and appointments. */
  minutes: number | null;
  /** Waits. */
  days: number | null;
}

export interface OrderTaskFields extends TaskFields {
  /** An appointment's day and time: both, or neither yet. */
  fixedOn: IsoDate | null;
  fixedTime: string | null;
  notBefore: IsoDate | null;
  /** Work only: the day all of it is put on (docs/change.md). */
  pinnedOn: IsoDate | null;
}

function readTask(data: FormData, errors: FieldErrors): TaskFields {
  const title = text(data, 'title');
  if (chars(title) === 0) errors.title = 'Say what the task is, for example "Cut the fabric".';
  else if (chars(title) > 120) errors.title = 'Keep the name under 120 characters.';

  const rawKind = text(data, 'kind');
  const kind: TaskKind = isTaskKind(rawKind) ? rawKind : 'work';
  if (!isTaskKind(rawKind)) errors.kind = 'Choose what kind of task it is.';

  let minutes: number | null = null;
  let days: number | null = null;
  if (kind === 'work' || kind === 'fixed') minutes = readEstimate(data, 'estimate', errors);
  if (kind === 'wait') {
    const n = parseWholeNumber(text(data, 'days'));
    if (n === null || n < 1 || n > MAX_WAIT_DAYS)
      errors.days = `Enter a whole number of days from 1 to ${MAX_WAIT_DAYS}.`;
    else days = n;
  }
  return { title, kind, minutes, days };
}

/** A task of a template: no days, which belong to an order. */
export function parseTemplateTask(data: FormData): Result<TaskFields> {
  const errors: FieldErrors = {};
  const task = readTask(data, errors);
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: task };
}

/** A task of an order. An appointment may wait for its day; a day needs its time and the other way round. */
export function parseOrderTask(data: FormData): Result<OrderTaskFields> {
  const errors: FieldErrors = {};
  const task = readTask(data, errors);
  let fixedOn: IsoDate | null = null;
  let fixedTime: string | null = null;
  if (task.kind === 'fixed') {
    fixedOn = readDay(data, 'fixed-on', errors);
    const rawTime = text(data, 'fixed-time');
    if (rawTime !== '') {
      if (isTimeOfDay(rawTime)) fixedTime = rawTime;
      else errors['fixed-time'] = 'Choose a time, for example 10:30.';
    }
    if (fixedOn !== null && fixedTime === null && !errors['fixed-time'])
      errors['fixed-time'] = 'Choose the time too, or leave the day empty until it is agreed.';
    if (fixedOn === null && fixedTime !== null && !errors['fixed-on'])
      errors['fixed-on'] = 'Choose the day too, or leave the time empty until it is agreed.';
  }
  const notBefore = readDay(data, 'not-before', errors);
  const pinnedOn = task.kind === 'work' ? readDay(data, 'pinned-on', errors) : null;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { ...task, fixedOn, fixedTime, notBefore, pinnedOn } };
}

/** "Comes after": the task before, and the days of rest between. */
export interface LinkFields {
  from: string;
  lagDays: number;
}

export function parseLink(data: FormData, isKnownTask: (id: string) => boolean): Result<LinkFields> {
  const errors: FieldErrors = {};
  const from = text(data, 'from');
  if (!isKnownTask(from)) errors.from = 'Choose the task it comes after.';
  const raw = text(data, 'lag-days');
  const lag = raw === '' ? 0 : parseWholeNumber(raw);
  if (lag === null || lag > MAX_LAG_DAYS)
    errors['lag-days'] = `Enter a whole number of days from 0 to ${MAX_LAG_DAYS}.`;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { from, lagDays: lag ?? 0 } };
}

export interface TemplateFields {
  name: string;
  garmentType: string;
  notes: string;
}

export function parseTemplate(data: FormData): Result<TemplateFields> {
  const errors: FieldErrors = {};
  const name = text(data, 'name');
  const garmentType = text(data, 'garment-type');
  const notes = text(data, 'notes');
  if (chars(name) === 0) errors.name = 'Give the template a name, for example "Bridal gown, lace".';
  else if (chars(name) > 80) errors.name = 'Keep the name under 80 characters.';
  if (chars(garmentType) === 0)
    errors['garment-type'] = 'Say which garment it is for, for example "Bridal gown".';
  else if (chars(garmentType) > 80) errors['garment-type'] = 'Keep it under 80 characters.';
  if (chars(notes) > 2000) errors.notes = 'Keep the notes under 2000 characters.';
  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, value: { name, garmentType, notes } };
}

export interface TemplateItemFields {
  kind: PrerequisiteKind;
  label: string;
  blocking: boolean;
}

/** Something a garment of this kind waits for. */
export function parseTemplateItem(data: FormData): Result<TemplateItemFields> {
  const errors: FieldErrors = {};
  const kind = text(data, 'kind');
  const label = text(data, 'label');
  if (!isPrerequisiteKind(kind)) errors.kind = 'Choose what kind of item it is.';
  if (chars(label) === 0) errors.label = 'Say what it is, for example "Lace".';
  else if (chars(label) > 120) errors.label = 'Keep the name under 120 characters.';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { kind: kind as PrerequisiteKind, label, blocking: ticked(data, 'blocking') } };
}

/** The items a task waits for, from a list of checkboxes named `needs`. Only ids that exist are kept. */
export function readNeeds(data: FormData, isKnownItem: (id: string) => boolean): string[] {
  return [
    ...new Set(data.getAll('needs').filter((v): v is string => typeof v === 'string' && isKnownItem(v))),
  ];
}
