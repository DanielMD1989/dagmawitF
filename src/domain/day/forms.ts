import { isIsoDate, type IsoDate } from '../dates';
import { chars, text, type FieldErrors, type Result } from '../form-input';
import { readEstimate } from '../planning/forms';

/** The forms of My Day. The database holds the same limits (supabase/migrations/20261028090000_my_day.sql). */

export interface DoneFields {
  doneOn: IsoDate;
  /** Required for work and appointments; nothing for a wait or a milestone. */
  actualMinutes: number | null;
}

/** "Done": the day (today unless she says otherwise, never later) and, for her own work, the time it took. */
export function parseDone(data: FormData, today: IsoDate, needsTime: boolean): Result<DoneFields> {
  const errors: FieldErrors = {};
  const raw = text(data, 'done-on');
  let doneOn: IsoDate = today;
  if (raw !== '') {
    if (!isIsoDate(raw) || raw < '2000-01-01') errors['done-on'] = 'Choose a day.';
    else if (raw > today) errors['done-on'] = 'Choose today or an earlier day.';
    else doneOn = raw;
  }
  const actualMinutes = needsTime ? readEstimate(data, 'actual', errors) : null;
  if (needsTime && errors['actual-hours']?.startsWith('Say how long'))
    errors['actual-hours'] = 'Say how long it took, in total.';
  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, value: { doneOn, actualMinutes } };
}

/** "Still going": about how long is left. */
export function parseRemaining(data: FormData): Result<number> {
  const errors: FieldErrors = {};
  const left = readEstimate(data, 'remaining', errors);
  if (left === null) {
    if (errors['remaining-hours']?.startsWith('Say how long'))
      errors['remaining-hours'] = 'Say about how long is left.';
    return { ok: false, errors };
  }
  return { ok: true, value: left };
}

/** A hold needs a reason: it is what she will read when she wonders why the task is not planned. */
export function parseHold(data: FormData): Result<string> {
  const reason = text(data, 'reason');
  if (chars(reason) === 0) return { ok: false, errors: { reason: 'Say why, for example "Client is away".' } };
  if (chars(reason) > 200) return { ok: false, errors: { reason: 'Keep the reason under 200 characters.' } };
  return { ok: true, value: reason };
}

export interface QuickAddFields {
  title: string;
  minutes: number;
  /** An order to add it to, or none for studio work. */
  orderId: string | null;
}

export function parseQuickAdd(data: FormData, isKnownOrder: (id: string) => boolean): Result<QuickAddFields> {
  const errors: FieldErrors = {};
  const title = text(data, 'title');
  if (chars(title) === 0) errors.title = 'Say what it is, for example "Hem a skirt for a walk-in".';
  else if (chars(title) > 120) errors.title = 'Keep it under 120 characters.';
  const minutes = readEstimate(data, 'estimate', errors);
  const order = text(data, 'order-id');
  if (order !== '' && !isKnownOrder(order)) errors['order-id'] = 'Choose an order from the list, or none.';
  if (Object.keys(errors).length > 0 || minutes === null) return { ok: false, errors };
  return { ok: true, value: { title, minutes, orderId: order === '' ? null : order } };
}
