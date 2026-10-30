/**
 * What state an order is in, and which moves between states are allowed. This is the one table of
 * moves in the app: the buttons on the order page come from it, and a test compares it with the
 * database's own table (app.order_move_allowed) over every pair, so the two cannot drift apart.
 * The meaning of each status is in docs/capture.md.
 */

export const ORDER_STATUSES = ['draft', 'active', 'on_hold', 'delivered', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value);
}

const MOVES: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  draft: ['active', 'cancelled'],
  active: ['on_hold', 'delivered', 'cancelled'],
  on_hold: ['active', 'cancelled'],
  delivered: ['active'],
  cancelled: ['draft'],
};

/** The statuses an order can move to from `from`. */
export function movesFrom(from: OrderStatus): readonly OrderStatus[] {
  return MOVES[from];
}

export function canMove(from: OrderStatus, to: OrderStatus): boolean {
  return MOVES[from].includes(to);
}

/** Only an active order is planned. A draft promises nothing; a paused or closed order takes none of her time. */
export function isPlanned(status: OrderStatus): boolean {
  return status === 'active';
}

/** A delivered or cancelled order is a record: only its notes change until it is reopened. */
export function isClosed(status: OrderStatus): boolean {
  return status === 'delivered' || status === 'cancelled';
}

export const STATUS_LABEL: Readonly<Record<OrderStatus, string>> = {
  draft: 'Draft',
  active: 'Active',
  on_hold: 'On hold',
  delivered: 'Finished',
  cancelled: 'Cancelled',
};

/** What a person does to move a job (or an event) from one status to another, in the words on the button. */
export function moveLabel(from: OrderStatus, to: OrderStatus, noun: 'job' | 'event' = 'job'): string {
  if (from === 'draft' && to === 'active') return `Confirm the ${noun}`;
  if (from === 'on_hold' && to === 'active') return `Resume the ${noun}`;
  if (to === 'active') return `Reopen the ${noun}`;
  if (to === 'on_hold') return 'Put on hold';
  if (to === 'delivered') return 'Mark as finished';
  if (to === 'cancelled') return `Cancel the ${noun}`;
  return 'Reopen as draft';
}

/** What is said once a move has been made. */
export function moveDone(from: OrderStatus, to: OrderStatus): string {
  if (from === 'draft' && to === 'active') return 'Job confirmed.';
  if (from === 'on_hold' && to === 'active') return 'Job resumed.';
  if (to === 'active') return 'Job reopened.';
  if (to === 'on_hold') return 'Job put on hold.';
  if (to === 'delivered') return 'Job marked as finished.';
  if (to === 'cancelled') return 'Job cancelled.';
  return 'Job reopened as a draft.';
}
