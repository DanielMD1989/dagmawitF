/**
 * The kinds of job she takes (docs/calendar-first.md). The database holds the same list (orders.kind and
 * template.kind); src/domain/jobs/kinds.test.ts compares them with the migration.
 */

export const JOB_KINDS = ['new_order', 'fix', 'appointment', 'sketch', 'delivery'] as const;
export type JobKind = (typeof JOB_KINDS)[number];

interface KindWords {
  /** As a button or a heading: "New order". */
  label: string;
  /** Plural, for a list. */
  plural: string;
  /** What its day is called on the form and on the job. */
  dueLabel: string;
  /** A sentence under the day field. */
  dueHint: string;
  /** Whether a garment usually goes with it, so the form asks for one. */
  garment: boolean;
  /** Whether its day is a meeting at a time, so the form asks for the time. */
  atTime: boolean;
}

export const KIND_WORDS: Record<JobKind, KindWords> = {
  new_order: {
    label: 'New order',
    plural: 'New orders',
    dueLabel: 'Delivery day',
    dueHint: 'The day the client collects it. The steps are suggested counting back from it.',
    garment: true,
    atTime: false,
  },
  fix: {
    label: 'Fix',
    plural: 'Fixes',
    dueLabel: 'Ready on',
    dueHint: 'The day the client collects it.',
    garment: true,
    atTime: false,
  },
  appointment: {
    label: 'Appointment',
    plural: 'Appointments',
    dueLabel: 'Day',
    dueHint: 'The day of the appointment.',
    garment: false,
    atTime: true,
  },
  sketch: {
    label: 'Sketch',
    plural: 'Sketches',
    dueLabel: 'Show the client on',
    dueHint: 'The day you show the design to the client.',
    garment: false,
    atTime: false,
  },
  delivery: {
    label: 'Delivery',
    plural: 'Deliveries',
    dueLabel: 'Delivery day',
    dueHint: 'Something already made, handed over on this day.',
    garment: true,
    atTime: true,
  },
};

export function isJobKind(value: unknown): value is JobKind {
  return typeof value === 'string' && (JOB_KINDS as readonly string[]).includes(value);
}
