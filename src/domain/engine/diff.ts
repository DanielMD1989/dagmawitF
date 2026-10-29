import { daysBetween } from '../dates';
import { compareText } from './model';
import type {
  MovedTask,
  OrderState,
  Plan,
  PlanDiff,
  PlannedTask,
  ReadyDateChange,
  Slot,
  Span,
} from './types';

const RANK: Record<OrderState, number> = { on_track: 0, at_risk: 1, infeasible: 2 };

function spanOf(task: PlannedTask | undefined): Span | null {
  if (!task || task.placement === 'unplanned' || task.start === null || task.finish === null) return null;
  return { start: task.start, finish: task.finish };
}

function slotsByTask(plan: Plan): Map<string, string> {
  const grouped = new Map<string, Slot[]>();
  for (const s of plan.slots) grouped.set(s.taskId, [...(grouped.get(s.taskId) ?? []), s]);
  const out = new Map<string, string>();
  for (const [id, list] of grouped) out.set(id, list.map((s) => `${s.day}:${s.minutes}`).join(','));
  return out;
}

/**
 * What changed between two plans: which tasks moved, which orders got worse or better, and
 * how each order's ready day shifted. This is what lets her see the effect of a late delivery
 * before she accepts a new plan.
 */
export function diff(before: Plan, after: Plan): PlanDiff {
  const a = new Map(before.tasks.map((t) => [t.id, t]));
  const b = new Map(after.tasks.map((t) => [t.id, t]));
  const slotsA = slotsByTask(before);
  const slotsB = slotsByTask(after);

  const moved: MovedTask[] = [];
  for (const id of [...new Set([...a.keys(), ...b.keys()])].sort(compareText)) {
    const ta = a.get(id);
    const tb = b.get(id);
    if (ta?.placement === 'done' || tb?.placement === 'done') continue;
    const spanA = spanOf(ta);
    const spanB = spanOf(tb);
    let change: MovedTask['change'] | null = null;
    if (spanA && !spanB) change = 'no_longer_planned';
    else if (!spanA && spanB) change = 'newly_planned';
    else if (spanA && spanB) {
      const same =
        spanA.start === spanB.start &&
        spanA.finish === spanB.finish &&
        (slotsA.get(id) ?? '') === (slotsB.get(id) ?? '');
      if (!same) change = 'moved';
    }
    if (change)
      moved.push({ taskId: id, orderId: (tb ?? ta)?.orderId ?? null, before: spanA, after: spanB, change });
  }

  const orderA = new Map(before.orders.map((o) => [o.id, o]));
  const newlyAtRisk: PlanDiff['newlyAtRisk'] = [];
  const recovered: PlanDiff['recovered'] = [];
  const readyDateChanges: ReadyDateChange[] = [];
  for (const o of after.orders) {
    const previous = orderA.get(o.id);
    if (!previous) continue;
    if (RANK[o.state] > RANK[previous.state])
      newlyAtRisk.push({ orderId: o.id, before: previous.state, after: o.state });
    if (RANK[o.state] < RANK[previous.state])
      recovered.push({ orderId: o.id, before: previous.state, after: o.state });
    if (previous.readyOn !== o.readyOn) {
      readyDateChanges.push({
        orderId: o.id,
        before: previous.readyOn,
        after: o.readyOn,
        days: previous.readyOn && o.readyOn ? daysBetween(previous.readyOn, o.readyOn) : null,
      });
    }
  }
  return { moved, newlyAtRisk, recovered, readyDateChanges };
}
