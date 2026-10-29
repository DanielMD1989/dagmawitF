import { todayIn, type IsoDate } from '../dates';
import type { TaskKind } from '../engine/types';
import { allowedFrom, statusAfter, takesHerTime, type ProgressChange } from './progress';
import type { TaskStatus, Today, TodayEntry, TodayState } from './today';

/**
 * My Day without signal (docs/harden.md): the snapshot kept on the phone, and the taps that wait to be sent.
 * Pure: the browser keeps the values, this says what they mean.
 */

export const SNAPSHOT_VERSION = 1;

export type Section = 'fixed' | 'work' | 'started';

export interface SnapshotEntry {
  id: string;
  section: Section;
  title: string;
  orderLabel: string | null;
  kind: TaskKind;
  /** Her estimate. */
  minutes: number | null;
  minutesToday: number;
  time: string | null;
  status: TaskStatus;
  remainingMinutes: number | null;
  actualMinutes: number | null;
  state: TodayState;
  reason: string | null;
}

export interface DaySnapshot {
  version: typeof SNAPSHOT_VERSION;
  ownerId: string;
  /** The day it shows, in her time zone. */
  day: IsoDate;
  timezone: string;
  /** When it was made (an ISO instant). */
  madeAt: string;
  firstName: string;
  planNumber: number | null;
  plannedMinutes: number;
  usableMinutes: number;
  freeMinutes: number;
  entries: SnapshotEntry[];
}

function entryOf(e: TodayEntry, section: Section): SnapshotEntry {
  return {
    id: e.task.id,
    section,
    title: e.task.title,
    orderLabel: e.task.orderLabel,
    kind: e.task.kind,
    minutes: e.task.minutes,
    minutesToday: e.minutesToday,
    time: e.time,
    status: e.task.status,
    remainingMinutes: e.task.remainingMinutes,
    actualMinutes: e.task.actualMinutes,
    state: e.state,
    reason: e.reason,
  };
}

/** What My Day keeps on the phone: the list as she sees it, in the same sections. */
export function makeSnapshot(input: {
  ownerId: string;
  day: IsoDate;
  timezone: string;
  madeAt: Date;
  firstName: string;
  planNumber: number | null;
  plan: Today;
}): DaySnapshot {
  const { plan } = input;
  return {
    version: SNAPSHOT_VERSION,
    ownerId: input.ownerId,
    day: input.day,
    timezone: input.timezone,
    madeAt: input.madeAt.toISOString(),
    firstName: input.firstName,
    planNumber: input.planNumber,
    plannedMinutes: plan.plannedMinutes,
    usableMinutes: plan.usableMinutes,
    freeMinutes: plan.freeMinutes,
    entries: [
      ...plan.entries.map((e) => entryOf(e, e.time === null ? 'work' : 'fixed')),
      ...plan.alsoStarted.map((e) => entryOf(e, 'started')),
    ],
  };
}

/** Whether the snapshot is today's list (taps allowed) or an earlier day's (a reminder only, decision 0055). */
export function isForToday(snapshot: DaySnapshot, now: Date): boolean {
  return snapshot.day === todayIn(snapshot.timezone, now);
}

// ---------------------------------------------------------------------------------------------
// Taps that wait for the signal (decision 0057: start, done, still going)

export type OfflineChange = Exclude<ProgressChange, { kind: 'reopen' }>;

export interface WaitingTap {
  /** Unique, to undo this tap and no other. */
  key: string;
  ownerId: string;
  taskId: string;
  title: string;
  /** The status she saw when she tapped (decision 0056). */
  seen: TaskStatus;
  change: OfflineChange;
  /** When she tapped (an ISO instant). */
  at: string;
}

export interface OfflineEntry extends SnapshotEntry {
  /** Taps on this task not sent yet. */
  waiting: number;
  /** The key of its last waiting tap: the only one that may be undone. */
  undoKey: string | null;
}

/** The snapshot with her waiting taps applied, in order: what she sees on the offline page. */
export function withWaiting(snapshot: DaySnapshot, waiting: readonly WaitingTap[]): OfflineEntry[] {
  return snapshot.entries.map((entry) => {
    const mine = waiting.filter((t) => t.taskId === entry.id && t.ownerId === snapshot.ownerId);
    let e: OfflineEntry = { ...entry, waiting: mine.length, undoKey: mine.at(-1)?.key ?? null };
    for (const tap of mine) {
      const c = tap.change;
      const status = statusAfter(c);
      e = {
        ...e,
        status,
        state: status === 'done' ? 'done' : 'started',
        remainingMinutes: c.kind === 'remaining' ? c.minutes : status === 'done' ? null : e.remainingMinutes,
        actualMinutes: c.kind === 'done' ? c.actualMinutes : e.actualMinutes,
      };
    }
    return e;
  });
}

/** What she can do to a task without signal: what My Day offers a task that is ready or started. */
export function offlineTaps(entry: OfflineEntry): OfflineChange['kind'][] {
  if (entry.state === 'ready')
    return takesHerTime(entry.kind) ? ['start', 'done', 'remaining'] : ['start', 'done'];
  if (entry.state === 'started') return takesHerTime(entry.kind) ? ['done', 'remaining'] : ['done'];
  return [];
}

/** Adds a tap, refusing one My Day would not offer (on a blocked or held task, or one already done). */
export function addTap(
  waiting: readonly WaitingTap[],
  entry: OfflineEntry,
  ownerId: string,
  change: OfflineChange,
  key: string,
  at: Date,
): WaitingTap[] | null {
  if (!offlineTaps(entry).includes(change.kind)) return null;
  if (!allowedFrom(change).includes(entry.status)) return null;
  return [
    ...waiting,
    { key, ownerId, taskId: entry.id, title: entry.title, seen: entry.status, change, at: at.toISOString() },
  ];
}

/** Takes back a task's last waiting tap. An earlier one stays: the later ones were made after it. */
export function undoTap(waiting: readonly WaitingTap[], key: string): WaitingTap[] {
  const tap = waiting.find((t) => t.key === key);
  if (!tap) return [...waiting];
  const last = waiting.filter((t) => t.taskId === tap.taskId).at(-1);
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
        : `${applied} ${applied === 1 ? 'tap' : 'taps'} made without signal ${applied === 1 ? 'was' : 'were'} saved.`,
    left: outcomes.flatMap((o) => (o.result === 'applied' ? [] : [o.message])),
  };
}

/** Where "Try again" goes: the page she was opening, if it is one of the app's own; My Day otherwise. */
export function returnPath(from: string | undefined): string {
  if (!from || !from.startsWith('/') || from.startsWith('//') || from.startsWith('/\\')) return '/';
  if (from === '/offline' || from.startsWith('/offline?') || from.startsWith('/api/')) return '/';
  return from;
}
