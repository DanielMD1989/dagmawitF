import { describe, expect, it } from 'vitest';
import { BUFFER_CASES, GARMENT_CASES } from '../../../test/fixtures/capture-cases';
import {
  NEW_CLIENT,
  garmentProblems,
  parseGarment,
  parseNewOrder,
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
const ctx = { today, defaultBufferDays: 2 };
const CLIENT_ID = '3f6c2b0e-9d4a-4c1e-8b7a-5e2f1a9c0d11';

const newOrder = (over: Record<string, string> = {}) =>
  form({
    client: CLIENT_ID,
    'delivery-on': '2026-11-20',
    'garment-type': 'Bridal gown',
    intent: 'confirm',
    ...over,
  });

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

describe('a new order', () => {
  it('needs a client, a garment and a handover day, and can be confirmed at once', () => {
    expect(parseNewOrder(newOrder(), ctx)).toEqual({
      ok: true,
      value: {
        client: { kind: 'existing', id: CLIENT_ID },
        number: null,
        deliveryOn: '2026-11-20',
        bufferDays: 2,
        notes: '',
        garmentType: 'Bridal gown',
        brief: '',
        confirm: true,
      },
    });
  });

  it('can be kept as a draft instead', () => {
    expect(parseNewOrder(newOrder({ intent: 'draft' }), ctx)).toMatchObject({
      ok: true,
      value: { confirm: false },
    });
  });

  it('refuses to guess whether to confirm', () => {
    expect(parseNewOrder(newOrder({ intent: '' }), ctx)).toMatchObject({
      ok: false,
      errors: { form: expect.any(String) },
    });
    expect(parseNewOrder(newOrder({ intent: 'whatever' }), ctx).ok).toBe(false);
  });

  it('can add the client on the spot', () => {
    const r = parseNewOrder(
      newOrder({ client: NEW_CLIENT, 'client-name': ' Hana Bekele ', 'client-phone': '0911 22 33 44' }),
      ctx,
    );
    expect(r).toMatchObject({
      ok: true,
      value: { client: { kind: 'new', name: 'Hana Bekele', phone: '0911 22 33 44' } },
    });
  });

  it('checks the new client as it checks any client', () => {
    const r = parseNewOrder(newOrder({ client: NEW_CLIENT, 'client-name': '', 'client-phone': 'abc' }), ctx);
    expect(r).toMatchObject({
      ok: false,
      errors: { 'client-name': 'Enter her name.', 'client-phone': expect.any(String) },
    });
  });

  it('refuses a client that is neither chosen nor new', () => {
    expect(parseNewOrder(newOrder({ client: '' }), ctx)).toMatchObject({
      ok: false,
      errors: { client: expect.any(String) },
    });
    expect(parseNewOrder(newOrder({ client: 'not-an-id' }), ctx)).toMatchObject({
      ok: false,
      errors: { client: expect.any(String) },
    });
  });

  it('uses her usual buffer unless she types one', () => {
    expect(parseNewOrder(newOrder(), { today, defaultBufferDays: 4 })).toMatchObject({
      ok: true,
      value: { bufferDays: 4 },
    });
    expect(parseNewOrder(newOrder({ 'buffer-days': '0' }), { today, defaultBufferDays: 4 })).toMatchObject({
      ok: true,
      value: { bufferDays: 0 },
    });
  });

  it.each(BUFFER_CASES)('agrees with the database on a buffer of $days days', ({ days, valid }) => {
    expect(parseNewOrder(newOrder({ 'buffer-days': String(days) }), ctx).ok).toBe(valid);
  });

  it('keeps the number she types, and ignores an empty one', () => {
    expect(parseNewOrder(newOrder({ number: '105' }), ctx)).toMatchObject({
      ok: true,
      value: { number: 105 },
    });
    expect(parseNewOrder(newOrder({ number: '' }), ctx)).toMatchObject({ ok: true, value: { number: null } });
    for (const bad of ['0', '-3', '1.5', 'abc', '1000000']) {
      expect(parseNewOrder(newOrder({ number: bad }), ctx), bad).toMatchObject({
        ok: false,
        errors: { number: expect.any(String) },
      });
    }
  });

  it('refuses a handover day that has passed, but accepts today', () => {
    expect(parseNewOrder(newOrder({ 'delivery-on': '2026-10-24' }), ctx)).toMatchObject({
      ok: false,
      errors: { 'delivery-on': 'That day has already passed. Choose today or a later day.' },
    });
    expect(parseNewOrder(newOrder({ 'delivery-on': today }), ctx).ok).toBe(true);
  });

  it('refuses a handover day that is not a date', () => {
    for (const bad of ['', 'soon', '2026-02-30', '1999-12-31', '2100-01-01']) {
      expect(parseNewOrder(newOrder({ 'delivery-on': bad }), ctx), bad).toMatchObject({
        ok: false,
        errors: { 'delivery-on': 'Choose a day.' },
      });
    }
  });

  it('reports every problem at once, each next to its field', () => {
    const r = parseNewOrder(
      form({ client: '', 'delivery-on': '', 'garment-type': '', intent: 'draft', 'buffer-days': 'x' }),
      ctx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(Object.keys(r.errors).sort()).toEqual(['buffer-days', 'client', 'delivery-on', 'garment-type']);
  });
});

describe('changing an order', () => {
  const current = (status: 'draft' | 'active' | 'on_hold') => ({ status, deliveryOn: '2026-11-20', today });
  const details = (over: Record<string, string> = {}) =>
    form({ client: CLIENT_ID, 'delivery-on': '2026-11-27', 'buffer-days': '3', notes: ' Wedding ', ...over });

  it('reads the new promise', () => {
    expect(parseOrderDetails(details(), current('active'))).toEqual({
      ok: true,
      value: { clientId: CLIENT_ID, deliveryOn: '2026-11-27', bufferDays: 3, notes: 'Wedding' },
    });
  });

  it('will not move an active order to a day that has passed', () => {
    expect(parseOrderDetails(details({ 'delivery-on': '2026-10-01' }), current('active'))).toMatchObject({
      ok: false,
      errors: { 'delivery-on': expect.any(String) },
    });
  });

  it('lets an active order keep a handover day that has already passed, when it is not the one being changed', () => {
    const passed = { status: 'active' as const, deliveryOn: '2026-10-01', today };
    expect(parseOrderDetails(details({ 'delivery-on': '2026-10-01' }), passed).ok).toBe(true);
  });

  it('lets a draft or paused order be given any day', () => {
    expect(parseOrderDetails(details({ 'delivery-on': '2026-10-01' }), current('draft')).ok).toBe(true);
    expect(parseOrderDetails(details({ 'delivery-on': '2026-10-01' }), current('on_hold')).ok).toBe(true);
  });

  it('needs a buffer here, because there is no "usual" to fall back on', () => {
    expect(parseOrderDetails(details({ 'buffer-days': '' }), current('draft'))).toMatchObject({
      ok: false,
      errors: { 'buffer-days': expect.any(String) },
    });
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
      errors: { 'delivery-on': 'The old handover day has passed. Choose a new one.' },
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
