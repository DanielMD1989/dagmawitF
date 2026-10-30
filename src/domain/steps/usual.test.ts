import { describe, expect, it } from 'vitest';
import { COMMON_STEPS, usualSteps } from './usual';

describe('her usual steps', () => {
  it('start with the common ones', () => {
    expect(usualSteps([])).toEqual([...COMMON_STEPS]);
  });

  it('put hers first, most used first, without repeating one in other capitals', () => {
    expect(
      usualSteps([
        { title: 'Beading', times: 2 },
        { title: 'fitting', times: 5 },
        { title: 'Price tags', times: 2 },
      ]).slice(0, 5),
    ).toEqual(['fitting', 'Beading', 'Price tags', 'Appointment', 'Sketch']);
  });

  it('offer at most the number asked', () => {
    expect(usualSteps([], 3)).toEqual(['Appointment', 'Sketch', 'Buy fabric']);
  });
});
