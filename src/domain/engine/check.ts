import { addDays, type IsoDate } from '../dates';
import type { Allocation, PlacedSlot } from './allocate';
import { ancestorSets, compareText, isPinned, pinnedStart, type Model, type Node } from './model';
import type { Passes } from './passes';
import { say } from './explain';
import type {
  OrderPlan,
  OrderState,
  Placement,
  Plan,
  PlannedTask,
  Slot,
  Warning,
  WarningCode,
} from './types';

/**
 * Step 5 of the engine: check every promise against the finished plan, and put the plan
 * together. An order's state is worked out here from what the plan actually contains. It is
 * never stored anywhere, so it cannot go out of date.
 */

const SEVERITY_RANK = { problem: 0, warning: 1, info: 2 } as const;

export function assemblePlan(model: Model, passes: Passes, alloc: Allocation): Plan {
  const { nodes, orders, cap } = model;
  const iso = (d: number): IsoDate => addDays(model.startDate, d);
  const isoOrNull = (d: number): IsoDate | null => (Number.isFinite(d) ? iso(d) : null);
  const orderIdOf = (n: Node): string | null => (n.orderIdx >= 0 ? (orders[n.orderIdx]?.id ?? null) : null);

  const warnings: Warning[] = [];
  const warn = (
    code: WarningCode,
    severity: Warning['severity'],
    orderId: string | null,
    taskId: string | null,
    numbers: Warning['numbers'],
    message: string,
  ) => warnings.push({ code, severity, orderId, taskId, numbers, message });

  const placementOf = (n: Node): Placement => {
    if (n.done) return 'done';
    if (alloc.unplanned[n.i]) return 'unplanned';
    return isPinned(n) ? 'pinned' : 'planned';
  };
  const isOpenPlaced = (n: Node) => !n.done && !alloc.unplanned[n.i] && alloc.spans[n.i] !== null;
  const finishOf = (n: Node): number => alloc.spans[n.i]?.finish ?? -Infinity;

  // --- slots -------------------------------------------------------------------------------
  const ancestors = ancestorSets(model);
  const slots: Slot[] = [];
  const byDay = new Map<number, PlacedSlot[]>();
  for (const s of alloc.slots) byDay.set(s.day, [...(byDay.get(s.day) ?? []), s]);
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    const here = byDay.get(day) as PlacedSlot[];
    // Every task comes after the tasks it follows. Among those free to go next, fixed events
    // come first, by clock time, and then the work, the most urgent first.
    const isEvent = (s: PlacedSlot) => (nodes[s.node] as Node).fixedDay !== null;
    const ordered: PlacedSlot[] = [];
    const remaining = new Set(here);
    while (remaining.size > 0) {
      const ready = [...remaining].filter(
        (s) => ![...remaining].some((o) => o !== s && ancestors[s.node]?.has(o.node)),
      );
      ready.sort((a, b) => {
        if (isEvent(a) !== isEvent(b)) return isEvent(a) ? -1 : 1;
        const [x, y] = [nodes[a.node] as Node, nodes[b.node] as Node];
        if (isEvent(a)) return compareText(x.fixedTime ?? '', y.fixedTime ?? '') || compareText(x.id, y.id);
        return (alloc.sequence[a.node] ?? 0) - (alloc.sequence[b.node] ?? 0) || compareText(x.id, y.id);
      });
      const next = ready[0] as PlacedSlot;
      ordered.push(next);
      remaining.delete(next);
    }
    ordered.forEach((s, index) => {
      const node = nodes[s.node] as Node;
      const slot: Slot = { taskId: node.id, day: iso(s.day), minutes: s.minutes, rank: index + 1 };
      if (node.fixedDay !== null && node.fixedTime !== null) slot.time = node.fixedTime;
      slots.push(slot);
    });
  }

  // --- tasks that are not planned ----------------------------------------------------------
  for (const n of nodes) {
    const why = alloc.unplanned[n.i];
    if (!why) continue;
    const orderId = orderIdOf(n);
    switch (why.code) {
      case 'task_on_hold':
        warn(
          'task_on_hold',
          'warning',
          orderId,
          n.id,
          {},
          say.taskOnHold({ title: n.title, reason: why.detail }),
        );
        break;
      case 'fixed_undated':
        warn('fixed_undated', 'warning', orderId, n.id, {}, say.fixedUndated({ title: n.title }));
        break;
      case 'prerequisite_undated':
        warn(
          'prerequisite_undated',
          'warning',
          orderId,
          n.id,
          { waitingFor: why.detail },
          say.prerequisiteUndated({ title: n.title, waitingFor: why.detail }),
        );
        break;
      case 'predecessor_unplanned':
        warn(
          'predecessor_unplanned',
          'warning',
          orderId,
          n.id,
          { predecessor: why.detail },
          say.predecessorUnplanned({ title: n.title, predecessor: why.detail }),
        );
        break;
      case 'no_room_in_calendar':
        warn(
          'no_room_in_calendar',
          'problem',
          orderId,
          n.id,
          { minutes: n.minutes },
          say.noRoomInCalendar({ title: n.title, detail: why.detail }),
        );
        break;
    }
  }

  // --- things she set by hand, on closed or full days ---------------------------------------
  for (const s of alloc.slots) {
    const n = nodes[s.node] as Node;
    if (isPinned(n) && (cap[s.day] ?? 0) === 0) {
      warn(
        'pinned_on_closed_day',
        'info',
        orderIdOf(n),
        n.id,
        { day: iso(s.day), minutes: s.minutes },
        say.pinnedOnClosedDay({ title: n.title, day: iso(s.day) }),
      );
    }
  }
  cap.forEach((usable, d) => {
    const pinned = alloc.pinnedLoad[d] ?? 0;
    if (usable > 0 && pinned > usable) {
      warn(
        'pinned_over_capacity',
        'info',
        null,
        null,
        { day: iso(d), pinned, usable },
        say.pinnedOverCapacity({ day: iso(d), pinned, usable }),
      );
    }
  });

  // --- pinned tasks that start before the work they need ------------------------------------
  for (const b of nodes) {
    if (!isPinned(b) || alloc.unplanned[b.i]) continue;

    // What it needs that is not there: the material it waits for, or work that is not planned.
    // The task stays where she put it; she is told what stands in its way.
    for (const label of b.undated) {
      warn(
        'prerequisite_undated',
        'warning',
        orderIdOf(b),
        b.id,
        { waitingFor: label, pinnedDay: iso(pinnedStart(b)) },
        say.pinnedPrerequisiteUndated({ title: b.title, pinnedDay: iso(pinnedStart(b)), waitingFor: label }),
      );
    }
    if (b.prereqDay !== null && b.prereqLabel !== null && b.prereqDay > pinnedStart(b)) {
      warn(
        'fixed_before_prerequisite',
        'problem',
        orderIdOf(b),
        b.id,
        {
          pinnedDay: iso(pinnedStart(b)),
          waitingFor: b.prereqLabel,
          expectedOn: iso(b.prereqDay),
          shortfallDays: b.prereqDay - pinnedStart(b),
        },
        say.fixedBeforePrerequisite({
          title: b.title,
          pinnedDay: iso(pinnedStart(b)),
          waitingFor: b.prereqLabel,
          expectedOn: iso(b.prereqDay),
        }),
      );
    }

    for (const link of b.preds) {
      const a = nodes[link.node] as Node;
      if (!a.done && alloc.unplanned[a.i]) {
        warn(
          'predecessor_unplanned',
          'warning',
          orderIdOf(b),
          b.id,
          { predecessor: a.title, pinnedDay: iso(pinnedStart(b)) },
          say.pinnedPredecessorUnplanned({
            title: b.title,
            pinnedDay: iso(pinnedStart(b)),
            predecessor: a.title,
          }),
        );
        continue;
      }
      const span = alloc.spans[a.i];
      if (!span) continue;
      const earliest = span.finish + link.lag;
      if (earliest <= pinnedStart(b)) continue;
      const allowedFinish = pinnedStart(b) - link.lag;
      const minutesToFree =
        isOpenPlaced(a) && !isPinned(a)
          ? alloc.slots
              .filter((s) => s.node === a.i && s.day > allowedFinish)
              .reduce((sum, s) => sum + s.minutes, 0)
          : 0;
      const numbers = {
        pinnedDay: iso(pinnedStart(b)),
        predecessorFinish: iso(span.finish),
        lagDays: link.lag,
        shortfallDays: earliest - pinnedStart(b),
        minutesToFree,
      };
      warn(
        'fixed_before_predecessor',
        'problem',
        orderIdOf(b),
        b.id,
        { ...numbers, predecessor: a.title },
        say.fixedBeforePredecessor({
          title: b.title,
          pinnedDay: numbers.pinnedDay,
          predecessor: a.title,
          predecessorFinish: numbers.predecessorFinish,
          lagDays: link.lag,
          okFrom: iso(earliest),
          minutesToFree,
        }),
      );
    }
  }

  // --- tasks that finish after the latest day, at the first task of each chain ---------------
  const lateBy = (n: Node): number =>
    isOpenPlaced(n) && Number.isFinite(passes.lf[n.i]) ? finishOf(n) - (passes.lf[n.i] as number) : 0;
  for (const n of nodes) {
    if (lateBy(n) <= 0) continue;
    if (n.preds.some((l) => lateBy(nodes[l.node] as Node) > 0)) continue; // a consequence, not a cause
    let eligibleStart = Math.max(model.today, n.notBefore ?? -Infinity);
    for (const l of n.preds) {
      const span = alloc.spans[l.node];
      if (span) eligibleStart = Math.max(eligibleStart, span.finish + l.lag);
    }
    const waiting = n.prereqDay !== null && n.prereqLabel !== null && n.prereqDay > eligibleStart;
    const latest = passes.lf[n.i] as number;
    const numbers: Warning['numbers'] = {
      finish: iso(finishOf(n)),
      latestFinish: iso(latest),
      lateDays: lateBy(n),
    };
    if (waiting) {
      numbers.waitingFor = n.prereqLabel as string;
      numbers.expectedOn = iso(n.prereqDay as number);
    }
    warn(
      'task_after_latest_finish',
      'warning',
      orderIdOf(n),
      n.id,
      numbers,
      say.taskAfterLatestFinish({
        title: n.title,
        finish: iso(finishOf(n)),
        latest: iso(latest),
        lateDays: lateBy(n),
        waitingFor: waiting ? (n.prereqLabel as string) : null,
        expectedOn: waiting ? iso(n.prereqDay as number) : null,
      }),
    );
  }

  // --- each order's promise ----------------------------------------------------------------
  const readyDay: number[] = [];
  const earliestDay: number[] = [];
  const completeFlag: boolean[] = [];
  const infeasibleFlag: boolean[] = [];
  const hasOpen: boolean[] = [];

  orders.forEach((order, o) => {
    const mine = nodes.filter((n) => n.orderIdx === o);
    // The tasks the plan set out to do. One that found no room is still among them: its order
    // is then the clearest case of all for "cannot be made", not a reason to say nothing.
    const open = mine.filter((n) => passes.open[n.i]);
    const finishes = mine.filter((n) => alloc.spans[n.i] !== null).map(finishOf);
    const ready = finishes.length > 0 ? Math.max(...finishes) : -Infinity;
    const doneFinish = Math.max(-Infinity, ...mine.filter((n) => n.done).map(finishOf));
    const earliest = open.length > 0 ? Math.max(passes.orderEarliest[o] ?? -Infinity, doneFinish) : ready;
    // Beyond the end of the calendar we cannot tell, so only a bound the calendar can prove counts.
    const bound = passes.orderEarliest[o] ?? -Infinity;
    const infeasible =
      open.length > 0 &&
      bound > order.deliveryDay - 1 &&
      (Number.isFinite(bound) || order.deliveryDay <= model.horizon);

    readyDay[o] = ready;
    earliestDay[o] = earliest;
    completeFlag[o] = mine.every((n) => n.done || !alloc.unplanned[n.i]);
    infeasibleFlag[o] = infeasible;
    hasOpen[o] = open.length > 0;
    if (open.length === 0) return;

    if (infeasible) {
      const limiting = open.find((n) => passes.ef[n.i] === passes.orderEarliest[o]) ?? (open[0] as Node);
      let lateWorkingDays: number | null = null;
      if (Number.isFinite(earliest)) {
        lateWorkingDays = 0;
        for (let d = order.deliveryDay; d <= earliest; d++) if ((cap[d] ?? 0) > 0) lateWorkingDays++;
      }
      const earliestIso = isoOrNull(earliest);
      const workMinutes = open.reduce(
        (sum, n) => sum + (n.kind === 'work' || n.kind === 'fixed' ? n.minutes : 0),
        0,
      );
      let availableMinutes = 0;
      for (let d = model.today; d < order.deliveryDay; d++) availableMinutes += cap[d] ?? 0;
      const numbers: Warning['numbers'] = {
        deliveryOn: iso(order.deliveryDay),
        earliestReadyOn: earliestIso ?? 'beyond the planning calendar',
        limitedBy: limiting.title,
        workMinutes,
        availableMinutes,
      };
      if (Number.isFinite(earliest)) {
        numbers.lateDays = earliest - (order.deliveryDay - 1);
        numbers.lateWorkingDays = lateWorkingDays as number;
      }
      warn(
        'order_cannot_make_delivery',
        'problem',
        order.id,
        null,
        numbers,
        say.orderCannotMakeDelivery({
          label: order.label,
          deliveryOn: iso(order.deliveryDay),
          earliest: earliestIso,
          lateWorkingDays,
          limitedBy: limiting.title,
          workMinutes,
          availableMinutes,
        }),
      );
      return;
    }

    // With a task left out there is no day on which everything is finished. What can still be
    // said is when the work that is planned ends: if that is already too late, the order is late.
    const complete = completeFlag[o] ?? true;
    const finishKey = complete ? 'readyOn' : 'plannedWorkFinishesOn';
    if (ready > order.deliveryDay - 1) {
      warn(
        'order_late',
        'problem',
        order.id,
        null,
        {
          [finishKey]: iso(ready),
          deliveryOn: iso(order.deliveryDay),
          lateDays: ready - (order.deliveryDay - 1),
        },
        say.orderLate({
          label: order.label,
          finish: iso(ready),
          complete,
          deliveryOn: iso(order.deliveryDay),
          lateDays: ready - (order.deliveryDay - 1),
        }),
      );
    } else if (ready > order.lastDay) {
      warn(
        'buffer_used',
        'warning',
        order.id,
        null,
        {
          [finishKey]: iso(ready),
          lastWorkDay: iso(order.lastDay),
          bufferDays: order.bufferDays,
          daysIntoBuffer: ready - order.lastDay,
        },
        say.bufferUsed({
          label: order.label,
          finish: iso(ready),
          complete,
          bufferDays: order.bufferDays,
          intoBuffer: ready - order.lastDay,
        }),
      );
    }
    if (ready > order.lastDay && Number.isFinite(earliest) && earliest <= order.lastDay) {
      warn(
        'capacity_shared',
        'warning',
        order.id,
        null,
        { [finishKey]: iso(ready), earliestReadyOn: iso(earliest) },
        say.capacityShared({
          label: order.label,
          earliest: iso(earliest),
          finish: iso(ready),
          complete,
        }),
      );
    }
  });

  warnings.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      compareText(a.orderId ?? '', b.orderId ?? '') ||
      compareText(a.taskId ?? '', b.taskId ?? '') ||
      compareText(a.code, b.code) ||
      compareText(String(a.numbers.day ?? ''), String(b.numbers.day ?? '')),
  );

  // --- the chain that sets each order's ready day --------------------------------------------
  const chains = orders.map((_, o) => criticalChain(model, alloc, o));
  const onChain = new Set(chains.flat());

  // --- tasks --------------------------------------------------------------------------------
  const tasks: PlannedTask[] = nodes.map((n) => {
    const placed = alloc.spans[n.i];
    const span = placed && !alloc.unplanned[n.i] ? placed : null;
    const planned = !n.done && span !== null;
    const lf = passes.lf[n.i] ?? Infinity;
    return {
      id: n.id,
      orderId: orderIdOf(n),
      placement: placementOf(n),
      start: span ? iso(span.start) : null,
      finish: span ? iso(span.finish) : null,
      earliestFinish: planned ? isoOrNull(passes.ef[n.i] ?? NaN) : null,
      latestFinish: planned ? isoOrNull(lf) : null,
      slackDays: planned && Number.isFinite(lf) && span ? lf - span.finish : null,
      critical: onChain.has(n.id),
    };
  });

  // --- orders -------------------------------------------------------------------------------
  const orderPlans: OrderPlan[] = orders.map((order, o) => {
    const ready = readyDay[o] ?? -Infinity;
    const complete = completeFlag[o] ?? true;
    const reasons = warnings.filter((w) => w.orderId === order.id && w.severity !== 'info');
    let state: OrderState = 'on_track';
    if (infeasibleFlag[o]) state = 'infeasible';
    else if (reasons.length > 0) state = 'at_risk';
    return {
      id: order.id,
      state,
      // Only a promise when every task is in the plan.
      readyOn: complete ? isoOrNull(ready) : null,
      earliestReadyOn: hasOpen[o] || Number.isFinite(ready) ? isoOrNull(earliestDay[o] ?? NaN) : null,
      lastWorkDay: iso(order.lastDay),
      slackDays: complete && Number.isFinite(ready) ? order.lastDay - ready : null,
      complete,
      reasons,
    };
  });

  return {
    today: iso(model.today),
    slots,
    tasks,
    orders: orderPlans,
    critical: chains.flat(),
    warnings,
  };
}

/**
 * The tasks, first to last, that decide when an order is ready: start from the task that
 * finishes last and keep stepping back to the predecessor that finishes latest. Only tasks
 * still to do are on it.
 */
function criticalChain(model: Model, alloc: Allocation, orderIdx: number): string[] {
  const { nodes } = model;
  const open = nodes.filter(
    (n) => n.orderIdx === orderIdx && !n.done && !alloc.unplanned[n.i] && alloc.spans[n.i] !== null,
  );
  const finish = (n: Node) => alloc.spans[n.i]?.finish ?? -Infinity;
  let current = open.reduce<Node | null>(
    (best, n) => (best === null || finish(n) > finish(best) ? n : best),
    null,
  );
  const chain: string[] = [];
  while (current) {
    chain.push(current.id);
    let next: Node | null = null;
    let nextKey = -Infinity;
    for (const link of current.preds) {
      const p = nodes[link.node] as Node;
      if (p.done || alloc.unplanned[p.i] || alloc.spans[p.i] === null) continue;
      const key = finish(p) + link.lag;
      if (key > nextKey) {
        next = p;
        nextKey = key;
      }
    }
    current = next;
  }
  return chain.reverse();
}
