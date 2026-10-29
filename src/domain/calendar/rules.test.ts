import { describe, expect, it } from 'vitest';
import { WORK_DAY_CASES } from '../../../test/fixtures/work-day-cases';
import { workDayProblem } from './rules';

describe('workDayProblem', () => {
  it.each(WORK_DAY_CASES)('judges $label', ({ day, valid }) => {
    const problem = workDayProblem(day);
    if (valid) expect(problem).toBeNull();
    else expect(problem).toEqual(expect.any(String));
  });

  it('says what is wrong in plain words', () => {
    expect(workDayProblem({ weekday: 1, start: '17:00', end: '09:00', breaks: [] })).toBe(
      'The day must end after it starts.',
    );
    expect(
      workDayProblem({
        weekday: 1,
        start: '08:00',
        end: '17:00',
        breaks: [{ start: '07:00', end: '08:00' }],
      }),
    ).toBe('A break must sit inside the working day.');
  });
});
