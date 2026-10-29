import { isIsoDate, type IsoDate } from '../dates';
import { chars, isUuid, parseWholeNumber, text, type FieldErrors, type Result } from '../form-input';
import { clientProblems } from '../clients/forms';
import { canMove, isOrderStatus, type OrderStatus } from './status';

/**
 * What she types to make and change orders. One place for the rules, so each message sits next to its
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

export const MAX_BUFFER_DAYS = 30;
const NOTES_TOO_LONG = 'Keep the notes under 4000 characters.';

/**
 * Reads a number of buffer days. An empty field means "her usual" when a fallback is given, and is an error
 * when not. Used for an order's buffer and for her default.
 */
export function readBuffer(
  data: FormData,
  name: string,
  fallback: number | null,
  errors: FieldErrors,
): number {
  const raw = text(data, name);
  if (raw === '' && fallback !== null) return fallback;
  const n = parseWholeNumber(raw);
  if (n === null || n > MAX_BUFFER_DAYS) {
    errors[name] = `Enter a whole number of days from 0 to ${MAX_BUFFER_DAYS}.`;
    return 0;
  }
  return n;
}

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

export interface NewOrder {
  client: ClientChoice;
  /** Empty means "her next number". */
  number: number | null;
  deliveryOn: IsoDate;
  bufferDays: number;
  notes: string;
  garmentType: string;
  brief: string;
  /** Confirm the order now, or keep it as a draft. */
  confirm: boolean;
}

export const NEW_CLIENT = 'new';

/**
 * Reads the new-order form. The client is one she has (`client` holds its id) or a new one
 * (`client` is "new", with `client-name` and `client-phone`). The button that was pressed
 * (`intent`) says whether to confirm the order or keep it as a draft.
 */
export function parseNewOrder(
  data: FormData,
  context: { today: IsoDate; defaultBufferDays: number },
): Result<NewOrder> {
  const errors: FieldErrors = {};

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

  const deliveryOn = readDay(data, 'delivery-on', errors);
  if (!errors['delivery-on'] && deliveryOn < context.today) errors['delivery-on'] = PAST_DAY;

  const bufferDays = readBuffer(data, 'buffer-days', context.defaultBufferDays, errors);

  const notes = text(data, 'notes');
  if (chars(notes) > 4000) errors.notes = NOTES_TOO_LONG;

  const garment = { garmentType: text(data, 'garment-type'), brief: text(data, 'brief') };
  Object.assign(errors, garmentProblems(garment));

  const intent = text(data, 'intent');
  if (intent !== 'confirm' && intent !== 'draft')
    errors.form = 'Choose whether to confirm the order or keep it as a draft.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { client, number, deliveryOn, bufferDays, notes, ...garment, confirm: intent === 'confirm' },
  };
}

/** An order's notes. The one thing that can still be changed on a delivered or cancelled order. */
export function parseOrderNotes(data: FormData): Result<string> {
  const notes = text(data, 'notes');
  return chars(notes) > 4000 ? { ok: false, errors: { notes: NOTES_TOO_LONG } } : { ok: true, value: notes };
}

export interface OrderDetails {
  clientId: string;
  deliveryOn: IsoDate;
  bufferDays: number;
  notes: string;
}

/**
 * Reads the form that changes an order's promise. For an active order a new handover day cannot be in the
 * past (the database says the same); a draft or paused order may keep an old one until it is confirmed.
 */
export function parseOrderDetails(
  data: FormData,
  current: { status: OrderStatus; deliveryOn: IsoDate; today: IsoDate },
): Result<OrderDetails> {
  const errors: FieldErrors = {};
  const clientId = text(data, 'client');
  if (!isUuid(clientId)) errors.client = 'Choose a client.';

  const deliveryOn = readDay(data, 'delivery-on', errors);
  if (
    !errors['delivery-on'] &&
    current.status === 'active' &&
    deliveryOn !== current.deliveryOn &&
    deliveryOn < current.today
  )
    errors['delivery-on'] = PAST_DAY;

  const bufferDays = readBuffer(data, 'buffer-days', null, errors);

  const notes = text(data, 'notes');
  if (chars(notes) > 4000) errors.notes = NOTES_TOO_LONG;

  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, value: { clientId, deliveryOn, bufferDays, notes } };
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
      errors['delivery-on'] = 'The old handover day has passed. Choose a new one.';
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
