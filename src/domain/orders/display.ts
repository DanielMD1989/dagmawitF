import { daysBetween, type IsoDate } from '../dates';

/** "Order #105, bridal gown": what an order is called in sentences (and, later, in the engine's messages). */
export function orderLabel(number: number, garmentTypes: readonly string[]): string {
  const base = `Order #${number}`;
  if (garmentTypes.length === 0) return base;
  const first = garmentTypes[0]!;
  const lower = first.charAt(0).toLowerCase() + first.slice(1);
  return garmentTypes.length === 1
    ? `${base}, ${lower}`
    : `${base}, ${lower} and ${garmentTypes.length - 1} more`;
}

/** The title of an order's page: "#105 · Bridal gown". */
export function orderTitle(number: number, garmentTypes: readonly string[]): string {
  if (garmentTypes.length === 0) return `#${number}`;
  const rest = garmentTypes.length > 1 ? ` + ${garmentTypes.length - 1} more` : '';
  return `#${number} · ${garmentTypes[0]}${rest}`;
}

export interface Handover {
  /** "in 12 days", "tomorrow", "today", "yesterday", "3 days ago". */
  text: string;
  /** The day has passed. */
  past: boolean;
  /** Days from today; negative when it has passed. */
  days: number;
}

export function describeHandover(deliveryOn: IsoDate, today: IsoDate): Handover {
  const days = daysBetween(today, deliveryOn);
  const text =
    days === 0
      ? 'today'
      : days === 1
        ? 'tomorrow'
        : days === -1
          ? 'yesterday'
          : days > 0
            ? `in ${days} days`
            : `${-days} days ago`;
  return { text, past: days < 0, days };
}
