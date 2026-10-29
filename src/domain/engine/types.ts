import type { IsoDate } from '../dates';
import type { TimeOfDay } from '../calendar/types';

/**
 * The contract of the scheduling engine. See docs/engine.md for what each field means.
 * Everything here is plain data (strings, whole numbers, lists), so a plan can be stored,
 * compared and sent to the browser without conversion.
 */

// ---------------------------------------------------------------------------------------------
// Facts in

export type TaskKind = 'work' | 'wait' | 'fixed' | 'milestone';
export type TaskStatus = 'not_started' | 'in_progress' | 'done' | 'cancelled';

export interface LockedSlot {
  day: IsoDate;
  minutes: number;
}

export interface Task {
  /** Any text that is unique among tasks. The engine breaks ties by comparing ids. */
  id: string;
  /** The order this task belongs to, or null for studio work with no promise. */
  orderId: string | null;
  title: string;
  kind: TaskKind;
  /** Defaults to not_started. */
  status?: TaskStatus;
  /** Work: minutes still to do. Fixed: length of the event. Not used by waits and milestones. */
  minutes?: number;
  /** Wait: how many calendar days it lasts. */
  days?: number;
  /** The earliest day this may start. */
  notBefore?: IsoDate | null;
  /** Fixed events only: where it sits. The engine never moves it. */
  fixedAt?: { day: IsoDate; time: TimeOfDay } | null;
  /** The last day this may finish. */
  deadline?: IsoDate | null;
  /** Work she has pinned to particular days. Must add up to `minutes`. */
  lockedSlots?: LockedSlot[] | null;
  /** Done tasks: the day it was finished. */
  doneOn?: IsoDate | null;
  /** A manual hold, with her reason. A held task is left out of the plan. */
  hold?: string | null;
  /** Breaks ties between equally urgent tasks. Lower goes first. Default 0. */
  priority?: number;
}

/** `to` may not start before `from` has finished and `lagDays` calendar days have passed. */
export interface Edge {
  from: string;
  to: string;
  lagDays?: number;
}

export interface OrderFacts {
  id: string;
  /** What the order is called on screen, for messages. */
  label: string;
  /** The promised handover day. */
  deliveryOn: IsoDate;
  /** Days kept free before handover. */
  bufferDays: number;
}

export type PrerequisiteState = 'needed' | 'ordered' | 'received';

export interface Prerequisite {
  id: string;
  orderId: string | null;
  label: string;
  state: PrerequisiteState;
  /** When it is expected to arrive. */
  expectedOn: IsoDate | null;
  /** Only a blocking prerequisite holds work back. */
  blocking: boolean;
}

/** The task cannot start until the prerequisite has arrived. */
export interface Requirement {
  taskId: string;
  prerequisiteId: string;
}

/** Minutes the planner may fill on each day, starting at `start`. 0 means closed. */
export interface Calendar {
  start: IsoDate;
  usable: number[];
}

export interface EngineOptions {
  /**
   * A day's leftover time smaller than this is not used for a task that needs more,
   * because nobody sews for 10 minutes. The last piece of a task may be any size. Default 30.
   */
  minSlotMinutes?: number;
}

export interface PlanInput {
  today: IsoDate;
  calendar: Calendar;
  tasks: Task[];
  edges?: Edge[];
  orders?: OrderFacts[];
  prerequisites?: Prerequisite[];
  requirements?: Requirement[];
  options?: EngineOptions;
}

// ---------------------------------------------------------------------------------------------
// Refusals

export const ERROR_CODES = [
  'today_outside_calendar',
  'bad_capacity',
  'bad_date',
  'duplicate_id',
  'unknown_kind',
  'unknown_status',
  'unknown_order',
  'unknown_task',
  'unknown_prerequisite',
  'bad_buffer',
  'bad_lag',
  'edge_to_self',
  'cross_order_edge',
  'cycle',
  'missing_estimate',
  'wait_without_days',
  'fixed_without_time',
  'done_without_date',
  'locked_mismatch',
  'locked_not_work',
  'fixed_event_in_past',
  'locked_slot_in_past',
  'beyond_calendar',
  'pinned_contradiction',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Why the engine refused to plan. It stops rather than guess. */
export interface ValidationError {
  code: ErrorCode;
  /** The task, order or prerequisite it is about. */
  subject: string | null;
  message: string;
  details: Record<string, number | string | string[]>;
}

// ---------------------------------------------------------------------------------------------
// Plan out

export type OrderState = 'on_track' | 'at_risk' | 'infeasible';

export const WARNING_CODES = [
  'order_cannot_make_delivery',
  'order_late',
  'capacity_shared',
  'buffer_used',
  'task_after_latest_finish',
  'fixed_before_predecessor',
  'fixed_before_prerequisite',
  'task_on_hold',
  'fixed_undated',
  'prerequisite_undated',
  'predecessor_unplanned',
  'no_room_in_calendar',
  'pinned_on_closed_day',
  'pinned_over_capacity',
] as const;
export type WarningCode = (typeof WARNING_CODES)[number];

export interface Warning {
  code: WarningCode;
  /** info: good to know. warning: may cause trouble. problem: the promise is broken or cannot be planned. */
  severity: 'info' | 'warning' | 'problem';
  orderId: string | null;
  taskId: string | null;
  /** The figures behind the message, so a screen can say it in any words. */
  numbers: Record<string, number | string>;
  /** The same finding in plain English. */
  message: string;
}

export interface Slot {
  taskId: string;
  day: IsoDate;
  minutes: number;
  /**
   * Position within the day, 1 first. Every task comes after the tasks it follows; among the
   * rest, fixed events come first by clock time, then the work, the most urgent first.
   */
  rank: number;
  /** Only fixed events have a clock time. */
  time?: TimeOfDay;
}

export type Placement = 'planned' | 'pinned' | 'unplanned' | 'done';

export interface PlannedTask {
  id: string;
  orderId: string | null;
  placement: Placement;
  /** First and last day this task occupies. Null when it is not planned. */
  start: IsoDate | null;
  finish: IsoDate | null;
  /** The earliest it could finish if it had all her time from today (a proven lower bound). */
  earliestFinish: IsoDate | null;
  /** The latest it may finish and still keep the promise. Null when nothing limits it. */
  latestFinish: IsoDate | null;
  /** Days between the planned finish and the latest finish. Negative means late. */
  slackDays: number | null;
  /** On the chain that sets when its order is ready. */
  critical: boolean;
}

export interface OrderPlan {
  id: string;
  state: OrderState;
  /**
   * The day the plan has everything in this order finished. Null when part of the order is left
   * out of the plan (`complete` is false) and when nothing is planned: with a task missing there
   * is no day to promise.
   */
  readyOn: IsoDate | null;
  /** The soonest it could be ready with every hour of hers. */
  earliestReadyOn: IsoDate | null;
  /** deliveryOn minus the handover day and the buffer. */
  lastWorkDay: IsoDate;
  /** Days between readyOn and lastWorkDay. Negative means late. Null whenever readyOn is. */
  slackDays: number | null;
  /** False when some task could not be planned. */
  complete: boolean;
  /** The findings that decide the state. Empty when it is on track. */
  reasons: Warning[];
}

export interface Plan {
  today: IsoDate;
  slots: Slot[];
  tasks: PlannedTask[];
  orders: OrderPlan[];
  /** Ids of the tasks on the chain that sets each order's ready day. */
  critical: string[];
  warnings: Warning[];
}

export type PlanResult = { ok: true; plan: Plan } | { ok: false; errors: ValidationError[] };

// ---------------------------------------------------------------------------------------------
// Difference between two plans

export interface Span {
  start: IsoDate;
  finish: IsoDate;
}

export interface MovedTask {
  taskId: string;
  orderId: string | null;
  before: Span | null;
  after: Span | null;
  change: 'moved' | 'newly_planned' | 'no_longer_planned';
}

export interface ReadyDateChange {
  orderId: string;
  before: IsoDate | null;
  after: IsoDate | null;
  /** Positive: later. Null if either side has no ready day. */
  days: number | null;
}

export interface PlanDiff {
  moved: MovedTask[];
  /** Orders whose state got worse. */
  newlyAtRisk: { orderId: string; before: OrderState; after: OrderState }[];
  /** Orders whose state got better. */
  recovered: { orderId: string; before: OrderState; after: OrderState }[];
  readyDateChanges: ReadyDateChange[];
}
