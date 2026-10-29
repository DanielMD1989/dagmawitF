import { describe, expect, it } from 'vitest';
import {
  ORDER_STATUSES,
  STATUS_LABEL,
  canMove,
  isClosed,
  isOrderStatus,
  isPlanned,
  moveDone,
  moveLabel,
  movesFrom,
  type OrderStatus,
} from './status';

// The agreed table (docs/capture.md). Written out in full here so the code cannot quietly drift from it;
// the database's own copy is compared with the code in test/db/orders.test.ts.
const ALLOWED: ReadonlyArray<readonly [OrderStatus, OrderStatus]> = [
  ['draft', 'active'],
  ['draft', 'cancelled'],
  ['active', 'on_hold'],
  ['active', 'delivered'],
  ['active', 'cancelled'],
  ['on_hold', 'active'],
  ['on_hold', 'cancelled'],
  ['delivered', 'active'],
  ['cancelled', 'draft'],
];

describe('the moves between statuses', () => {
  const pairs = ORDER_STATUSES.flatMap((from) => ORDER_STATUSES.map((to) => [from, to] as const));

  it.each(pairs)('%s to %s', (from, to) => {
    const expected = ALLOWED.some(([f, t]) => f === from && t === to);
    expect(canMove(from, to)).toBe(expected);
  });

  it('lists exactly the allowed moves', () => {
    const listed = ORDER_STATUSES.flatMap((from) => movesFrom(from).map((to) => [from, to]));
    expect(listed).toEqual(expect.arrayContaining(ALLOWED.map((p) => [...p])));
    expect(listed).toHaveLength(ALLOWED.length);
  });

  it('never leaves an order stuck: every status can be left, and every status can be reached', () => {
    for (const status of ORDER_STATUSES) {
      expect(movesFrom(status).length, `from ${status}`).toBeGreaterThan(0);
      expect(
        ORDER_STATUSES.some((from) => canMove(from, status)),
        `to ${status}`,
      ).toBe(true);
    }
  });

  it('never moves an order to the status it already has', () => {
    for (const status of ORDER_STATUSES) expect(canMove(status, status)).toBe(false);
  });

  it('makes delivery an explicit action: only an active order can be delivered', () => {
    expect(ORDER_STATUSES.filter((from) => canMove(from, 'delivered'))).toEqual(['active']);
  });
});

describe('what a status means', () => {
  it('plans only active orders', () => {
    expect(ORDER_STATUSES.filter(isPlanned)).toEqual(['active']);
  });

  it('treats delivered and cancelled as closed', () => {
    expect(ORDER_STATUSES.filter(isClosed)).toEqual(['delivered', 'cancelled']);
  });

  it('knows its own statuses', () => {
    for (const s of ORDER_STATUSES) expect(isOrderStatus(s)).toBe(true);
    for (const s of ['Active', 'in_progress', '', null, 3, undefined]) expect(isOrderStatus(s)).toBe(false);
  });

  it('has words for every status', () => {
    for (const s of ORDER_STATUSES) expect(STATUS_LABEL[s].length).toBeGreaterThan(0);
  });
});

describe('the buttons', () => {
  it('say what they do, and two moves to the same place can read differently', () => {
    expect(moveLabel('draft', 'active')).toBe('Confirm order');
    expect(moveLabel('on_hold', 'active')).toBe('Resume order');
    expect(moveLabel('delivered', 'active')).toBe('Reopen order');
    expect(moveLabel('active', 'on_hold')).toBe('Put on hold');
    expect(moveLabel('active', 'delivered')).toBe('Mark as delivered');
    expect(moveLabel('active', 'cancelled')).toBe('Cancel order');
    expect(moveLabel('cancelled', 'draft')).toBe('Reopen as draft');
  });

  it('give every allowed move its own words', () => {
    for (const [from, to] of ALLOWED)
      expect(moveLabel(from, to).length, `${from} to ${to}`).toBeGreaterThan(0);
  });
});

describe('what is said after a move', () => {
  it('names what happened, in the past', () => {
    expect(moveDone('draft', 'active')).toBe('Order confirmed.');
    expect(moveDone('on_hold', 'active')).toBe('Order resumed.');
    expect(moveDone('delivered', 'active')).toBe('Order reopened.');
    expect(moveDone('active', 'on_hold')).toBe('Order put on hold.');
    expect(moveDone('active', 'delivered')).toBe('Order marked as delivered.');
    expect(moveDone('draft', 'cancelled')).toBe('Order cancelled.');
    expect(moveDone('cancelled', 'draft')).toBe('Order reopened as a draft.');
  });

  it('gives each button its own confirmation', () => {
    const buttons = ALLOWED.map(([from, to]) => moveLabel(from, to));
    const done = ALLOWED.map(([from, to]) => moveDone(from, to));
    // Cancelling a draft, an active and an on-hold order are three buttons with one meaning.
    expect(new Set(done).size).toBe(new Set(buttons).size);
  });
});
