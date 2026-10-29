import { describe, expect, it } from 'vitest';
import {
  isDirection,
  keyFromLabel,
  labelTaken,
  moveField,
  nextSort,
  parseFieldLabel,
  type MeasurementField,
} from './fields';

const field = (over: Partial<MeasurementField>): MeasurementField => ({
  id: '1',
  key: 'bust',
  label: 'Bust',
  sort: 10,
  archived: false,
  ...over,
});

describe('keyFromLabel', () => {
  it.each([
    ['Bust', 'bust'],
    ['Under bust', 'under_bust'],
    ['Back length (neck to waist)', 'back_length_neck_to_waist'],
    ['  Café — hem  ', 'cafe_hem'],
    ['Sleeve length!!!', 'sleeve_length'],
  ])('turns %j into %j', (label, key) => expect(keyFromLabel(label, [])).toBe(key));

  it('starts with a letter', () => {
    expect(keyFromLabel('3/4 sleeve', [])).toBe('m_3_4_sleeve');
  });

  it('gives a plain key to a label with no Latin letters, so the screen can still show the label', () => {
    expect(keyFromLabel('ወገብ', [])).toBe('measurement');
  });

  it('never repeats a key, including one that is hidden', () => {
    expect(keyFromLabel('Bust', ['bust'])).toBe('bust_2');
    expect(keyFromLabel('Bust', ['bust', 'bust_2'])).toBe('bust_3');
    expect(keyFromLabel('ወገብ', ['measurement', 'measurement_2'])).toBe('measurement_3');
  });

  it('stays within 40 characters, even when it has to add a number', () => {
    const long = 'a very long measurement name that keeps going and going';
    const first = keyFromLabel(long, []);
    expect(first.length).toBeLessThanOrEqual(40);
    const second = keyFromLabel(long, [first]);
    expect(second.length).toBeLessThanOrEqual(40);
    expect(second).not.toBe(first);
    expect(second).toMatch(/^[a-z][a-z0-9_]*_2$/);
  });

  it('always makes a key the database accepts', () => {
    for (const label of ['Bust', '  ', '123', '!!!', 'ሰላም', 'A'.repeat(100), 'x y z', 'Å ß ü']) {
      expect(keyFromLabel(label, [])).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
    }
  });
});

describe('a label', () => {
  const form = (label: string) => {
    const data = new FormData();
    data.set('label', label);
    return data;
  };

  it('is trimmed', () => expect(parseFieldLabel(form('  Waist  '))).toEqual({ ok: true, value: 'Waist' }));
  it('is needed', () => expect(parseFieldLabel(form('  '))).toMatchObject({ ok: false }));
  it('is at most 60 characters', () => {
    expect(parseFieldLabel(form('a'.repeat(60))).ok).toBe(true);
    expect(parseFieldLabel(form('a'.repeat(61))).ok).toBe(false);
  });

  it('is taken when a visible field has it, in any capitals', () => {
    const fields = [
      field({ id: '1', label: 'Bust' }),
      field({ id: '2', key: 'old', label: 'Chest', archived: true }),
    ];
    expect(labelTaken('BUST', fields)).toBe(true);
    expect(labelTaken('Chest', fields)).toBe(false); // hidden fields give up their name
    expect(labelTaken('Bust', fields, '1')).toBe(false); // a field may keep its own name
  });
});

describe('moveField', () => {
  const order = ['a', 'b', 'c'];

  it('swaps a field with its neighbour', () => {
    expect(moveField(order, 'b', 'up')).toEqual(['b', 'a', 'c']);
    expect(moveField(order, 'b', 'down')).toEqual(['a', 'c', 'b']);
    expect(moveField(order, 'a', 'down')).toEqual(['b', 'a', 'c']);
    expect(moveField(order, 'c', 'up')).toEqual(['a', 'c', 'b']);
  });

  it('does not change the list it was given', () => {
    moveField(order, 'b', 'up');
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('says nothing needs writing when the field cannot move', () => {
    expect(moveField(order, 'a', 'up')).toBeNull();
    expect(moveField(order, 'c', 'down')).toBeNull();
    expect(moveField(order, 'z', 'up')).toBeNull();
    expect(moveField([], 'a', 'down')).toBeNull();
    expect(moveField(['a'], 'a', 'down')).toBeNull();
  });

  it('knows its two directions', () => {
    expect(isDirection('up')).toBe(true);
    expect(isDirection('down')).toBe(true);
    expect(isDirection('left')).toBe(false);
    expect(isDirection('')).toBe(false);
  });
});

describe('nextSort', () => {
  it('goes after everything she has, hidden fields included', () => {
    expect(nextSort([{ sort: 10 }, { sort: 120 }, { sort: 30 }])).toBe(130);
    expect(nextSort([])).toBe(10);
  });

  it('never goes past what the database accepts', () => {
    expect(nextSort([{ sort: 10_000 }])).toBe(10_000);
  });
});
