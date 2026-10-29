import { describe, expect, it } from 'vitest';
import { failure, fieldTicked, fieldValue, idle, success, typedIn } from './action-state';

describe('typedIn', () => {
  it('gives back every text field, and leaves files out', () => {
    const data = new FormData();
    data.set('name', 'Dagmawit');
    data.set('works-1', 'on');
    data.set('photo', new File(['x'], 'x.png'));
    expect(typedIn(data)).toEqual({ name: 'Dagmawit', 'works-1': 'on' });
  });

  it('omits what was not submitted, which is how an unticked box looks', () => {
    expect(typedIn(new FormData())).toEqual({});
  });
});

describe('fieldValue', () => {
  const saved = '08:30';

  it('shows the saved value when nothing was refused', () => {
    expect(fieldValue(idle, 'start-1', saved)).toBe('08:30');
    expect(fieldValue(success('Saved.'), 'start-1', saved)).toBe('08:30');
    expect(fieldValue(failure('No.', { a: 'b' }), 'start-1', saved)).toBe('08:30');
  });

  it('shows what she typed when the form was refused, even if she emptied the field', () => {
    const refused = failure('No.', {}, { 'start-1': '17:00', 'end-1': '' });
    expect(fieldValue(refused, 'start-1', saved)).toBe('17:00');
    expect(fieldValue(refused, 'end-1', '17:00')).toBe('');
    expect(fieldValue(refused, 'never-sent', saved)).toBe('');
  });
});

describe('fieldTicked', () => {
  it('shows the saved state when nothing was refused', () => {
    expect(fieldTicked(idle, 'works-6', true)).toBe(true);
    expect(fieldTicked(idle, 'works-6', false)).toBe(false);
  });

  it('keeps a box ticked, or unticked, as she left it when the form was refused', () => {
    const refused = failure('No.', {}, { 'works-6': 'on' });
    expect(fieldTicked(refused, 'works-6', false)).toBe(true);
    expect(fieldTicked(refused, 'works-1', true)).toBe(false); // she had unticked Monday
  });
});
