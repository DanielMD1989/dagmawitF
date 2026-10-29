import type { IsoDate } from '../dates';
import type {
  Calendar,
  OrderPlan,
  Plan,
  PlanInput,
  PlannedTask,
  Slot,
  TaskKind,
  Warning,
} from '../engine/types';

/**
 * A plan as it is kept (decision 0035): the engine's findings, the calendar it used and the facts of that moment in
 * `plan_version.result`, and its slots as rows of `plan_slot`. An old plan rereads exactly as it was proposed.
 */

export interface StoredFacts {
  orders: { id: string; label: string; deliveryOn: IsoDate; bufferDays: number }[];
  tasks: {
    id: string;
    orderId: string | null;
    /** The garment the task is for, so two garments' "Draft the pattern" can be told apart. */
    garment: string | null;
    title: string;
    kind: TaskKind;
    minutes: number | null;
    days: number | null;
  }[];
}

export interface StoredPlan {
  today: IsoDate;
  calendar: Calendar;
  orders: OrderPlan[];
  tasks: PlannedTask[];
  warnings: Warning[];
  critical: string[];
  facts: StoredFacts;
}

/** A row of plan_slot, as `save_proposal` takes it. */
export interface SlotRow {
  task_id: string;
  day: IsoDate;
  minutes: number;
  rank: number;
  at_time: string | null;
}

export function toStored(
  input: PlanInput,
  plan: Plan,
  garmentOf: (taskId: string) => string | null = () => null,
): { result: StoredPlan; slots: SlotRow[] } {
  return {
    result: {
      today: plan.today,
      calendar: input.calendar,
      orders: plan.orders,
      tasks: plan.tasks,
      warnings: plan.warnings,
      critical: plan.critical,
      facts: {
        orders: (input.orders ?? []).map((o) => ({
          id: o.id,
          label: o.label,
          deliveryOn: o.deliveryOn,
          bufferDays: o.bufferDays,
        })),
        tasks: input.tasks.map((t) => ({
          id: t.id,
          orderId: t.orderId,
          garment: garmentOf(t.id),
          title: t.title,
          kind: t.kind,
          minutes: t.minutes ?? null,
          days: t.days ?? null,
        })),
      },
    },
    slots: plan.slots.map((s) => ({
      task_id: s.taskId,
      day: s.day,
      minutes: s.minutes,
      rank: s.rank,
      at_time: s.time ?? null,
    })),
  };
}

/** The engine's own shape again, so two stored plans can be compared with the engine's `diff`. */
export function toPlan(stored: StoredPlan, slots: readonly Slot[]): Plan {
  return {
    today: stored.today,
    slots: [...slots],
    tasks: stored.tasks,
    orders: stored.orders,
    critical: stored.critical,
    warnings: stored.warnings,
  };
}

/**
 * Whether a plan still stands on today's facts (docs/planning.md, "When a plan is out of date"): made at the current
 * planning epoch, for today. The database applies the same test when it approves.
 */
export function isCurrent(plan: { epoch: number; madeFor: IsoDate }, epoch: number, today: IsoDate): boolean {
  return plan.epoch === epoch && plan.madeFor === today;
}
