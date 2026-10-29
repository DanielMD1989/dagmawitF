import { takeEarliest } from './capacity';
import { compareText, isPinned, pinnedFinish, pinnedStart, type Model, type Node } from './model';
import type { Passes, UnplannedReason } from './passes';

/**
 * Step 4 of the engine: place every task.
 *
 * Pinned things (fixed events, locked work) go first, exactly where she put them. Then a
 * list scheduler repeatedly picks, among the tasks whose predecessors are all placed, the most
 * urgent one and gives it the earliest days that still have time free:
 *   1. work already started,  2. least slack,  3. earliest delivery,  4. priority,  5. id.
 * Taking the earliest days front-loads the work and leaves the buffer at the end, where
 * surprises land. The same rules in the same order give the same plan every time.
 */

export interface Span {
  start: number;
  finish: number;
}

export interface PlacedSlot {
  node: number;
  day: number;
  minutes: number;
}

export interface Allocation {
  /** Where each task sits. Null for tasks that are not planned. */
  spans: (Span | null)[];
  slots: PlacedSlot[];
  /** Why a task is not planned, or null. */
  unplanned: (UnplannedReason | null)[];
  /** Time left on each day once everything is placed. */
  free: number[];
  /** Time on each day taken by pinned things, which may exceed the day's capacity. */
  pinnedLoad: number[];
  /** The order tasks were placed in: -1 for pinned things, then 0, 1, 2 ... by urgency. */
  sequence: number[];
}

export function allocate(
  model: Model,
  passes: Passes,
  initial: readonly (UnplannedReason | null)[],
): Allocation {
  const { nodes, cap, today } = model;
  const unplanned = initial.map((r) => (r ? { ...r } : null));
  const spans: (Span | null)[] = nodes.map((n) =>
    n.done ? { start: n.doneDay ?? today, finish: n.doneDay ?? today } : null,
  );
  const slots: PlacedSlot[] = [];
  const pinnedLoad = cap.map(() => 0);
  const sequence = nodes.map(() => -1);
  let placedCount = 0;

  // --- pinned things first ------------------------------------------------------------------
  for (const n of nodes) {
    if (n.done || unplanned[n.i] || !isPinned(n)) continue;
    spans[n.i] = { start: pinnedStart(n), finish: pinnedFinish(n) };
    if (n.fixedDay !== null) {
      slots.push({ node: n.i, day: n.fixedDay, minutes: n.minutes });
      pinnedLoad[n.fixedDay] = (pinnedLoad[n.fixedDay] ?? 0) + n.minutes;
    } else {
      for (const s of n.locked ?? []) {
        slots.push({ node: n.i, day: s.day, minutes: s.minutes });
        pinnedLoad[s.day] = (pinnedLoad[s.day] ?? 0) + s.minutes;
      }
    }
  }
  const free = cap.map((c, d) => Math.max(0, c - (pinnedLoad[d] ?? 0)));

  const startOf = (n: Node): number => {
    let start = Math.max(today, n.notBefore ?? -Infinity, n.prereqDay ?? -Infinity);
    for (const link of n.preds) {
      const p = spans[link.node];
      if (p) start = Math.max(start, p.finish + link.lag);
    }
    return start;
  };

  const eligible = (n: Node): boolean => {
    if (spans[n.i] || unplanned[n.i]) return false;
    return n.preds.every((link) => spans[link.node] !== null || unplanned[link.node] !== null);
  };

  const failToPlace = (n: Node, detail: string) => {
    unplanned[n.i] = { code: 'no_room_in_calendar', detail };
    // Everything after it cannot be planned either.
    const stack = [...n.succs.map((l) => l.node)];
    while (stack.length > 0) {
      const next = nodes[stack.pop() as number];
      if (!next || next.done || unplanned[next.i] || spans[next.i]) continue;
      unplanned[next.i] = { code: 'predecessor_unplanned', detail: n.title };
      for (const l of next.succs) stack.push(l.node);
    }
  };

  const urgency = (a: Node, b: Node): number => {
    const tier = (a.inProgress ? 0 : 1) - (b.inProgress ? 0 : 1);
    if (tier !== 0) return tier;
    const slackA = passes.slack[a.i] ?? Infinity;
    const slackB = passes.slack[b.i] ?? Infinity;
    if (slackA !== slackB) return slackA < slackB ? -1 : 1;
    const dueA = a.orderIdx >= 0 ? (model.orders[a.orderIdx]?.deliveryDay ?? Infinity) : Infinity;
    const dueB = b.orderIdx >= 0 ? (model.orders[b.orderIdx]?.deliveryDay ?? Infinity) : Infinity;
    if (dueA !== dueB) return dueA < dueB ? -1 : 1;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return compareText(a.id, b.id);
  };

  for (;;) {
    // Waits and milestones use none of her time, so place them as soon as they are reachable.
    let progressed = false;
    for (const n of nodes) {
      if (n.kind === 'work' || n.kind === 'fixed' || !eligible(n)) continue;
      const start = startOf(n);
      spans[n.i] = { start, finish: n.kind === 'wait' ? start + n.days : start };
      progressed = true;
    }
    if (progressed) continue;

    let best: Node | null = null;
    for (const n of nodes) {
      if (!eligible(n)) continue;
      if (best === null || urgency(n, best) < 0) best = n;
    }
    if (best === null) break;

    const start = startOf(best);
    const chunks = takeEarliest(free, start, best.minutes, model.minSlot);
    if (chunks === null) {
      const room = free.slice(Math.max(start, 0)).reduce((sum, m) => sum + m, 0);
      failToPlace(best, `${best.minutes} minutes needed, ${room} free from the earliest start`);
      continue;
    }
    for (const c of chunks) {
      free[c.day] = (free[c.day] ?? 0) - c.minutes;
      slots.push({ node: best.i, day: c.day, minutes: c.minutes });
    }
    sequence[best.i] = placedCount++;
    spans[best.i] = {
      start: (chunks[0] as { day: number }).day,
      finish: (chunks[chunks.length - 1] as { day: number }).day,
    };
  }

  return { spans, slots, unplanned, free, pinnedLoad, sequence };
}
