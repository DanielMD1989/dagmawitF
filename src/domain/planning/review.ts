import { addDays, daysBetween, formatDay, isoWeekday, type IsoDate } from '../dates';
import { formatMinutes } from '../duration';
import { diff } from '../engine/diff';
import type { OrderState, Slot, TaskKind, Warning, WarningCode } from '../engine/types';
import { ORDER_STATE_LABEL } from './words';
import { toPlan, type StoredPlan } from './proposal';

/**
 * What the review page shows, worked out from a stored plan (docs/planning.md, "Reviewing"). Pure: the page only
 * lays it out.
 */

/** "Tue 27 Oct", or "Tue 27 to Wed 28 Oct", or "Fri 30 Oct to Wed 4 Nov". */
export function formatSpan(start: IsoDate, finish: IsoDate): string {
  if (start === finish) return formatDay(start);
  const sameMonth = start.slice(0, 7) === finish.slice(0, 7);
  const first = sameMonth ? formatDay(start).split(' ').slice(0, 2).join(' ') : formatDay(start);
  return `${first} to ${formatDay(finish)}`;
}

/** "3h 00m", "2 days", or nothing for a milestone. */
export function estimateText(kind: TaskKind, minutes: number | null, days: number | null): string {
  if ((kind === 'work' || kind === 'fixed') && minutes !== null) return formatMinutes(minutes);
  if (kind === 'wait' && days !== null) return `${days} day${days === 1 ? '' : 's'}`;
  return '';
}

export type Tone = 'ok' | 'attention' | 'problem';

/** Why a task is not in the plan, in a few words for the schedule. The full sentence is the finding. */
const LEFT_OUT: Partial<Record<WarningCode, string>> = {
  fixed_undated: 'Needs a day',
  prerequisite_undated: 'Waiting for a date',
  predecessor_unplanned: 'Waits for work not planned',
  task_on_hold: 'On hold',
  no_room_in_calendar: 'No room',
};

export interface ScheduleRow {
  taskId: string;
  title: string;
  /** The garment it is for. */
  garment: string | null;
  kind: TaskKind;
  estimate: string;
  /** When it is planned, or empty. */
  planned: string;
  start: IsoDate | null;
  status: { text: string; tone: Tone };
}

export interface Finding {
  code: WarningCode;
  severity: Warning['severity'];
  /** The garment of the task it is about. */
  garment: string | null;
  /** Left out only because the work before it is (see `isConsequence`). */
  consequence: boolean;
  taskId: string | null;
  message: string;
}

export interface WeekLoad {
  /** The Monday. */
  week: IsoDate;
  /** Her usable minutes that week, from the plan's calendar, from the plan's day on. */
  usable: number;
  thisOrder: number;
  otherOrders: number;
  free: number;
}

export interface OrderReview {
  id: string;
  label: string;
  deliveryOn: IsoDate;
  lastWorkDay: IsoDate;
  state: OrderState;
  stateLabel: string;
  /** None means there is nothing to plan yet: its state says nothing. */
  taskCount: number;
  /** The garments its tasks are for, so the schedule can say which is which when there are several. */
  garments: string[];
  readyOn: IsoDate | null;
  /** Days between ready and the last working day; negative is late. */
  slackDays: number | null;
  /** Minutes of her time the order needs, and how many of them the plan has placed. */
  neededMinutes: number;
  placedMinutes: number;
  /** What she can act on: causes, problems first. */
  attention: Finding[];
  /** Work left out only because work before it is: it follows when the causes are put right. */
  consequences: Finding[];
  information: Finding[];
  schedule: ScheduleRow[];
  weeks: WeekLoad[];
}

const SEVERITY_ORDER: Record<Warning['severity'], number> = { problem: 0, warning: 1, info: 2 };

/**
 * Within a severity, causes before their consequences: the fitting with no day comes before "the alterations
 * wait for work that is not planned", which it causes.
 */
// Every code must be ranked: the type makes a new finding without a place here a compile error.
const CAUSE_RANK: Readonly<Record<WarningCode, number>> = {
  order_cannot_make_delivery: 0,
  order_late: 1,
  fixed_before_predecessor: 2,
  fixed_before_prerequisite: 3,
  no_room_in_calendar: 4,
  fixed_undated: 5,
  prerequisite_undated: 6,
  task_on_hold: 7,
  task_after_latest_finish: 8,
  buffer_used: 9,
  capacity_shared: 10,
  predecessor_unplanned: 11,
  pinned_on_closed_day: 12,
  pinned_over_capacity: 13,
};
const causeRank = (code: WarningCode) => CAUSE_RANK[code];

const mondayOf = (day: IsoDate) => addDays(day, 1 - isoWeekday(day));

/**
 * A task left out only because the work before it is left out: nothing to do about it itself. (A fixed task whose
 * work before it is missing is different: it stays where she put it and is at risk, so it stays in her list.)
 */
function isConsequence(w: Pick<Warning, 'code' | 'numbers'>): boolean {
  return w.code === 'predecessor_unplanned' && !('pinnedDay' in w.numbers);
}

/** Problems and warnings in the whole plan that she can act on: what the Approve button counts. */
export function causeCount(stored: StoredPlan): number {
  return stored.warnings.filter((w) => w.severity !== 'info' && !isConsequence(w)).length;
}

export function reviewOrder(stored: StoredPlan, slots: readonly Slot[], orderId: string): OrderReview | null {
  const order = stored.orders.find((o) => o.id === orderId);
  const facts = stored.facts.orders.find((o) => o.id === orderId);
  if (!order || !facts) return null;

  const taskFacts = stored.facts.tasks.filter((t) => t.orderId === orderId);
  const mine = new Set(taskFacts.map((t) => t.id));
  const planned = new Map(stored.tasks.map((t) => [t.id, t]));
  const mySlots = slots.filter((s) => mine.has(s.taskId));

  const findings = stored.warnings
    .filter((w) => w.orderId === orderId)
    .map((w) => ({
      code: w.code,
      severity: w.severity,
      garment: w.taskId === null ? null : (taskFacts.find((t) => t.id === w.taskId)?.garment ?? null),
      taskId: w.taskId,
      message: w.message,
      consequence: isConsequence(w),
    }))
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || causeRank(a.code) - causeRank(b.code),
    );

  const late = new Set(
    stored.warnings.filter((w) => w.code === 'task_after_latest_finish').map((w) => w.taskId),
  );
  const schedule: ScheduleRow[] = taskFacts.map((t) => {
    const p = planned.get(t.id);
    const times = mySlots.filter((s) => s.taskId === t.id && s.time !== undefined);
    let plannedText = '';
    if (p && p.start !== null && p.finish !== null) {
      plannedText = formatSpan(p.start, p.finish);
      if (t.kind === 'fixed' && times[0]?.time) plannedText += `, ${times[0].time}`;
    }
    let status: ScheduleRow['status'];
    if (!p || p.placement === 'unplanned') {
      const why = stored.warnings.find((w) => w.taskId === t.id && LEFT_OUT[w.code] !== undefined);
      status = { text: why ? (LEFT_OUT[why.code] as string) : 'Not planned', tone: 'problem' };
    } else if (late.has(t.id) || (p.slackDays !== null && p.slackDays < 0)) {
      status = { text: 'Late', tone: 'problem' };
    } else if (p.placement === 'pinned') {
      status = { text: 'Fixed by you', tone: 'ok' };
    } else {
      status = { text: 'Planned', tone: 'ok' };
    }
    return {
      taskId: t.id,
      title: t.title,
      garment: t.garment,
      kind: t.kind,
      estimate: estimateText(t.kind, t.minutes, t.days),
      planned: plannedText,
      start: p?.start ?? null,
      status,
    };
  });
  // In the order she will meet them: planned work by its first day, then what is not planned.
  const position = new Map(taskFacts.map((t, i) => [t.id, i]));
  schedule.sort(
    (a, b) =>
      (a.start === null ? 1 : 0) - (b.start === null ? 1 : 0) ||
      (a.start !== null && b.start !== null ? daysBetween(b.start, a.start) : 0) ||
      (position.get(a.taskId) ?? 0) - (position.get(b.taskId) ?? 0),
  );

  const neededMinutes = taskFacts.reduce(
    (sum, t) => sum + ((t.kind === 'work' || t.kind === 'fixed') && t.minutes !== null ? t.minutes : 0),
    0,
  );
  const placedMinutes = mySlots.reduce((sum, s) => sum + s.minutes, 0);

  return {
    id: orderId,
    label: facts.label,
    deliveryOn: facts.deliveryOn,
    lastWorkDay: order.lastWorkDay,
    state: order.state,
    stateLabel: ORDER_STATE_LABEL[order.state],
    taskCount: taskFacts.length,
    garments: [...new Set(taskFacts.flatMap((t) => (t.garment === null ? [] : [t.garment])))],
    readyOn: order.readyOn,
    slackDays: order.slackDays,
    neededMinutes,
    placedMinutes,
    attention: findings.filter((f) => f.severity !== 'info' && !f.consequence),
    consequences: findings.filter((f) => f.severity !== 'info' && f.consequence),
    information: findings.filter((f) => f.severity === 'info'),
    schedule,
    weeks: weekLoads(stored, slots, orderId),
  };
}

/** Each week the order has work in: her usable time, this order's share, the other orders', what is left. */
export function weekLoads(stored: StoredPlan, slots: readonly Slot[], orderId: string): WeekLoad[] {
  const mine = new Set(stored.facts.tasks.filter((t) => t.orderId === orderId).map((t) => t.id));
  const weeks = [...new Set(slots.filter((s) => mine.has(s.taskId)).map((s) => mondayOf(s.day)))].sort();
  return weeks.map((week) => {
    let usable = 0;
    for (let i = 0; i < 7; i++) {
      const day = addDays(week, i);
      if (day < stored.today) continue;
      const index = daysBetween(stored.calendar.start, day);
      usable += stored.calendar.usable[index] ?? 0;
    }
    const inWeek = slots.filter((s) => mondayOf(s.day) === week);
    const thisOrder = inWeek.filter((s) => mine.has(s.taskId)).reduce((sum, s) => sum + s.minutes, 0);
    const otherOrders = inWeek.filter((s) => !mine.has(s.taskId)).reduce((sum, s) => sum + s.minutes, 0);
    return { week, usable, thisOrder, otherOrders, free: Math.max(0, usable - thisOrder - otherOrders) };
  });
}

export interface OrderLine {
  id: string;
  label: string;
  taskCount: number;
  state: OrderState;
  stateLabel: string;
  readyOn: IsoDate | null;
  deliveryOn: IsoDate;
}

/** Every order in a plan, the ones in trouble first, then by handover. */
export function planOrders(stored: StoredPlan): OrderLine[] {
  const rank: Record<OrderState, number> = { infeasible: 0, at_risk: 1, on_track: 2 };
  return stored.orders
    .map((o) => {
      const f = stored.facts.orders.find((x) => x.id === o.id);
      return {
        id: o.id,
        label: f?.label ?? 'An order',
        taskCount: stored.facts.tasks.filter((t) => t.orderId === o.id).length,
        state: o.state,
        stateLabel: ORDER_STATE_LABEL[o.state],
        readyOn: o.readyOn,
        deliveryOn: f?.deliveryOn ?? o.lastWorkDay,
      };
    })
    .sort(
      (a, b) =>
        rank[a.state] - rank[b.state] ||
        (a.deliveryOn < b.deliveryOn ? -1 : a.deliveryOn > b.deliveryOn ? 1 : 0),
    );
}

export interface OrderChange {
  orderId: string;
  label: string;
  /** "Ready Thu 12 Nov, 2 days later than in plan 3." */
  text: string;
  worse: boolean;
}

/**
 * What a proposal changes for each order compared with the approved plan: a ready day that moves, a state that
 * gets worse or better, an order that is new to the plan. Orders that do not change are left out.
 */
export function changesAgainst(
  approved: { number: number; stored: StoredPlan; slots: readonly Slot[] } | null,
  proposed: { stored: StoredPlan; slots: readonly Slot[] },
): OrderChange[] {
  const label = (id: string) =>
    proposed.stored.facts.orders.find((o) => o.id === id)?.label ??
    approved?.stored.facts.orders.find((o) => o.id === id)?.label ??
    'An order';
  if (approved === null) return [];
  const d = diff(toPlan(approved.stored, approved.slots), toPlan(proposed.stored, proposed.slots));
  const out = new Map<string, OrderChange>();
  const plan = `plan ${approved.number}`;
  for (const c of d.readyDateChanges) {
    let text: string;
    let worse: boolean;
    if (c.after === null) {
      text = `No longer has a ready day: part of its work is not planned (it was ready ${c.before ? formatDay(c.before) : 'never'} in ${plan}).`;
      worse = true;
    } else if (c.before === null) {
      text = `Now ready ${formatDay(c.after)}. In ${plan} it had no ready day.`;
      worse = false;
    } else {
      const days = c.days ?? daysBetween(c.before, c.after);
      const n = Math.abs(days);
      text = `Ready ${formatDay(c.after)}, ${n} day${n === 1 ? '' : 's'} ${days > 0 ? 'later' : 'sooner'} than in ${plan}.`;
      worse = days > 0;
    }
    out.set(c.orderId, { orderId: c.orderId, label: label(c.orderId), text, worse });
  }
  const stateChanges = [
    ...d.newlyAtRisk.map((c) => ({ ...c, worse: true })),
    ...d.recovered.map((c) => ({ ...c, worse: false })),
  ];
  for (const c of stateChanges) {
    const said = `${ORDER_STATE_LABEL[c.after]} (was ${ORDER_STATE_LABEL[c.before].toLowerCase()}).`;
    const ready = out.get(c.orderId);
    out.set(c.orderId, {
      orderId: c.orderId,
      label: label(c.orderId),
      text: ready ? `${said} ${ready.text}` : said,
      worse: c.worse || (ready?.worse ?? false),
    });
  }
  for (const o of proposed.stored.orders) {
    if (!approved.stored.orders.some((a) => a.id === o.id))
      out.set(o.id, {
        orderId: o.id,
        label: label(o.id),
        text: `New in this plan: ${ORDER_STATE_LABEL[o.state].toLowerCase()}.`,
        worse: false,
      });
  }
  for (const o of approved.stored.orders) {
    if (!proposed.stored.orders.some((p) => p.id === o.id))
      out.set(o.id, {
        orderId: o.id,
        label: label(o.id),
        text: 'Not in this plan: it is no longer active (on hold, delivered, cancelled or back to a draft).',
        worse: false,
      });
  }
  return [...out.values()].sort(
    (a, b) => Number(b.worse) - Number(a.worse) || a.label.localeCompare(b.label),
  );
}

export interface TaskMove {
  taskId: string;
  orderId: string | null;
  title: string;
  garment: string | null;
  /** "Mon 16 Nov → Thu 19 Nov", "now planned Mon 16 Nov", "no longer planned (was Mon 16 Nov)". */
  text: string;
  change: 'moved' | 'newly_planned' | 'no_longer_planned';
}

/**
 * Each task whose days change between the approved plan and a proposal, from the engine's own diff (decision 0049),
 * in the order of their new (or old) first day.
 */
export function taskMoves(
  approved: { stored: StoredPlan; slots: readonly Slot[] },
  proposed: { stored: StoredPlan; slots: readonly Slot[] },
): TaskMove[] {
  const d = diff(toPlan(approved.stored, approved.slots), toPlan(proposed.stored, proposed.slots));
  const fact = (id: string) =>
    proposed.stored.facts.tasks.find((t) => t.id === id) ??
    approved.stored.facts.tasks.find((t) => t.id === id);
  const moves = d.moved.map((m) => {
    const f = fact(m.taskId);
    const before = m.before ? formatSpan(m.before.start, m.before.finish) : null;
    const after = m.after ? formatSpan(m.after.start, m.after.finish) : null;
    const text =
      m.change === 'moved'
        ? before === after
          ? `${after}, with its hours spread differently`
          : `${before} → ${after}`
        : m.change === 'newly_planned'
          ? `now planned ${after}`
          : `no longer planned (was ${before})`;
    const move: TaskMove = {
      taskId: m.taskId,
      orderId: m.orderId,
      title: f?.title ?? 'A task since removed',
      garment: f?.garment ?? null,
      text,
      change: m.change,
    };
    return { move, day: (m.after ?? m.before)?.start ?? '' };
  });
  return moves.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)).map((x) => x.move);
}
