import { describe, expect, it } from 'vitest';
import type { OrderStatus } from './status';
import {
  activeOrders,
  eventsList,
  handoverWords,
  historyByMonth,
  nextIsLate,
  nextUp,
  nextWords,
  tabOf,
  type Listed,
  type OpenStep,
} from './lists';

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

describe('what comes next for an order (decision 0092)', () => {
  let sort = 0;
  const step = (over: Partial<OpenStep>): OpenStep => ({
    title: 'Step',
    onDay: null,
    startsAt: null,
    doneOn: null,
    sort: (sort += 10),
    ...over,
  });
  const due = '2026-11-13';

  it('is the next step not done, never the one she just ticked', () => {
    const steps = [
      step({ title: 'Appointment', onDay: '2026-11-03', doneOn: '2026-11-03' }),
      step({ title: 'Fitting', onDay: '2026-11-10', startsAt: '10:30' }),
      step({ title: 'Sewing', onDay: '2026-11-08' }),
    ];
    expect(nextWords(nextUp(steps, due))).toBe('Next: Sewing, Sun 8 Nov');
  });

  it('on one day, the step with a time first', () => {
    const steps = [
      step({ title: 'Press', onDay: '2026-11-08' }),
      step({ title: 'Fitting', onDay: '2026-11-08', startsAt: '10:30' }),
    ];
    expect(nextWords(nextUp(steps, due))).toBe('Next: Fitting, Sun 8 Nov · 10:30 AM');
  });

  it('is a step with no day yet, when no step has a day', () => {
    const steps = [
      step({ title: 'Cutting', onDay: '2026-11-03', doneOn: '2026-11-03' }),
      step({ title: 'Sketch' }),
    ];
    expect(nextWords(nextUp(steps, due))).toBe('Next: Sketch, no day yet');
  });

  it('is the delivery itself once every step is done, or with no steps', () => {
    expect(nextWords(nextUp([step({ onDay: '2026-11-03', doneOn: '2026-11-03' })], due))).toBe(
      'Next: Delivery, Fri 13 Nov',
    );
    expect(nextUp([], due)).toEqual({ kind: 'delivery', onDay: due });
  });

  it('is late when its day has passed; a step with no day never is', () => {
    expect(
      nextIsLate({ kind: 'step', title: 'Sewing', onDay: '2026-11-02', startsAt: null }, '2026-11-03'),
    ).toBe(true);
    expect(nextIsLate({ kind: 'delivery', onDay: '2026-11-03' }, '2026-11-03')).toBe(false);
    expect(nextIsLate({ kind: 'undated', title: 'Sketch' }, '2026-11-03')).toBe(false);
  });
});
