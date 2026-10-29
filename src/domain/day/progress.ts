import { isIsoDate, type IsoDate } from '../dates';
import type { TaskKind } from '../engine/types';
import { MAX_TASK_MINUTES } from '../planning/forms';
import type { TaskStatus } from './today';

/**
 * Progress on a task, whichever way it arrives: a form on My Day, or a tap that waited on the phone for the signal
 * (docs/harden.md, decision 0058). The forms read their fields into a change; the server checks every change with
 * `progressProblem` and applies it only if the task still has the status she saw (decision 0056).
 */

export type ProgressChange =
  | { kind: 'start' }
  | { kind: 'done'; doneOn: IsoDate; actualMinutes: number | null }
  | { kind: 'remaining'; minutes: number }
  | { kind: 'reopen' };

export const TASK_STATUSES = ['not_started', 'in_progress', 'done'] as const satisfies readonly TaskStatus[];

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value);
}

/** Her own time goes into work and appointments: those say how long they took, and how long is left. */
export function takesHerTime(kind: TaskKind): boolean {
  return kind === 'work' || kind === 'fixed';
}

/** The status a change leaves the task in. */
export function statusAfter(change: ProgressChange): TaskStatus {
  return change.kind === 'done' ? 'done' : 'in_progress';
}

/** The statuses a change may be made from: what My Day offers in each status. */
export function allowedFrom(change: ProgressChange): readonly TaskStatus[] {
  switch (change.kind) {
    case 'start':
      return ['not_started'];
    case 'done':
    case 'remaining':
      return ['not_started', 'in_progress'];
    case 'reopen':
      return ['done'];
  }
}

const wholeMinutes = (n: number) => Number.isInteger(n) && n >= 1 && n <= MAX_TASK_MINUTES;

/** What is wrong with a change for a task of this kind, in her words; null when nothing is. */
export function progressProblem(change: ProgressChange, kind: TaskKind, today: IsoDate): string | null {
  switch (change.kind) {
    case 'start':
    case 'reopen':
      return null;
    case 'done':
      if (!isIsoDate(change.doneOn) || change.doneOn < '2000-01-01') return 'Choose a day.';
      if (change.doneOn > today) return 'Choose today or an earlier day.';
      if (takesHerTime(kind)) {
        if (change.actualMinutes === null) return 'Say how long it took, in total.';
        if (!wholeMinutes(change.actualMinutes))
          return `Keep the time it took under ${MAX_TASK_MINUTES / 60} hours.`;
      } else if (change.actualMinutes !== null) return 'A wait or a milestone takes none of her time.';
      return null;
    case 'remaining':
      if (!takesHerTime(kind)) return 'Only work and appointments have time left.';
      if (!wholeMinutes(change.minutes)) return `Keep the time left under ${MAX_TASK_MINUTES / 60} hours.`;
      return null;
  }
}

const STATUS_WORDS: Readonly<Record<TaskStatus, string>> = {
  not_started: 'not started',
  in_progress: 'started',
  done: 'done',
};

/** Why a change was left: the task moved since she saw it (marked on another device, say). */
export function staleMessage(now: TaskStatus): string {
  return `It is ${STATUS_WORDS[now]} now, so this was left as it is.`;
}

/** Why a change was left: the task is gone. */
export const MISSING_MESSAGE = 'It was removed, so this was left.';
