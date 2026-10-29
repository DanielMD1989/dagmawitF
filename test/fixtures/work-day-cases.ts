import type { WorkDay } from '../../src/domain/calendar/types';

/**
 * One list of working days and whether each is valid. It is run against the screen's rules
 * (src/domain/calendar/rules.test.ts) and against the database's constraints
 * (test/db/constraints.test.ts). If the two ever disagree, a test fails.
 */
export interface WorkDayCase {
  label: string;
  day: WorkDay;
  valid: boolean;
}

const day = (over: Partial<WorkDay> = {}): WorkDay => ({
  weekday: 1,
  start: '08:00',
  end: '17:00',
  breaks: [],
  ...over,
});
const b = (start: string, end: string) => ({ start, end });

export const WORK_DAY_CASES: WorkDayCase[] = [
  { label: 'a normal day', day: day(), valid: true },
  {
    label: 'a day with a lunch break',
    day: day({ start: '08:30', breaks: [b('12:30', '13:30')] }),
    valid: true,
  },
  { label: 'every weekday from 1 to 7', day: day({ weekday: 7 }), valid: true },
  {
    label: 'breaks that touch each other and the edges of the day',
    day: day({ breaks: [b('08:00', '08:15'), b('08:15', '08:30'), b('16:45', '17:00')] }),
    valid: true,
  },
  {
    label: 'six breaks',
    day: day({ breaks: Array.from({ length: 6 }, (_, i) => b(`${10 + i}:00`, `${10 + i}:10`)) }),
    valid: true,
  },
  { label: 'weekday 0', day: day({ weekday: 0 }), valid: false },
  { label: 'weekday 8', day: day({ weekday: 8 }), valid: false },
  { label: 'a day that ends before it starts', day: day({ start: '17:00', end: '09:00' }), valid: false },
  { label: 'a day with no length', day: day({ start: '09:00', end: '09:00' }), valid: false },
  { label: 'a time with seconds', day: day({ start: '09:00:30' }), valid: false },
  { label: 'a break before the day starts', day: day({ breaks: [b('07:00', '08:00')] }), valid: false },
  { label: 'a break after the day ends', day: day({ breaks: [b('16:30', '17:30')] }), valid: false },
  { label: 'a break that ends before it starts', day: day({ breaks: [b('13:00', '12:00')] }), valid: false },
  {
    label: 'overlapping breaks',
    day: day({ breaks: [b('12:00', '13:00'), b('12:30', '14:00')] }),
    valid: false,
  },
  {
    label: 'breaks out of order',
    day: day({ breaks: [b('15:00', '15:15'), b('12:00', '13:00')] }),
    valid: false,
  },
  {
    label: 'a break time missing its leading zero',
    day: day({ breaks: [b('12:5', '13:00')] }),
    valid: false,
  },
  { label: 'an impossible break time', day: day({ breaks: [b('25:00', '26:00')] }), valid: false },
  {
    label: 'more than six breaks',
    day: day({ breaks: Array.from({ length: 7 }, (_, i) => b(`${10 + i}:00`, `${10 + i}:10`)) }),
    valid: false,
  },
];
