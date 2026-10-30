import { isIsoDate, type IsoDate } from '../dates';
import { chars, isUuid, parseWholeNumber, text, ticked, type FieldErrors, type Result } from '../form-input';
import { clientProblems } from '../clients/forms';
import { parseStepRows, type StepFields } from '../steps/forms';
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

export type ClientChoice =
  | { kind: 'existing'; id: string }
  | { kind: 'new'; name: string; phone: string }
  /** No client: an event, such as a bazaar (decision 0068). */
  | { kind: 'none' };

export interface NewJob {
  client: ClientChoice;
  /** Empty means "her next number". */
  number: number | null;
  /** What it is, in her words: "Bridal gown", "Bazaar at the Hyatt". */
  title: string;
  dueOn: IsoDate;
  notes: string;
  /** What the client asked for; for a client's job with a title. */
  brief: string;
  /** The steps she picked, each with the day she gave it. */
  steps: StepFields[];
}

export const NEW_CLIENT = 'new';
/** The choice of no client: an event. */
export const NO_CLIENT = 'none';

const TITLE_TOO_LONG = 'Keep this under 120 characters.';

/**
 * Reads the new-job form: who it is for (a client she has, a new one, or nobody: an event), what it is, its day, and
 * the steps she built with their days. An event needs a name; a client's job may go without.
 */
export function parseNewJob(data: FormData, context: { today: IsoDate }): Result<NewJob> {
  const errors: FieldErrors = {};

  const chosen = text(data, 'client');
  let client: ClientChoice = { kind: 'none' };
  if (chosen === NEW_CLIENT) {
    const fields = { name: text(data, 'client-name'), phone: text(data, 'client-phone'), notes: '' };
    const problems = clientProblems(fields);
    if (problems.name) errors['client-name'] = problems.name;
    if (problems.phone) errors['client-phone'] = problems.phone;
    client = { kind: 'new', name: fields.name, phone: fields.phone };
  } else if (isUuid(chosen)) {
    client = { kind: 'existing', id: chosen };
  } else if (chosen !== NO_CLIENT) {
    errors.client = 'Choose a client, add a new one, or choose an event.';
  }

  const title = text(data, 'title');
  if (chars(title) > 120) errors.title = TITLE_TOO_LONG;
  else if (client.kind === 'none' && chosen === NO_CLIENT && title === '')
    errors.title = 'Give the event a name, for example “Bazaar at the Hyatt”.';

  let number: number | null = null;
  const rawNumber = text(data, 'number');
  if (rawNumber !== '') {
    number = parseWholeNumber(rawNumber);
    if (number === null || number < 1 || number > 999_999)
      errors.number = 'Use a whole number from 1 up, or leave it empty for the next number.';
  }

  const dueOn = readDay(data, 'due-on', errors);
  if (!errors['due-on'] && dueOn < context.today) errors['due-on'] = PAST_DAY;

  const notes = text(data, 'notes');
  if (chars(notes) > 4000) errors.notes = NOTES_TOO_LONG;
  const brief = client.kind === 'none' ? '' : text(data, 'brief');
  if (chars(brief) > 4000) errors.brief = 'Keep the brief under 4000 characters.';

  const steps = parseStepRows(data);
  if (!steps.ok) Object.assign(errors, steps.errors);

  if (Object.keys(errors).length > 0 || !steps.ok) return { ok: false, errors };
  return { ok: true, value: { client, number, title, dueOn, notes, brief, steps: steps.value } };
}

/** An order's notes. The one thing that can still be changed on a delivered or cancelled order. */
export function parseOrderNotes(data: FormData): Result<string> {
  const notes = text(data, 'notes');
  return chars(notes) > 4000 ? { ok: false, errors: { notes: NOTES_TOO_LONG } } : { ok: true, value: notes };
}

export interface OrderDetails {
  /** Null for an event. */
  clientId: string | null;
  title: string;
  dueOn: IsoDate;
  /** Move the steps not done yet by as many days as the due day moved. */
  moveSteps: boolean;
  notes: string;
}

/**
 * Reads the form that changes a job. For an active job a new day cannot be in the past (the database says the same);
 * a draft or paused one may keep an old one until it is confirmed. An event (no client) needs a name.
 */
export function parseOrderDetails(
  data: FormData,
  current: { status: OrderStatus; dueOn: IsoDate; today: IsoDate },
): Result<OrderDetails> {
  const errors: FieldErrors = {};
  const chosen = text(data, 'client');
  const clientId = chosen === NO_CLIENT ? null : chosen;
  if (clientId !== null && !isUuid(clientId)) errors.client = 'Choose a client, or none for an event.';

  const title = text(data, 'title');
  if (chars(title) > 120) errors.title = TITLE_TOO_LONG;
  else if (clientId === null && title === '') errors.title = 'Give the event a name.';

  const dueOn = readDay(data, 'due-on', errors);
  if (!errors['due-on'] && current.status === 'active' && dueOn !== current.dueOn && dueOn < current.today)
    errors['due-on'] = PAST_DAY;

  const notes = text(data, 'notes');
  if (chars(notes) > 4000) errors.notes = NOTES_TOO_LONG;

  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, value: { clientId, title, dueOn, moveSteps: ticked(data, 'move-steps'), notes } };
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
