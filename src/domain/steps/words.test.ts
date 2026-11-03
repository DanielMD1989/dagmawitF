import { describe, expect, it } from 'vitest';
import { canBePartDone, type Step } from './agenda';
import { clashMessage, clock, daysLabel, partDoneLabel, timeLabel } from './words';

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
    title: '',
    clientName: 'Megan',
    dueOn: '2026-11-03',
    status: 'active',
  },
  ...over,
});

describe('the words of a step', () => {
  it('say its time and its days', () => {
    expect(timeLabel(step({ endsAt: '14:30' }))).toBe('2:00–2:30 PM');
    expect(timeLabel(step({ startsAt: '11:30', endsAt: '13:00' }))).toBe('11:30 AM–1:00 PM');
    expect(timeLabel(step({}))).toBe('2:00 PM');
    expect(timeLabel(step({ startsAt: null }))).toBeNull();
    expect(daysLabel(step({ untilDay: '2026-11-05' }))).toBe('Tue 3 Nov – Thu 5 Nov');
  });

  it('name the step whose time is taken, so she can find it', () => {
    expect(clashMessage(step({}))).toBe(
      '2:00 PM on Tue 3 Nov is taken by “Appointment” (Megan, #3). Choose another time.',
    );
    expect(clashMessage(step({ job: null, title: 'Market', endsAt: '15:00' }))).toBe(
      '2:00–3:00 PM on Tue 3 Nov is taken by “Market” (your own). Choose another time.',
    );
  });
});

describe('the 12-hour clock', () => {
  it.each([
    ['00:00', '12:00 AM'],
    ['00:15', '12:15 AM'],
    ['09:05', '9:05 AM'],
    ['12:00', '12:00 PM'],
    ['13:30', '1:30 PM'],
    ['23:59', '11:59 PM'],
  ])('%s is %s', (time, words) => {
    expect(clock(time)).toBe(words);
  });
});

describe('a step part done (decision 0087)', () => {
  it('says since when, and what is left when she said it', () => {
    expect(partDoneLabel({ doneOn: null, startedOn: '2026-11-02', leftNote: 'Bodice and sleeves' })).toBe(
      'Part done Mon 2 Nov · left: Bodice and sleeves',
    );
    expect(partDoneLabel({ doneOn: null, startedOn: '2026-11-02', leftNote: null })).toBe(
      'Part done Mon 2 Nov',
    );
  });

  it('says nothing once it is done, or when it was never started', () => {
    expect(partDoneLabel({ doneOn: '2026-11-03', startedOn: '2026-11-02', leftNote: 'x' })).toBeNull();
    expect(partDoneLabel({ doneOn: null, startedOn: null, leftNote: null })).toBeNull();
  });

  it('is offered for any open step but a Delivery, in any capitals', () => {
    expect(canBePartDone({ title: 'Sewing', doneOn: null })).toBe(true);
    expect(canBePartDone({ title: 'Sewing', doneOn: '2026-11-02' })).toBe(false);
    expect(canBePartDone({ title: 'DELIVERY', doneOn: null })).toBe(false);
  });
});
