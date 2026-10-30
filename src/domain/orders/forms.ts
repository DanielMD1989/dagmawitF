import { isIsoDate, type IsoDate } from '../dates';
import { chars, isUuid, parseWholeNumber, text, ticked, type FieldErrors, type Result } from '../form-input';
import { clientProblems } from '../clients/forms';
import { KIND_WORDS, isJobKind, type JobKind } from '../jobs/kinds';
import { canMove, isOrderStatus, type OrderStatus } from './status';

/**
 * What she types to make and change jobs (the table is still called orders). One place for the rules, so each message sits next to its
 * field. The database enforces the same limits (and test/fixtures/capture-cases.ts runs against both).
 */

export interface GarmentFields {
  garmentType: string;
  brief: string;
}

export function garmentProblems(g: GarmentFields): FieldErrors {
  const errors: FieldErrors = {};
  if (chars(g.garmentType) === 0)
    errors['garment-type'] = 'Say what is being made, for example "Bridal gown".';
  else if (chars(g.garmentType) > 80) errors['garment-type'] = 'Keep this under 80 characters.';
  if (chars(g.brief) > 4000) errors.brief = 'Keep the brief under 4000 characters.';
  return errors;
}

export function parseGarment(data: FormData): Result<GarmentFields> {
  const fields = { garmentType: text(data, 'garment-type'), brief: text(data, 'brief') };
  const errors = garmentProblems(fields);
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: fields };
}

const NOTES_TOO_LONG = 'Keep the notes under 4000 characters.';

function readDay(data: FormData, name: string, errors: FieldErrors): IsoDate {
  const raw = text(data, name);
  if (!isIsoDate(raw) || raw < '2000-01-01' || raw > '2099-12-31') {
    errors[name] = 'Choose a day.';
    return '';
  }
  return raw;
}

const PAST_DAY = 'That day has already passed. Choose today or a later day.';

export type ClientChoice = { kind: 'existing'; id: string } | { kind: 'new'; name: string; phone: string };

export interface NewJob {
  kind: JobKind;
  client: ClientChoice;
  /** Empty means "her next number". */
  number: number | null;
  dueOn: IsoDate;
  /** A time on the due day, for an appointment or a delivery, and when it ends. */
  time: string | null;
  timeEnd: string | null;
  notes: string;
  /** Null when the job has no garment (an appointment, a sketch). */
  garment: GarmentFields | null;
  /** The template whose steps it starts with, or null for none. */
  templateId: string | null;
}

export const NEW_CLIENT = 'new';
export const NO_TEMPLATE = 'none';

/**
 * Reads the new-job form. The kind decides which fields matter: a new order and a fix ask what is being made; an
 * appointment and a delivery may have a time. The client is one she has (`client` holds its id) or a new one
 * (`client` is "new", with `client-name` and `client-phone`).
 */
export function parseNewJob(data: FormData, context: { today: IsoDate }): Result<NewJob> {
  const errors: FieldErrors = {};

  const kind = text(data, 'kind');
  if (!isJobKind(kind)) return { ok: false, errors: { kind: 'Choose what kind of job it is.' } };
  const words = KIND_WORDS[kind];

  const chosen = text(data, 'client');
  let client: ClientChoice = { kind: 'existing', id: '' };
  if (chosen === NEW_CLIENT) {
    const fields = { name: text(data, 'client-name'), phone: text(data, 'client-phone'), notes: '' };
    const problems = clientProblems(fields);
    if (problems.name) errors['client-name'] = problems.name;
    if (problems.phone) errors['client-phone'] = problems.phone;
    client = { kind: 'new', name: fields.name, phone: fields.phone };
  } else if (isUuid(chosen)) {
    client = { kind: 'existing', id: chosen };
  } else {
    errors.client = 'Choose a client, or add a new one.';
  }

  let number: number | null = null;
  const rawNumber = text(data, 'number');
  if (rawNumber !== '') {
    number = parseWholeNumber(rawNumber);
    if (number === null || number < 1 || number > 999_999)
      errors.number = 'Use a whole number from 1 up, or leave it empty for the next number.';
  }

  const dueOn = readDay(data, 'due-on', errors);
  if (!errors['due-on'] && dueOn < context.today) errors['due-on'] = PAST_DAY;

  const readTime = (name: string): string | null => {
    const raw = text(data, name);
    if (!words.atTime || raw === '') return null;
    const hhmm = raw.length === 8 && raw.endsWith(':00') ? raw.slice(0, 5) : raw;
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) return hhmm;
    errors[name] = 'Use a time such as 10:30.';
    return null;
  };
  const time = readTime('time');
  const timeEnd = readTime('time-to');
  if (timeEnd && !errors.time) {
    if (!time) errors['time-to'] = 'Give the start time too.';
    else if (timeEnd <= time) errors['time-to'] = 'The end comes after the start.';
  }

  const notes = text(data, 'notes');
  if (chars(notes) > 4000) errors.notes = NOTES_TOO_LONG;

  const typed = { garmentType: text(data, 'garment-type'), brief: text(data, 'brief') };
  let garment: GarmentFields | null = null;
  if (words.garment || typed.garmentType !== '') {
    Object.assign(errors, garmentProblems(typed));
    garment = typed;
  } else if (chars(typed.brief) > 4000) errors.brief = 'Keep the brief under 4000 characters.';

  const rawTemplate = text(data, 'template');
  let templateId: string | null = null;
  if (rawTemplate !== '' && rawTemplate !== NO_TEMPLATE) {
    if (isUuid(rawTemplate)) templateId = rawTemplate;
    else errors.template = 'Choose the steps it starts with.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { kind, client, number, dueOn, time, timeEnd, notes, garment, templateId } };
}

/** An order's notes. The one thing that can still be changed on a delivered or cancelled order. */
export function parseOrderNotes(data: FormData): Result<string> {
  const notes = text(data, 'notes');
  return chars(notes) > 4000 ? { ok: false, errors: { notes: NOTES_TOO_LONG } } : { ok: true, value: notes };
}

export interface OrderDetails {
  clientId: string;
  kind: JobKind;
  dueOn: IsoDate;
  /** Move the steps not done yet by as many days as the due day moved. */
  moveSteps: boolean;
  notes: string;
}

/**
 * Reads the form that changes a job. For an active job a new due day cannot be in the past (the database says the
 * same); a draft or paused one may keep an old one until it is confirmed.
 */
export function parseOrderDetails(
  data: FormData,
  current: { status: OrderStatus; dueOn: IsoDate; today: IsoDate },
): Result<OrderDetails> {
  const errors: FieldErrors = {};
  const clientId = text(data, 'client');
  if (!isUuid(clientId)) errors.client = 'Choose a client.';

  const kind = text(data, 'kind');
  if (!isJobKind(kind)) errors.kind = 'Choose what kind of job it is.';

  const dueOn = readDay(data, 'due-on', errors);
  if (!errors['due-on'] && current.status === 'active' && dueOn !== current.dueOn && dueOn < current.today)
    errors['due-on'] = PAST_DAY;

  const notes = text(data, 'notes');
  if (chars(notes) > 4000) errors.notes = NOTES_TOO_LONG;

  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : {
        ok: true,
        value: { clientId, kind: kind as JobKind, dueOn, moveSteps: ticked(data, 'move-steps'), notes },
      };
}

/** The changes to make for one move between statuses. Only the fields the move needs are present. */
export interface Transition {
  to: OrderStatus;
  deliveryOn?: IsoDate;
  holdReason?: string;
  cancelReason?: string;
  deliveredOn?: IsoDate;
}

/**
 * Reads the form for moving an order from `from` to the status named in `to`. Becoming active needs a
 * handover day that has not passed (she is asked for a new one only if it has); on hold needs a reason;
 * delivered needs the day it happened (today if she does not say).
 */
export function parseTransition(
  data: FormData,
  from: OrderStatus,
  context: { today: IsoDate; deliveryOn: IsoDate },
): Result<Transition> {
  const to = text(data, 'to');
  if (!isOrderStatus(to) || !canMove(from, to))
    return { ok: false, errors: { form: 'That change is not possible for this order.' } };

  const errors: FieldErrors = {};
  const change: Transition = { to };

  if (to === 'active') {
    const given = text(data, 'delivery-on');
    if (given !== '') {
      change.deliveryOn = readDay(data, 'delivery-on', errors);
      if (!errors['delivery-on'] && change.deliveryOn < context.today) errors['delivery-on'] = PAST_DAY;
    } else if (context.deliveryOn < context.today) {
      errors['delivery-on'] = 'The old day has passed. Choose a new one.';
    }
  }

  if (to === 'on_hold') {
    const reason = text(data, 'reason');
    if (chars(reason) === 0) errors.reason = 'Say why, for example "Client is abroad until December".';
    else if (chars(reason) > 300) errors.reason = 'Keep the reason under 300 characters.';
    change.holdReason = reason;
  }

  if (to === 'cancelled') {
    const reason = text(data, 'reason');
    if (chars(reason) > 300) errors.reason = 'Keep the reason under 300 characters.';
    change.cancelReason = reason;
  }

  if (to === 'delivered') {
    const given = text(data, 'delivered-on');
    if (given === '') change.deliveredOn = context.today;
    else {
      change.deliveredOn = readDay(data, 'delivered-on', errors);
      if (!errors['delivered-on'] && change.deliveredOn > context.today)
        errors['delivered-on'] = 'An order cannot be delivered on a day that has not come yet.';
    }
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: change };
}
