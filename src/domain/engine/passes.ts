import { finishIdeal, startIdeal } from './capacity';
import { ancestorSets, isPinned, pinnedFinish, pinnedStart, type Model } from './model';

/**
 * Steps 2 and 3 of the engine: the earliest and latest each task can finish.
 * These are bounds, not a schedule. The forward pass lets every task use all of her time
 * from today, as if no other task existed. So its answers are lower bounds, and when even a
 * lower bound passes the promise, no plan can keep that promise.
 */

export type UnplannedCode =
  'task_on_hold' | 'fixed_undated' | 'prerequisite_undated' | 'predecessor_unplanned' | 'no_room_in_calendar';

export interface UnplannedReason {
  code: UnplannedCode;
  /** The hold reason, the prerequisite names, or the task it waits on. */
  detail: string;
}

/**
 * Tasks that cannot be planned at all: on hold, an appointment with no day, waiting for
 * something with no date, or following one of those. The engine leaves them out and says why, rather than guess.
 * Pinned tasks are the exception: only a hold removes them.
 */
export function findUnplanned(model: Model): (UnplannedReason | null)[] {
  const reasons: (UnplannedReason | null)[] = model.nodes.map(() => null);
  for (const i of model.topo) {
    const n = model.nodes[i];
    if (!n || n.done) continue;
    if (n.hold !== null) {
      reasons[i] = { code: 'task_on_hold', detail: n.hold };
      continue;
    }
    // An appointment with no day yet cannot be placed, and the engine never guesses one (decision 0032).
    if (n.kind === 'fixed' && n.fixedDay === null) {
      reasons[i] = { code: 'fixed_undated', detail: '' };
      continue;
    }
    // Something she fixed by hand stays where she put it, whatever it waits for: a fitting does
    // not vanish from her day because the work before it is late. What is missing is reported
    // against it instead (see check.ts). Only a hold, which is her own instruction, removes it.
    if (isPinned(n)) continue;
    if (n.undated.length > 0) {
      reasons[i] = { code: 'prerequisite_undated', detail: n.undated.join(', ') };
      continue;
    }
    for (const link of n.preds) {
      if (reasons[link.node]) {
        reasons[i] = { code: 'predecessor_unplanned', detail: model.nodes[link.node]?.title ?? '' };
        break;
      }
    }
  }
  return reasons;
}

export interface Passes {
  /**
   * Whether the task was meant to be planned: not done, and not left out for being held or
   * waiting. A task that later turned out to have no room is still one of these, and is the
   * strongest evidence there is that its order cannot be made.
   */
  open: boolean[];
  /** Earliest day each task can start. Not meaningful for done or unplanned tasks. */
  es: number[];
  /** Earliest day each task can finish (a lower bound). Infinity if the calendar is too short. */
  ef: number[];
  /** Latest day each task may finish. Infinity when nothing limits it. */
  lf: number[];
  /** Latest day each task may start. -Infinity when it cannot be done in time at all. */
  ls: number[];
  /** lf - ef: how many days it could slip. Negative means it cannot be on time. */
  slack: number[];
  /** Per order index: the soonest the whole order could be ready. -Infinity if nothing is open. */
  orderEarliest: number[];
}

export function runPasses(model: Model, unplanned: readonly (unknown | null)[]): Passes {
  const { nodes, topo, cap, today } = model;
  const n = nodes.length;
  const es = new Array<number>(n).fill(-Infinity);
  const ef = new Array<number>(n).fill(-Infinity);
  const lf = new Array<number>(n).fill(Infinity);
  const ls = new Array<number>(n).fill(Infinity);

  const open = (i: number) => {
    const node = nodes[i];
    return node !== undefined && !node.done && !unplanned[i];
  };

  // The unpinned work before each task. All of it must be finished by the time the task is,
  // so together with the task's own minutes it has to fit in the days between its earliest
  // start and the task's finish. That is what keeps these bounds honest when several tasks
  // pile up behind the same gap, such as a fitting.
  const ancestors = ancestorSets(model);
  const workBefore = (i: number): number[] =>
    [...(ancestors[i] ?? [])].filter((a) => {
      const node = nodes[a];
      return node !== undefined && open(a) && node.kind === 'work' && !isPinned(node);
    });
  /** The soonest `i` can finish, counting the time its predecessors need too. */
  const crowdedFinish = (i: number, own: number): number => {
    const members = [...workBefore(i), i];
    let bound = finishIdeal(cap, today, own);
    const starts = new Set(members.map((m) => es[m] ?? today));
    starts.add(today);
    for (const from of starts) {
      let minutes = 0;
      for (const m of members) if ((es[m] ?? today) >= from) minutes += nodes[m]?.minutes ?? 0;
      bound = Math.max(bound, finishIdeal(cap, from, minutes));
    }
    return bound;
  };

  // --- forward pass -------------------------------------------------------------------------
  for (const i of topo) {
    const node = nodes[i];
    if (!node) continue;
    if (node.done) {
      const day = node.doneDay ?? today;
      es[i] = day;
      ef[i] = day;
      continue;
    }
    if (!open(i)) continue;

    if (isPinned(node)) {
      es[i] = pinnedStart(node);
      ef[i] = pinnedFinish(node);
      continue;
    }

    let start = Math.max(today, node.notBefore ?? -Infinity, node.prereqDay ?? -Infinity);
    for (const link of node.preds) {
      const p = nodes[link.node];
      const pFinish = p?.done ? (p.doneDay ?? today) : (ef[link.node] ?? -Infinity);
      start = Math.max(start, pFinish + link.lag);
    }
    es[i] = start;

    if (node.kind === 'work') {
      ef[i] = Math.max(finishIdeal(cap, start, node.minutes), crowdedFinish(i, node.minutes));
    } else if (node.kind === 'wait') {
      ef[i] = start + node.days;
    } else {
      ef[i] = start; // milestone
    }
  }

  // --- backward pass ------------------------------------------------------------------------
  for (let k = topo.length - 1; k >= 0; k--) {
    const i = topo[k] as number;
    const node = nodes[i];
    if (!node || !open(i)) continue;

    let latest = Infinity;
    const order = node.orderIdx >= 0 ? model.orders[node.orderIdx] : undefined;
    if (order) latest = Math.min(latest, order.lastDay);
    if (node.deadline !== null) latest = Math.min(latest, node.deadline);
    for (const link of node.succs) {
      const s = nodes[link.node];
      if (!s || s.done || !open(link.node)) continue;
      latest = Math.min(latest, (ls[link.node] ?? Infinity) - link.lag);
    }
    lf[i] = latest;

    if (isPinned(node)) {
      ls[i] = pinnedStart(node);
    } else if (latest === Infinity) {
      ls[i] = Infinity;
    } else if (node.kind === 'work') {
      ls[i] = startIdeal(cap, latest, node.minutes);
    } else if (node.kind === 'wait') {
      ls[i] = latest - node.days;
    } else {
      ls[i] = latest;
    }
  }

  const slack = nodes.map((_, i) => {
    const earliest = ef[i] ?? -Infinity;
    const latest = lf[i] ?? Infinity;
    if (earliest === Infinity) return -Infinity;
    return latest - earliest;
  });

  // The soonest each order could be ready: after its slowest task, and after all of its unpinned
  // work could have been done. That second part is the same crowding argument as for a single
  // task, applied to the whole order: work that cannot start before a day needs room after it.
  const orderEarliest = model.orders.map(() => -Infinity);
  model.orders.forEach((_, o) => {
    const mine = nodes.filter((node) => node.orderIdx === o && open(node.i));
    let bound = -Infinity;
    for (const node of mine) bound = Math.max(bound, ef[node.i] ?? -Infinity);
    const work = mine.filter((node) => node.kind === 'work' && !isPinned(node));
    for (const from of new Set(work.map((node) => es[node.i] ?? today))) {
      const minutes = work
        .filter((node) => (es[node.i] ?? today) >= from)
        .reduce((sum, node) => sum + node.minutes, 0);
      bound = Math.max(bound, finishIdeal(cap, from, minutes));
    }
    orderEarliest[o] = bound;
  });

  return { open: nodes.map((_, i) => open(i)), es, ef, lf, ls, slack, orderEarliest };
}
