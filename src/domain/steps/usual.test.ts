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
        { title: 'delivery for Kati', times: 1 },
      ]).slice(0, 5),
    ).toEqual(['fitting', 'Beading', 'Price tags', 'Appointment', 'Sketch']);
  });

  it('leave out a step she typed only once', () => {
    expect(usualSteps([{ title: 'delivery for Kati', times: 1 }])).toEqual([...COMMON_STEPS]);
  });

  it('offer at most the number asked', () => {
    expect(usualSteps([], 3)).toEqual(['Appointment', 'Sketch', 'Buy fabric']);
  });
});
