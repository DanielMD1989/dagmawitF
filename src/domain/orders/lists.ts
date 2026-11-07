import { daysBetween, formatDay, type IsoDate } from '../dates';
import { isDeliveryStep } from '../steps/agenda';
import { clock } from '../steps/words';
import type { OrderStatus } from './status';

/**
 * Her orders as the Orders page lists them (decision 0090): customer orders only (an event is not an order, it has
 * its own list), under two tabs. Active: what she is working through, drafts and paused ones included, soonest first.
 * History: what is finished or cancelled, newest first, by month.
 */

export interface Listed {
  status: OrderStatus;
  deliveryOn: IsoDate;
  deliveredOn: IsoDate | null;
  /** Null for an event. */
  clientName: string | null;
  number: number;
}

export type OrdersTab = 'active' | 'history';

export function tabOf(status: OrderStatus): OrdersTab {
  return status === 'delivered' || status === 'cancelled' ? 'history' : 'active';
}

/** The day an order in History is filed under: when it was handed over, or, cancelled, the day it was due. */
export function historyDay(o: Pick<Listed, 'deliveredOn' | 'deliveryOn'>): IsoDate {
  return o.deliveredOn ?? o.deliveryOn;
}

/** Active: soonest due first, then by number. */
export function activeOrders<O extends Listed>(orders: readonly O[]): O[] {
  return orders
    .filter((o) => o.clientName !== null && tabOf(o.status) === 'active')
    .sort((a, b) =>
      a.deliveryOn < b.deliveryOn ? -1 : a.deliveryOn > b.deliveryOn ? 1 : a.number - b.number,
    );
}

const monthTitle = (day: IsoDate) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(
    new Date(`${day}T00:00:00Z`),
  );

/** History: newest first, in months ("November 2026"). */
export function historyByMonth<O extends Listed>(orders: readonly O[]): { month: string; orders: O[] }[] {
  const closed = orders
    .filter((o) => o.clientName !== null && tabOf(o.status) === 'history')
    .sort((a, b) => {
      const da = historyDay(a);
      const db = historyDay(b);
      return da > db ? -1 : da < db ? 1 : b.number - a.number;
    });
  const months: { month: string; orders: O[] }[] = [];
  for (const o of closed) {
    const month = monthTitle(historyDay(o));
    const last = months.at(-1);
    if (last?.month === month) last.orders.push(o);
    else months.push({ month, orders: [o] });
  }
  return months;
}

/** "Delivered Tue 3 Nov · on time", "· 2 days late", "· 1 day early"; "Cancelled · was due Fri 6 Nov". */
export function handoverWords(o: Pick<Listed, 'status' | 'deliveredOn' | 'deliveryOn'>): string {
  if (o.status === 'cancelled') return `Cancelled · was due ${formatDay(o.deliveryOn)}`;
  if (!o.deliveredOn) return `Due ${formatDay(o.deliveryOn)}`;
  const late = daysBetween(o.deliveryOn, o.deliveredOn);
  const when =
    late === 0
      ? 'on time'
      : late > 0
        ? `${late} day${late === 1 ? '' : 's'} late`
        : `${-late} day${late === -1 ? '' : 's'} early`;
  return `Delivered ${formatDay(o.deliveredOn)} · ${when}`;
}

/** Her events (decision 0090): coming, soonest first; and past or closed, newest first. */
export function eventsList<O extends Listed>(
  orders: readonly O[],
  today: IsoDate,
): { coming: O[]; past: O[] } {
  const events = orders.filter((o) => o.clientName === null);
  const isPast = (o: O) => tabOf(o.status) === 'history' || o.deliveryOn < today;
  return {
    coming: events
      .filter((o) => !isPast(o))
      .sort((a, b) => (a.deliveryOn < b.deliveryOn ? -1 : a.deliveryOn > b.deliveryOn ? 1 : 0)),
    past: events
      .filter(isPast)
      .sort((a, b) => (a.deliveryOn > b.deliveryOn ? -1 : a.deliveryOn < b.deliveryOn ? 1 : 0)),
  };
}

/** A step of an order, as its "Next" needs it. */
export interface OpenStep {
  id: string;
  title: string;
  onDay: IsoDate | null;
  startsAt: string | null;
  doneOn: IsoDate | null;
  sort: number;
}

/** What comes next for an order in progress (decision 0092). */
export type NextUp =
  | {
      kind: 'step';
      stepId: string;
      title: string;
      onDay: IsoDate;
      startsAt: string | null;
      /** The order's own Delivery, with no other step left: it can be delivered now (decision 0097). */
      deliverNow: boolean;
    }
  | { kind: 'undated'; title: string }
  | { kind: 'delivery'; onDay: IsoDate }
  | { kind: 'event'; onDay: IsoDate };

/**
 * The next thing to do for an order: its next step not done, by day and then time (its Delivery step among them,
 * decision 0096); a step with no day yet when none has one; and, every step done, the delivery itself, or for an
 * event its day. Never a step already done.
 */
export function nextUp(steps: readonly OpenStep[], deliveryOn: IsoDate, isEvent = false): NextUp {
  const open = steps.filter((s) => s.doneOn === null);
  const dated = open
    .filter((s) => s.onDay !== null)
    .sort(
      (a, b) =>
        a.onDay!.localeCompare(b.onDay!) ||
        // On one day, a step with a time comes first, by its time; then the rest in her order.
        (a.startsAt ?? '99').localeCompare(b.startsAt ?? '99') ||
        a.sort - b.sort,
    );
  const first = dated[0];
  if (first)
    return {
      kind: 'step',
      stepId: first.id,
      title: first.title,
      onDay: first.onDay!,
      startsAt: first.startsAt,
      deliverNow: !isEvent && open.length === 1 && isDeliveryStep(first.title),
    };
  const undated = [...open].sort((a, b) => a.sort - b.sort)[0];
  if (undated) return { kind: 'undated', title: undated.title };
  // An event is not delivered: what comes is its day.
  return isEvent ? { kind: 'event', onDay: deliveryOn } : { kind: 'delivery', onDay: deliveryOn };
}

/**
 * "Next: Fitting, Thu 12 Nov · 10:30 AM", "Next: Sketch, no day yet", "Next: Delivery, Fri 13 Nov"; for an event with
 * nothing left to prepare, "Event day: Sat 14 Nov".
 */
export function nextWords(next: NextUp): string {
  if (next.kind === 'undated') return `Next: ${next.title}, no day yet`;
  if (next.kind === 'delivery') return `Next: Delivery, ${formatDay(next.onDay)}`;
  if (next.kind === 'event') return `Event day: ${formatDay(next.onDay)}`;
  return `Next: ${next.title}, ${formatDay(next.onDay)}${next.startsAt ? ` · ${clock(next.startsAt)}` : ''}`;
}

/** It was for a day that has passed: said in the late colour. */
export function nextIsLate(next: NextUp, today: IsoDate): boolean {
  return next.kind !== 'undated' && next.onDay < today;
}
