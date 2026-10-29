import { isIsoDate, type IsoDate } from '../dates';
import { chars, text, ticked, type FieldErrors, type Result } from '../form-input';

/**
 * What an order is waiting for. The engine reads `state`, `expectedOn` and `blocking` in Stage 3; the words
 * on screen depend on the kind, so a fabric is Ordered and Received while an approval is Asked and Approved.
 */

export const PREREQUISITE_KINDS = ['material', 'approval', 'measurements', 'other'] as const;
export type PrerequisiteKind = (typeof PREREQUISITE_KINDS)[number];

export const PREREQUISITE_STATES = ['needed', 'ordered', 'received'] as const;
export type PrerequisiteState = (typeof PREREQUISITE_STATES)[number];

export function isPrerequisiteKind(value: unknown): value is PrerequisiteKind {
  return typeof value === 'string' && (PREREQUISITE_KINDS as readonly string[]).includes(value);
}
export function isPrerequisiteState(value: unknown): value is PrerequisiteState {
  return typeof value === 'string' && (PREREQUISITE_STATES as readonly string[]).includes(value);
}

export interface Prerequisite {
  id: string;
  kind: PrerequisiteKind;
  label: string;
  state: PrerequisiteState;
  expectedOn: IsoDate | null;
  blocking: boolean;
  note: string;
}

export type PrerequisiteFields = Omit<Prerequisite, 'id'>;

export const KIND_HEADING: Readonly<Record<PrerequisiteKind, string>> = {
  approval: 'Approvals and confirmations',
  measurements: 'Measurements',
  material: 'Materials',
  other: 'Other',
};

/** One item's kind, for choosing it from a list. */
export const KIND_LABEL: Readonly<Record<PrerequisiteKind, string>> = {
  material: 'Material (fabric, lace, trims)',
  approval: 'Approval or confirmation',
  measurements: 'Measurements',
  other: 'Something else',
};

/** The order the groups are shown in: what has to be agreed first, then what has to arrive. */
export const KIND_ORDER: readonly PrerequisiteKind[] = ['approval', 'measurements', 'material', 'other'];

const STATE_WORDS: Readonly<Record<PrerequisiteKind, Readonly<Record<PrerequisiteState, string>>>> = {
  material: { needed: 'Needed', ordered: 'Ordered', received: 'Received' },
  approval: { needed: 'Needed', ordered: 'Asked', received: 'Approved' },
  measurements: { needed: 'Needed', ordered: 'Booked', received: 'Taken' },
  other: { needed: 'Needed', ordered: 'In progress', received: 'Done' },
};

export function stateLabel(kind: PrerequisiteKind, state: PrerequisiteState): string {
  return STATE_WORDS[kind][state];
}

/** What the date means for this kind of item. */
export function dateLabel(kind: PrerequisiteKind): string {
  switch (kind) {
    case 'material':
      return 'Expected to arrive';
    case 'approval':
      return 'Answer expected';
    case 'measurements':
      return 'Booked for';
    case 'other':
      return 'Expected';
  }
}

/** One-tap additions: the things almost every order waits for. Each is added as Needed. */
export const SUGGESTIONS: readonly { label: string; kind: PrerequisiteKind; blocking: boolean }[] = [
  { label: 'Measurements taken', kind: 'measurements', blocking: true },
  { label: 'Design approved by client', kind: 'approval', blocking: true },
  { label: 'Main fabric', kind: 'material', blocking: true },
  { label: 'Lining', kind: 'material', blocking: true },
  { label: 'Lace', kind: 'material', blocking: true },
  { label: 'Zip, buttons and trims', kind: 'material', blocking: true },
  { label: 'Fitting day agreed with client', kind: 'approval', blocking: true },
  { label: 'Quality checklist', kind: 'other', blocking: false },
];

/** What is wrong with an item, by field. Takes tidied input. The database holds the same limits. */
export function prerequisiteProblems(p: PrerequisiteFields): FieldErrors {
  const errors: FieldErrors = {};
  if (chars(p.label) === 0) errors.label = 'Say what it is, for example "Main fabric".';
  else if (chars(p.label) > 120) errors.label = 'Keep the name under 120 characters.';
  if (chars(p.note) > 300) errors.note = 'Keep the note under 300 characters.';
  if (p.expectedOn !== null && (p.expectedOn < '2000-01-01' || p.expectedOn > '2099-12-31'))
    errors['expected-on'] = 'Choose a day between the years 2000 and 2099.';
  return errors;
}

/**
 * Reads the form for one item. The date is optional. A date that has passed is allowed: it is what an
 * item that is late looks like, and the order page flags it.
 */
export function parsePrerequisite(data: FormData): Result<PrerequisiteFields> {
  const kind = text(data, 'kind');
  const state = text(data, 'state') || 'needed';
  const errors: FieldErrors = {};
  if (!isPrerequisiteKind(kind)) errors.kind = 'Choose what kind of item it is.';
  if (!isPrerequisiteState(state)) errors.state = 'Choose where it stands.';

  const expectedRaw = text(data, 'expected-on');
  let expectedOn: IsoDate | null = null;
  if (expectedRaw !== '') {
    if (!isIsoDate(expectedRaw)) errors['expected-on'] = 'Choose a day.';
    else expectedOn = expectedRaw;
  }

  const fields = {
    kind: kind as PrerequisiteKind,
    label: text(data, 'label'),
    state: state as PrerequisiteState,
    expectedOn,
    blocking: ticked(data, 'blocking'),
    note: text(data, 'note'),
  };
  for (const [field, message] of Object.entries(prerequisiteProblems(fields))) errors[field] ??= message;
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: fields };
}

export interface Readiness {
  total: number;
  /** Received. */
  ready: number;
  /** Not received, and holds work back. */
  blockingOpen: number;
  /** Not received, and only a reminder. */
  remindersOpen: number;
  /** Blocking and not received, with no expected date: the engine cannot plan the work behind it. */
  undated: number;
  /** Blocking and not received, expected on a day that has passed. */
  overdue: number;
}

export function readiness(items: readonly Prerequisite[], today: IsoDate): Readiness {
  const open = items.filter((i) => i.state !== 'received');
  const blocking = open.filter((i) => i.blocking);
  return {
    total: items.length,
    ready: items.length - open.length,
    blockingOpen: blocking.length,
    remindersOpen: open.length - blocking.length,
    undated: blocking.filter((i) => i.expectedOn === null).length,
    overdue: blocking.filter((i) => i.expectedOn !== null && i.expectedOn < today).length,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "2 blocking items still open. 1 reminder." (or what it takes for the order to be ready). */
export function describeReadiness(r: Readiness): string {
  if (r.total === 0) return 'Nothing is listed yet. Add what this order is waiting for.';
  if (r.blockingOpen === 0 && r.remindersOpen === 0) return 'Everything is in.';
  const parts: string[] = [];
  if (r.blockingOpen > 0)
    parts.push(`${plural(r.blockingOpen, 'blocking item', 'blocking items')} still open.`);
  if (r.remindersOpen > 0) parts.push(`${plural(r.remindersOpen, 'reminder', 'reminders')}.`);
  return parts.join(' ');
}

/** "4 of 7 ready", or what to say when nothing is listed. */
export function readyCount(r: Readiness): string {
  return r.total === 0 ? 'Nothing listed yet' : `${r.ready} of ${r.total} ready`;
}

/** What needs her attention first: blocking items nobody has a date for, and dates that have passed. */
export function readinessWarnings(r: Readiness): string[] {
  const warnings: string[] = [];
  if (r.undated > 0)
    warnings.push(`${plural(r.undated, 'blocking item has', 'blocking items have')} no expected date`);
  if (r.overdue > 0) warnings.push(`${plural(r.overdue, 'blocking item is', 'blocking items are')} late`);
  return warnings;
}
