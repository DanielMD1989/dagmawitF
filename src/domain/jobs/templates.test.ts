import { describe, expect, it } from 'vitest';
import { pickTemplate } from './templates';

const T = [
  { id: 'a', name: 'Appointment', kind: 'appointment' as const },
  { id: 'b', name: 'Bridal gown', kind: 'new_order' as const },
  { id: 'd', name: 'Dress', kind: 'new_order' as const },
  { id: 'e', name: 'Evening dress', kind: 'new_order' as const },
  { id: 'f', name: 'Fix', kind: 'fix' as const },
];

describe('the template a new job starts with', () => {
  it('is the one named like the garment, in any capitals', () => {
    expect(pickTemplate(T, 'new_order', ' bridal GOWN ')?.id).toBe('b');
  });

  it('is else the longest whose name is a word of the garment', () => {
    expect(pickTemplate(T, 'new_order', 'Red evening dress')?.id).toBe('e');
    expect(pickTemplate(T, 'new_order', 'Wedding dress')?.id).toBe('d');
    // Part of a word is not a word.
    expect(pickTemplate(T, 'new_order', 'Dressing gown')?.id).toBe('b');
  });

  it('is else the first of the kind, and never one of another kind', () => {
    expect(pickTemplate(T, 'new_order', 'Habesha kemis')?.id).toBe('b');
    expect(pickTemplate(T, 'new_order', '')?.id).toBe('b');
    expect(pickTemplate(T, 'fix', 'Bridal gown')?.id).toBe('f');
    expect(pickTemplate(T, 'sketch', 'Dress')).toBeNull();
  });
});
