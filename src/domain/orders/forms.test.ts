import { describe, expect, it } from 'vitest';
import { GARMENT_CASES } from '../../../test/fixtures/capture-cases';
import {
  NEW_CLIENT,
  garmentProblems,
  parseGarment,
  NO_CLIENT,
  parseNewJob,
  parseOrderDetails,
  parseOrderNotes,
  parseTransition,
} from './forms';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

const today = '2026-10-25';
const ctx = { today };
const CLIENT_ID = '3f6c2b0e-9d4a-4c1e-8b7a-5e2f1a9c0d11';

describe('a garment', () => {
  // The same cases the database's constraints are tested with, so the two cannot drift apart.
  it.each(GARMENT_CASES)('agrees with the database on $label', ({ garment, valid }) => {
    expect(Object.keys(garmentProblems(garment)).length === 0).toBe(valid);
  });

  it('is read from the form', () => {
    expect(parseGarment(form({ 'garment-type': ' Veil ', brief: ' Cathedral length ' }))).toEqual({
      ok: true,
      value: { garmentType: 'Veil', brief: 'Cathedral length' },
    });
    expect(parseGarment(form({}))).toMatchObject({
      ok: false,
      errors: { 'garment-type': expect.any(String) },
    });
  });
});

const newJob = (over: Record<string, string> = {}) =>
  form({
    client: CLIENT_ID,
    title: 'Bridal gown',
    'due-on': '2026-11-20',
    steps: '2',
    'step-0-title': 'Appointment',
    'step-0-day': '2026-10-27',
    'step-0-from': '14:00',
    'step-0-to': '14:30',
    'step-1-title': 'Delivery',
    'step-1-day': '2026-11-20',
    ...over,
  });

describe('a new job', () => {
  it('for a client: what it is, its day, and the steps she built with their days', () => {
    expect(parseNewJob(newJob(), ctx)).toEqual({
      ok: true,
      value: {
        client: { kind: 'existing', id: CLIENT_ID },
        number: null,
        title: 'Bridal gown',
        dueOn: '2026-11-20',
        notes: '',
        brief: '',
        steps: [
          { title: 'Appointment', onDay: '2026-10-27', untilDay: null, startsAt: '14:00', endsAt: '14:30' },
          { title: 'Delivery', onDay: '2026-11-20', untilDay: null, startsAt: null, endsAt: null },
        ],
      },
    });
  });

  it('for a client may go without a title or steps', () => {
    expect(parseNewJob(newJob({ title: '', steps: '0' }), ctx)).toMatchObject({
      ok: true,
      value: { title: '', steps: [] },
    });
  });

  it('for nobody is an event, and needs a name; it keeps no brief', () => {
    expect(
      parseNewJob(newJob({ client: NO_CLIENT, title: 'Bazaar at the Hyatt', brief: 'x' }), ctx),
    ).toMatchObject({
      ok: true,
      value: { client: { kind: 'none' }, title: 'Bazaar at the Hyatt', brief: '' },
    });
    expect(parseNewJob(newJob({ client: NO_CLIENT, title: '' }), ctx)).toMatchObject({
      ok: false,
      errors: { title: 'Give the event a name, for example “Bazaar at the Hyatt”.' },
    });
  });

  it('says what is wrong with a step next to it', () => {
    expect(parseNewJob(newJob({ 'step-0-to': '13:00' }), ctx)).toMatchObject({
      ok: false,
      errors: { 'step-0-to': 'The end comes after the start.' },
    });
  });

  it('can add the client on the spot', () => {
    const r = parseNewJob(
      newJob({ client: NEW_CLIENT, 'client-name': ' Hana Bekele ', 'client-phone': '0911 22 33 44' }),
      ctx,
    );
    expect(r).toMatchObject({
      ok: true,
      value: { client: { kind: 'new', name: 'Hana Bekele', phone: '0911 22 33 44' } },
    });
  });

  it('checks the new client as it checks any client', () => {
    const r = parseNewJob(newJob({ client: NEW_CLIENT, 'client-name': '', 'client-phone': 'abc' }), ctx);
    expect(r).toMatchObject({
      ok: false,
      errors: { 'client-name': 'Enter her name.', 'client-phone': expect.any(String) },
    });
  });

  it('refuses a client that is neither chosen, new nor none', () => {
    for (const client of ['', 'not-an-id']) {
      expect(parseNewJob(newJob({ client }), ctx)).toMatchObject({
        ok: false,
        errors: { client: expect.any(String) },
      });
    }
  });

  it('keeps the number she types, and ignores an empty one', () => {
    expect(parseNewJob(newJob({ number: '105' }), ctx)).toMatchObject({ ok: true, value: { number: 105 } });
    expect(parseNewJob(newJob({ number: '' }), ctx)).toMatchObject({ ok: true, value: { number: null } });
    for (const bad of ['0', '-3', '1.5', 'abc', '1000000']) {
      expect(parseNewJob(newJob({ number: bad }), ctx), bad).toMatchObject({
        ok: false,
        errors: { number: expect.any(String) },
      });
    }
  });

  it('refuses a day that has passed, but accepts today', () => {
    expect(parseNewJob(newJob({ 'due-on': '2026-10-24' }), ctx)).toMatchObject({
      ok: false,
      errors: { 'due-on': 'That day has already passed. Choose today or a later day.' },
    });
    expect(parseNewJob(newJob({ 'due-on': today }), ctx).ok).toBe(true);
  });

  it('refuses a day that is not a date', () => {
    for (const bad of ['', 'soon', '2026-02-30', '1999-12-31', '2100-01-01']) {
      expect(parseNewJob(newJob({ 'due-on': bad }), ctx), bad).toMatchObject({
        ok: false,
        errors: { 'due-on': 'Choose a day.' },
      });
    }
  });

  it('reports every problem at once, each next to its field', () => {
    const r = parseNewJob(form({ client: '', 'due-on': '', title: 'x'.repeat(121) }), ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['client', 'due-on', 'title']);
  });
});

describe('changing a job', () => {
  const current = (status: 'draft' | 'active' | 'on_hold') => ({ status, dueOn: '2026-11-20', today });
  const details = (over: Record<string, string> = {}) =>
    form({ client: CLIENT_ID, title: 'Trousers', 'due-on': '2026-11-27', notes: ' Wedding ', ...over });

  it('reads who it is for, what it is, the new day, and whether the steps move with it', () => {
    expect(parseOrderDetails(details(), current('active'))).toEqual({
      ok: true,
      value: {
        clientId: CLIENT_ID,
        title: 'Trousers',
        dueOn: '2026-11-27',
        moveSteps: false,
        notes: 'Wedding',
      },
    });
    expect(parseOrderDetails(details({ 'move-steps': 'on' }), current('active'))).toMatchObject({
      ok: true,
      value: { moveSteps: true },
    });
  });

  it('may become an event, with a name', () => {
    expect(
      parseOrderDetails(details({ client: NO_CLIENT, title: 'Bazaar' }), current('active')),
    ).toMatchObject({
      ok: true,
      value: { clientId: null, title: 'Bazaar' },
    });
    expect(parseOrderDetails(details({ client: NO_CLIENT, title: '' }), current('active'))).toMatchObject({
      ok: false,
      errors: { title: expect.any(String) },
    });
    expect(parseOrderDetails(details({ client: 'x' }), current('active'))).toMatchObject({
      ok: false,
      errors: { client: expect.any(String) },
    });
  });

  it('will not move an active job to a day that has passed', () => {
    expect(parseOrderDetails(details({ 'due-on': '2026-10-01' }), current('active'))).toMatchObject({
      ok: false,
      errors: { 'due-on': expect.any(String) },
    });
  });

  it('lets an active job keep a day that has already passed, when it is not the one being changed', () => {
    const passed = { status: 'active' as const, dueOn: '2026-10-01', today };
    expect(parseOrderDetails(details({ 'due-on': '2026-10-01' }), passed).ok).toBe(true);
  });

  it('lets a draft or paused job be given any day', () => {
    expect(parseOrderDetails(details({ 'due-on': '2026-10-01' }), current('draft')).ok).toBe(true);
    expect(parseOrderDetails(details({ 'due-on': '2026-10-01' }), current('on_hold')).ok).toBe(true);
  });
});

describe('moving an order between statuses', () => {
  const at = { today, deliveryOn: '2026-11-20' };
  const move = (to: string, extra: Record<string, string> = {}) => form({ to, ...extra });

  it('refuses a move that is not allowed', () => {
    expect(parseTransition(move('delivered'), 'draft', at)).toEqual({
      ok: false,
      errors: { form: 'That change is not possible for this order.' },
    });
    expect(parseTransition(move('nonsense'), 'active', at).ok).toBe(false);
    expect(parseTransition(move('active'), 'active', at).ok).toBe(false);
  });

  it('confirms with the handover day it already has, if that has not passed', () => {
    expect(parseTransition(move('active'), 'draft', at)).toEqual({ ok: true, value: { to: 'active' } });
  });

  it('asks for a new handover day when the old one has passed, and takes one that has not', () => {
    const stale = { today, deliveryOn: '2026-10-01' };
    expect(parseTransition(move('active'), 'delivered', stale)).toMatchObject({
      ok: false,
      errors: { 'delivery-on': 'The old day has passed. Choose a new one.' },
    });
    expect(parseTransition(move('active', { 'delivery-on': '2026-11-05' }), 'delivered', stale)).toEqual({
      ok: true,
      value: { to: 'active', deliveryOn: '2026-11-05' },
    });
    expect(parseTransition(move('active', { 'delivery-on': '2026-10-02' }), 'delivered', stale).ok).toBe(
      false,
    );
  });

  it('needs a reason to put an order on hold', () => {
    expect(parseTransition(move('on_hold'), 'active', at)).toMatchObject({
      ok: false,
      errors: { reason: expect.any(String) },
    });
    expect(parseTransition(move('on_hold', { reason: ' Client is abroad ' }), 'active', at)).toEqual({
      ok: true,
      value: { to: 'on_hold', holdReason: 'Client is abroad' },
    });
    expect(parseTransition(move('on_hold', { reason: 'r'.repeat(301) }), 'active', at).ok).toBe(false);
  });

  it('does not need a reason to cancel, but keeps one if given', () => {
    expect(parseTransition(move('cancelled'), 'draft', at)).toEqual({
      ok: true,
      value: { to: 'cancelled', cancelReason: '' },
    });
    expect(parseTransition(move('cancelled', { reason: 'Changed her mind' }), 'active', at)).toEqual({
      ok: true,
      value: { to: 'cancelled', cancelReason: 'Changed her mind' },
    });
  });

  it('delivers today unless she says another day, and never in the future', () => {
    expect(parseTransition(move('delivered'), 'active', at)).toEqual({
      ok: true,
      value: { to: 'delivered', deliveredOn: today },
    });
    expect(parseTransition(move('delivered', { 'delivered-on': '2026-10-20' }), 'active', at)).toEqual({
      ok: true,
      value: { to: 'delivered', deliveredOn: '2026-10-20' },
    });
    expect(parseTransition(move('delivered', { 'delivered-on': '2026-10-26' }), 'active', at)).toMatchObject({
      ok: false,
      errors: { 'delivered-on': expect.any(String) },
    });
  });

  it('reopens a cancelled order as a draft with nothing else to say', () => {
    expect(parseTransition(move('draft'), 'cancelled', at)).toEqual({ ok: true, value: { to: 'draft' } });
  });
});

describe('the notes of an order', () => {
  it('are read as typed, trimmed', () => {
    expect(parseOrderNotes(form({ notes: '  Collected by her sister  ' }))).toEqual({
      ok: true,
      value: 'Collected by her sister',
    });
  });

  it('may be empty, and a missing field reads as empty', () => {
    expect(parseOrderNotes(form({ notes: '' }))).toEqual({ ok: true, value: '' });
    expect(parseOrderNotes(form({}))).toEqual({ ok: true, value: '' });
  });

  it('are limited to 4000 characters, counted as a person counts them', () => {
    expect(parseOrderNotes(form({ notes: '😀'.repeat(4000) })).ok).toBe(true);
    expect(parseOrderNotes(form({ notes: '😀'.repeat(4001) }))).toMatchObject({
      ok: false,
      errors: { notes: 'Keep the notes under 4000 characters.' },
    });
  });
});
