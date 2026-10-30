import { formatDay, todayIn, type IsoDate } from '../dates';
import type { Agenda, Entry, Step } from './agenda';
import { jobHeadline } from '../jobs/words';
import { dayHeading, partLabel, timeLabel } from './words';

/**
 * Today without signal (docs/harden.md, decision 0066): the calendar as she last saw it with signal, kept on the
 * phone, and the ticks that wait to be sent. Pure: the browser keeps the values, this says what they mean.
 */

export const SNAPSHOT_VERSION = 3;

export interface SnapshotEntry {
  id: string;
  /** The step: "Appointment". */
  title: string;
  /** The work it is part of, read first: "Megan · Bridal gown"; null for her own. */
  work: string | null;
  time: string | null;
  /** "Day 2 of 5" */
  part: string | null;
  done: boolean;
  clash: boolean;
}

export interface SnapshotDay {
  day: IsoDate;
  heading: string;
  entries: SnapshotEntry[];
}

export interface DaySnapshot {
  version: typeof SNAPSHOT_VERSION;
  ownerId: string;
  /** The day it was made on, in her time zone. */
  day: IsoDate;
  timezone: string;
  /** When it was made (an ISO instant). */
  madeAt: string;
  firstName: string;
  overdue: SnapshotEntry[];
  days: SnapshotDay[];
}

function entryOf(step: Step, entry?: Entry): SnapshotEntry {
  const overdue = !entry;
  return {
    id: step.id,
    title: step.title,
    work: step.job ? jobHeadline(step.job) : null,
    time: timeLabel(step),
    part: entry ? partLabel(entry) : overdue && step.onDay ? `From ${formatDay(step.onDay)}` : null,
    done: step.doneOn !== null,
    clash: entry?.clash ?? false,
  };
}

export function makeSnapshot(input: {
  ownerId: string;
  today: IsoDate;
  timezone: string;
  madeAt: Date;
  firstName: string;
  agenda: Agenda;
}): DaySnapshot {
  return {
    version: SNAPSHOT_VERSION,
    ownerId: input.ownerId,
    day: input.today,
    timezone: input.timezone,
    madeAt: input.madeAt.toISOString(),
    firstName: input.firstName,
    overdue: input.agenda.overdue.map((s) => entryOf(s)),
    days: input.agenda.days.map((d) => ({
      day: d.day,
      heading: dayHeading(d.day, input.today),
      entries: d.entries.map((e) => entryOf(e.step, e)),
    })),
  };
}

/** Whether the snapshot was made today (ticks allowed) or on an earlier day (a reminder only, decision 0055). */
export function isForToday(snapshot: DaySnapshot, now: Date): boolean {
  return snapshot.day === todayIn(snapshot.timezone, now);
}

// ---------------------------------------------------------------------------------------------
// Ticks that wait for the signal

export interface WaitingTap {
  /** Unique, to undo this tap and no other. */
  key: string;
  ownerId: string;
  stepId: string;
  /** What she reads for it, as its tick button names it: the step, then its work (`tapName`). */
  title: string;
  /** Whether she saw it done when she tapped (decision 0056). */
  sawDone: boolean;
  /** What she made it: done, or not done. */
  done: boolean;
  /** When she tapped (an ISO instant). */
  at: string;
}

export interface OfflineEntry extends SnapshotEntry {
  /** Taps on this step not sent yet. */
  waiting: number;
  /** The key of its last waiting tap: the only one that may be undone. */
  undoKey: string | null;
}

function apply(entry: SnapshotEntry, ownerId: string, waiting: readonly WaitingTap[]): OfflineEntry {
  const mine = waiting.filter((t) => t.stepId === entry.id && t.ownerId === ownerId);
  const last = mine.at(-1);
  return { ...entry, done: last ? last.done : entry.done, waiting: mine.length, undoKey: last?.key ?? null };
}

/** The snapshot with her waiting taps applied: what she sees on the offline page. */
export function withWaiting(
  snapshot: DaySnapshot,
  waiting: readonly WaitingTap[],
): { overdue: OfflineEntry[]; days: (Omit<SnapshotDay, 'entries'> & { entries: OfflineEntry[] })[] } {
  return {
    overdue: snapshot.overdue.map((e) => apply(e, snapshot.ownerId, waiting)),
    days: snapshot.days.map((d) => ({
      ...d,
      entries: d.entries.map((e) => apply(e, snapshot.ownerId, waiting)),
    })),
  };
}

/** A step as its tick names it: "Sewing, Megan · Bridal gown"; her own step by its title. */
export function tapName(entry: Pick<SnapshotEntry, 'title' | 'work'>): string {
  return entry.work ? `${entry.title}, ${entry.work}` : entry.title;
}

/** Ticks a step done, or opens it again, as she sees it now. */
export function addTap(
  waiting: readonly WaitingTap[],
  entry: OfflineEntry,
  ownerId: string,
  key: string,
  at: Date,
): WaitingTap[] {
  return [
    ...waiting,
    {
      key,
      ownerId,
      stepId: entry.id,
      title: tapName(entry),
      sawDone: entry.done,
      done: !entry.done,
      at: at.toISOString(),
    },
  ];
}

/** Takes back a step's last waiting tap. An earlier one stays: the later ones were made after it. */
export function undoTap(waiting: readonly WaitingTap[], key: string): WaitingTap[] {
  const tap = waiting.find((t) => t.key === key);
  if (!tap) return [...waiting];
  const last = waiting.filter((t) => t.stepId === tap.stepId).at(-1);
  return last?.key === key ? waiting.filter((t) => t.key !== key) : [...waiting];
}

// ---------------------------------------------------------------------------------------------
// Sending them

export type ReplayOutcome =
  { result: 'applied' } | { result: 'stale' | 'missing' | 'invalid'; message: string };

/** What she reads after her waiting taps were sent. */
export function replayReport(outcomes: readonly ReplayOutcome[]): { saved: string | null; left: string[] } {
  const applied = outcomes.filter((o) => o.result === 'applied').length;
  return {
    saved:
      applied === 0
        ? null
        : `${applied} ${applied === 1 ? 'tick' : 'ticks'} made without signal ${applied === 1 ? 'was' : 'were'} saved.`,
    left: outcomes.flatMap((o) => (o.result === 'applied' ? [] : [o.message])),
  };
}

/** Where "Try again" goes: the page she was opening, if it is one of the app's own; Today otherwise. */
export function returnPath(from: string | undefined): string {
  if (!from || !from.startsWith('/') || from.startsWith('//') || from.startsWith('/\\')) return '/';
  if (from === '/offline' || from.startsWith('/offline?') || from.startsWith('/api/')) return '/';
  return from;
}
