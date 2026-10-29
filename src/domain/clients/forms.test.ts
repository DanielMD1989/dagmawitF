import { describe, expect, it } from 'vitest';
import { CLIENT_CASES } from '../../../test/fixtures/capture-cases';
import { clientProblems, parseClient } from './forms';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

describe('a client', () => {
  // The same cases the database's constraints are tested with, so the two cannot drift apart.
  it.each(CLIENT_CASES)('agrees with the database on $label', ({ client, valid }) => {
    expect(Object.keys(clientProblems(client)).length === 0).toBe(valid);
  });

  it('is read from the form with the spaces trimmed', () => {
    expect(
      parseClient(form({ name: '  Selam Tesfaye ', phone: ' 0911 12 34 56', notes: ' Prefers ivory ' })),
    ).toEqual({
      ok: true,
      value: { name: 'Selam Tesfaye', phone: '0911 12 34 56', notes: 'Prefers ivory' },
    });
  });

  it('needs only a name', () => {
    expect(parseClient(form({ name: 'Hana' }))).toEqual({
      ok: true,
      value: { name: 'Hana', phone: '', notes: '' },
    });
  });

  it('says what is wrong next to each field', () => {
    const result = parseClient(form({ name: '   ', phone: 'call me', notes: 'x'.repeat(2001) }));
    expect(result).toEqual({
      ok: false,
      errors: {
        name: 'Enter her name.',
        phone: 'A phone number has 5 to 30 digits, spaces or + ( ) . - signs.',
        notes: 'Keep the notes under 2000 characters.',
      },
    });
  });
});
