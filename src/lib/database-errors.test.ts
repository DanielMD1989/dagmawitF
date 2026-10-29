import { describe, expect, it } from 'vitest';
import { constraintOf, ruleMessage, violates } from './database-errors';

describe('constraintOf', () => {
  it.each([
    ['duplicate key value violates unique constraint "orders_number_key"', 'orders_number_key'],
    [
      'update or delete on table "client" violates foreign key constraint "orders_client_fk" on table "orders"',
      'orders_client_fk',
    ],
    [
      'new row for relation "orders" violates check constraint "orders_hold_reason_matches"',
      'orders_hold_reason_matches',
    ],
    ['an order needs at least one garment before it is confirmed', null],
  ])('reads %s', (message, expected) => {
    expect(constraintOf({ message })).toBe(expected);
  });
});

describe('violates', () => {
  const taken = {
    code: '23505',
    message: 'duplicate key value violates unique constraint "orders_number_key"',
  };

  it('is true only for the constraint named', () => {
    expect(violates(taken, 'orders_number_key')).toBe(true);
    expect(violates(taken, 'orders_client_fk')).toBe(false);
  });

  it('is false when nothing went wrong, or when the refusal names no constraint', () => {
    expect(violates(null, 'orders_number_key')).toBe(false);
    expect(violates({ message: 'permission denied' }, 'orders_number_key')).toBe(false);
  });
});

describe('ruleMessage', () => {
  it('turns one of the database rules into a sentence', () => {
    expect(
      ruleMessage({ code: '23514', message: 'an order needs at least one garment before it is confirmed' }),
    ).toBe('An order needs at least one garment before it is confirmed.');
    expect(ruleMessage({ code: '23514', message: 'the handover day has passed; choose a new one' })).toBe(
      'The handover day has passed; choose a new one.',
    );
  });

  it('does not add a second full stop', () => {
    expect(ruleMessage({ code: '23514', message: 'this order is delivered or cancelled.' })).toBe(
      'This order is delivered or cancelled.',
    );
  });

  it('leaves a table check to the caller, because it is not written for her', () => {
    expect(
      ruleMessage({
        code: '23514',
        message: 'new row for relation "orders" violates check constraint "orders_hold_reason_matches"',
      }),
    ).toBeNull();
  });

  it('leaves other kinds of refusal alone', () => {
    expect(
      ruleMessage({ code: '23505', message: 'duplicate key value violates unique constraint "x"' }),
    ).toBeNull();
    expect(ruleMessage({ code: '42501', message: 'permission denied' })).toBeNull();
    expect(ruleMessage({ message: 'connection refused' })).toBeNull();
    expect(ruleMessage({ code: '23514', message: '  ' })).toBeNull();
  });
});
