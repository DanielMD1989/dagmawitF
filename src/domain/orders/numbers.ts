import { addDays, daysBetween, isoWeekday, type IsoDate } from '../dates';
import type { OrderStatus } from './status';

/**
 * How her orders are going (decision 0091): how many she takes and hands over each week or month, how many on time,
 * how long an order takes, what is in hand now, and who orders most. Customer orders only: an event is not an order.
 * Pure: the page reads the orders, this counts.
 */

export type Period = 'week' | 'month';

export interface Counted {
  status: OrderStatus;
  /** Null for an event. */
  clientName: string | null;
  /** The day it was taken, on her calendar. */
  takenOn: IsoDate;
  deliveryOn: IsoDate;
  deliveredOn: IsoDate | null;
}

export interface Bucket {
  /** The first day of the week or month. */
  start: IsoDate;
  /** "2 Nov" for a week, "Nov" for a month. */
  label: string;
  /** "Week of 2 Nov 2026", "November 2026". */
  long: string;
  taken: number;
  delivered: number;
}

export interface OrderNumbers {
  period: Period;
  /** Oldest first; the last is this week or month. */
  buckets: Bucket[];
  /** Of the orders handed over in these weeks or months: how many by the day promised. */
  onTime: { delivered: number; onTime: number };
  /** Days from taking an order to handing it over, on average over the same span; null with none handed over. */
  averageDays: number | null;
  cancelled: number;
  /** What is in hand today. */
  now: { active: number; late: number; drafts: number; onHold: number };
  /** Who ordered most in the span, most first; ties by name. */
  topClients: { name: string; orders: number }[];
}

/** How many weeks or months are shown. */
export const SPAN = 12;

const fmt = (opts: Intl.DateTimeFormatOptions, day: IsoDate) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...opts }).format(new Date(`${day}T00:00:00Z`));

/** The first day of the week (Monday) or month a day is in. */
export function periodStart(day: IsoDate, period: Period): IsoDate {
  return period === 'week' ? addDays(day, 1 - isoWeekday(day)) : `${day.slice(0, 8)}01`;
}

function nextStart(start: IsoDate, period: Period): IsoDate {
  if (period === 'week') return addDays(start, 7);
  const y = Number(start.slice(0, 4));
  const m = Number(start.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

function previousStart(start: IsoDate, period: Period): IsoDate {
  if (period === 'week') return addDays(start, -7);
  return periodStart(addDays(start, -1), 'month');
}

export function orderNumbers(all: readonly Counted[], today: IsoDate, period: Period): OrderNumbers {
  const orders = all.filter((o) => o.clientName !== null);
  const starts: IsoDate[] = [periodStart(today, period)];
  while (starts.length < SPAN) starts.unshift(previousStart(starts[0]!, period));
  const from = starts[0]!;
  const end = nextStart(starts.at(-1)!, period);
  const inSpan = (day: IsoDate | null): day is IsoDate => day !== null && day >= from && day < end;
  const bucketOf = (day: IsoDate) => starts.indexOf(periodStart(day, period));

  const buckets: Bucket[] = starts.map((start) => ({
    start,
    label:
      period === 'week' ? fmt({ day: 'numeric', month: 'short' }, start) : fmt({ month: 'short' }, start),
    long:
      period === 'week'
        ? `Week of ${fmt({ day: 'numeric', month: 'short', year: 'numeric' }, start)}`
        : fmt({ month: 'long', year: 'numeric' }, start),
    taken: 0,
    delivered: 0,
  }));
  for (const o of orders) {
    if (inSpan(o.takenOn)) buckets[bucketOf(o.takenOn)]!.taken++;
    if (o.status === 'delivered' && inSpan(o.deliveredOn)) buckets[bucketOf(o.deliveredOn)]!.delivered++;
  }

  const handedOver = orders.filter((o) => o.status === 'delivered' && inSpan(o.deliveredOn));
  const days = handedOver.map((o) => Math.max(0, daysBetween(o.takenOn, o.deliveredOn!)));
  const byClient = new Map<string, number>();
  for (const o of orders)
    if (inSpan(o.takenOn)) byClient.set(o.clientName!, (byClient.get(o.clientName!) ?? 0) + 1);

  return {
    period,
    buckets,
    onTime: {
      delivered: handedOver.length,
      onTime: handedOver.filter((o) => o.deliveredOn! <= o.deliveryOn).length,
    },
    averageDays: days.length === 0 ? null : Math.round(days.reduce((a, b) => a + b, 0) / days.length),
    cancelled: orders.filter((o) => o.status === 'cancelled' && inSpan(o.takenOn)).length,
    now: {
      active: orders.filter((o) => o.status === 'active').length,
      late: orders.filter((o) => o.status === 'active' && o.deliveryOn < today).length,
      drafts: orders.filter((o) => o.status === 'draft').length,
      onHold: orders.filter((o) => o.status === 'on_hold').length,
    },
    topClients: [...byClient]
      .map(([name, n]) => ({ name, orders: n }))
      .sort((a, b) => b.orders - a.orders || a.name.localeCompare(b.name))
      .slice(0, 5),
  };
}

/** "3 more than last week", "2 fewer than last month", "the same as last week". */
export function compared(now: number, before: number, period: Period): string {
  const last = `last ${period}`;
  if (now === before) return `the same as ${last}`;
  const d = Math.abs(now - before);
  return `${d} ${now > before ? 'more' : 'fewer'} than ${last}`;
}
