import { describe, expect, it } from 'vitest';
import type { OrderStatus } from './status';
import { activeOrders, eventsList, handoverWords, historyByMonth, tabOf, type Listed } from './lists';

let n = 0;
const o = (over: Partial<Listed> & { status: OrderStatus }): Listed => ({
  deliveryOn: '2026-11-10',
  deliveredOn: null,
  clientName: 'Selam',
  number: ++n,
  ...over,
});

describe('the Orders tabs (decision 0090)', () => {
  it('puts drafts, active and paused orders under Active; finished and cancelled under History', () => {
    expect((['draft', 'active', 'on_hold'] as const).map(tabOf)).toEqual(['active', 'active', 'active']);
    expect((['delivered', 'cancelled'] as const).map(tabOf)).toEqual(['history', 'history']);
  });

  it('lists customer orders only, soonest first: an event is not an order', () => {
    const later = o({ status: 'active', deliveryOn: '2026-11-20' });
    const sooner = o({ status: 'draft', deliveryOn: '2026-11-05' });
    const event = o({ status: 'active', clientName: null, deliveryOn: '2026-11-01' });
    const done = o({ status: 'delivered', deliveredOn: '2026-11-01' });
    expect(activeOrders([later, sooner, event, done])).toEqual([sooner, later]);
  });

  it('files History by month, newest first, by the day each was handed over', () => {
    const oct = o({ status: 'delivered', deliveryOn: '2026-10-30', deliveredOn: '2026-10-31' });
    const nov = o({ status: 'delivered', deliveryOn: '2026-11-02', deliveredOn: '2026-11-03' });
    const cancelled = o({ status: 'cancelled', deliveryOn: '2026-11-01' });
    const event = o({ status: 'delivered', clientName: null, deliveredOn: '2026-11-03' });
    expect(historyByMonth([oct, cancelled, nov, event])).toEqual([
      { month: 'November 2026', orders: [nov, cancelled] },
      { month: 'October 2026', orders: [oct] },
    ]);
  });
});

describe('how a handover is said', () => {
  it('says on time, late or early by the day it was due', () => {
    const said = (deliveredOn: string) =>
      handoverWords({ status: 'delivered', deliveryOn: '2026-11-03', deliveredOn });
    expect(said('2026-11-03')).toBe('Delivered Tue 3 Nov · on time');
    expect(said('2026-11-05')).toBe('Delivered Thu 5 Nov · 2 days late');
    expect(said('2026-11-02')).toBe('Delivered Mon 2 Nov · 1 day early');
    expect(handoverWords({ status: 'cancelled', deliveryOn: '2026-11-06', deliveredOn: null })).toBe(
      'Cancelled · was due Fri 6 Nov',
    );
  });
});

describe('her events (decision 0090)', () => {
  it('are coming, soonest first, until their day has passed or they are closed', () => {
    const today = '2026-11-03';
    const show = o({ status: 'active', clientName: null, deliveryOn: '2026-11-20' });
    const bazaar = o({ status: 'active', clientName: null, deliveryOn: '2026-11-03' });
    const lastWeek = o({ status: 'active', clientName: null, deliveryOn: '2026-10-27' });
    const cancelled = o({ status: 'cancelled', clientName: null, deliveryOn: '2026-11-25' });
    const order = o({ status: 'active' });
    expect(eventsList([show, bazaar, lastWeek, cancelled, order], today)).toEqual({
      coming: [bazaar, show],
      past: [cancelled, lastWeek],
    });
  });
});
