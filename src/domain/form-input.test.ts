import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  asId,
  chars,
  idField,
  isUuid,
  issuesByField,
  parseDecimal,
  parseWholeNumber,
  text,
  ticked,
} from './form-input';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

describe('text and ticked', () => {
  it('trims a field and treats a missing one as empty', () => {
    expect(text(form({ a: '  hello  ' }), 'a')).toBe('hello');
    expect(text(form({}), 'a')).toBe('');
  });

  it('ignores a file where text was expected', () => {
    const data = new FormData();
    data.set('a', new File(['x'], 'x.txt'));
    expect(text(data, 'a')).toBe('');
  });

  it('is ticked only when the box says on', () => {
    expect(ticked(form({ a: 'on' }), 'a')).toBe(true);
    expect(ticked(form({ a: 'yes' }), 'a')).toBe(false);
    expect(ticked(form({}), 'a')).toBe(false);
  });
});

describe('chars', () => {
  it('counts what a person sees as one, as the database does', () => {
    expect(chars('abc')).toBe(3);
    expect(chars('ሰላም')).toBe(3);
    expect(chars('😀')).toBe(1);
    expect(chars('')).toBe(0);
  });
});

describe('numbers she types', () => {
  it.each([
    ['12', 12],
    ['0', 0],
    ['007', 7],
  ])('reads %s as a whole number', (raw, n) => expect(parseWholeNumber(raw)).toBe(n));

  it.each(['', '-1', '1.5', '1e3', ' 3', 'abc', '1234567890'])('refuses %j as a whole number', (raw) =>
    expect(parseWholeNumber(raw)).toBeNull(),
  );

  it.each([
    ['92', 92],
    ['92.5', 92.5],
    ['92,5', 92.5],
    [' 7 ', 7],
    ['0.1', 0.1],
  ])('reads %j as a decimal', (raw, n) => expect(parseDecimal(raw)).toBe(n));

  it.each(['', '-5', '+5', '1e2', '1.2.3', '1,2,3', 'abc', '92 cm', '.5', '5.'])(
    'refuses %j as a decimal',
    (raw) => expect(parseDecimal(raw)).toBeNull(),
  );
});

describe('issuesByField', () => {
  it('keeps the first problem for each field', () => {
    const result = z
      .object({ a: z.string().min(3, 'too short').regex(/x/, 'no x'), b: z.number('not a number') })
      .safeParse({
        a: 'a',
        b: 'q',
      });
    expect(result.success).toBe(false);
    if (!result.success) expect(issuesByField(result.error)).toEqual({ a: 'too short', b: 'not a number' });
  });
});

describe('ids sent by a form', () => {
  const id = '0b6d3d0e-6a5e-4e0e-9a54-3f1a8f6f2f10';

  it('accepts an id, in any capitals, and hands it back in lower case', () => {
    expect(isUuid(id)).toBe(true);
    expect(idField(form({ id }), 'id')).toBe(id);
    expect(idField(form({ id: ` ${id.toUpperCase()} ` }), 'id')).toBe(id);
  });

  it.each([
    '',
    'abc',
    '12',
    `${id}0`,
    `${id.slice(0, -1)}`,
    `x${id}`,
    `${id}; drop table orders`,
    '0b6d3d0e-6a5e-4e0e-9a54-3f1a8f6f2f1g',
  ])('refuses %j', (value) => {
    expect(isUuid(value)).toBe(false);
    expect(idField(form({ id: value }), 'id')).toBeNull();
  });

  it('refuses a field that was not sent', () => {
    expect(idField(form({}), 'id')).toBeNull();
  });
});

describe('ids from the address of a page', () => {
  const id = '0b6d3d0e-6a5e-4e0e-9a54-3f1a8f6f2f10';

  it('accepts an id and refuses anything else', () => {
    expect(asId(id)).toBe(id);
    expect(asId(id.toUpperCase())).toBe(id);
    expect(asId(undefined)).toBeNull();
    expect(asId('')).toBeNull();
    expect(asId('../../settings')).toBeNull();
    expect(asId(`${id}/extra`)).toBeNull();
  });
});
