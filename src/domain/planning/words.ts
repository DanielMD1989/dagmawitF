import type { OrderState, TaskKind } from '../engine/types';

/** The words for the engine's verdicts and kinds, in one place (decision 0023's rule, applied to plans). */

export const ORDER_STATE_LABEL: Readonly<Record<OrderState, string>> = {
  on_track: 'On track',
  at_risk: 'At risk',
  infeasible: 'Cannot be made in time',
};

export function isOrderState(value: unknown): value is OrderState {
  return value === 'on_track' || value === 'at_risk' || value === 'infeasible';
}

export const TASK_KINDS = ['work', 'wait', 'fixed', 'milestone'] as const satisfies readonly TaskKind[];

export function isTaskKind(value: unknown): value is TaskKind {
  return typeof value === 'string' && (TASK_KINDS as readonly string[]).includes(value);
}

/** Short, for a table or a chip. */
export const KIND_NAME: Readonly<Record<TaskKind, string>> = {
  work: 'Work',
  wait: 'Wait',
  fixed: 'Appointment',
  milestone: 'Milestone',
};

/** Longer, for choosing a kind. */
export const KIND_CHOICE: Readonly<Record<TaskKind, string>> = {
  work: 'Work: her hands, for a number of hours',
  wait: 'Wait: days that pass with no work (drying, resting)',
  fixed: 'Appointment: a fitting at a set day and time',
  milestone: 'Milestone: a moment, such as ready for handover',
};

export type PlanStatus = 'proposed' | 'approved' | 'superseded' | 'rejected';
export const PLAN_STATUSES: readonly PlanStatus[] = ['proposed', 'approved', 'superseded', 'rejected'];

export function isPlanStatus(value: unknown): value is PlanStatus {
  return typeof value === 'string' && (PLAN_STATUSES as readonly string[]).includes(value);
}

export const PLAN_STATUS_LABEL: Readonly<Record<PlanStatus, string>> = {
  proposed: 'Proposed',
  approved: 'Approved',
  superseded: 'Replaced',
  rejected: 'Rejected',
};
