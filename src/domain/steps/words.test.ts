import { describe, expect, it } from 'vitest';
import type { Step } from './agenda';
import { clashMessage, daysLabel, timeLabel } from './words';

const step = (over: Partial<Step>): Step => ({
  id: 's',
  title: 'Appointment',
  onDay: '2026-11-03',
  untilDay: null,
  startsAt: '14:00',
  endsAt: null,
  doneOn: null,
  job: {
    id: 'j',
    number: 3,
    kind: 'appointment',
    clientName: 'Megan',
    dueOn: '2026-11-03',
    status: 'active',
  },
  ...over,
});

describe('the words of a step', () => {
  it('say its time and its days', () => {
    expect(timeLabel(step({ endsAt: '14:30' }))).toBe('14:00–14:30');
    expect(timeLabel(step({ startsAt: null }))).toBeNull();
    expect(daysLabel(step({ untilDay: '2026-11-05' }))).toBe('Tue 3 Nov – Thu 5 Nov');
  });

  it('name the step whose time is taken, so she can find it', () => {
    expect(clashMessage(step({}))).toBe(
      '14:00 on Tue 3 Nov is taken by “Appointment” (Megan, #3). Choose another time.',
    );
    expect(clashMessage(step({ job: null, title: 'Market', endsAt: '15:00' }))).toBe(
      '14:00–15:00 on Tue 3 Nov is taken by “Market” (your own). Choose another time.',
    );
  });
});
