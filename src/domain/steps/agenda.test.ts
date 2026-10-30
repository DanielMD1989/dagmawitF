import { describe, expect, it } from 'vitest';
import { buildAgenda, entriesOn, jobWarnings, monthCounts, type JobRef, type Step } from './agenda';

const TODAY = '2026-11-02';
const JOB: JobRef = {
  id: 'j1',
  number: 7,
  kind: 'new_order',
  clientName: 'Hana',
  dueOn: '2026-11-20',
  status: 'active',
};

let n = 0;
const step = (over: Partial<Step> = {}): Step => ({
  id: `s${++n}`,
  title: `Step ${n}`,
  onDay: null,
  untilDay: null,
  startsAt: null,
  endsAt: null,
  doneOn: null,
  job: JOB,
  ...over,
});

describe('her calendar', () => {
  it('puts each step on its day, and a step over several days on each of them', () => {
    const cut = step({ title: 'Cutting', onDay: '2026-11-02' });
    const sew = step({ title: 'Sewing', onDay: '2026-11-03', untilDay: '2026-11-05' });
    const a = buildAgenda([cut, sew], TODAY, 5);
    expect(a.days.map((d) => [d.day, d.entries.map((e) => [e.step.title, e.part])])).toEqual([
      ['2026-11-02', [['Cutting', null]]],
      ['2026-11-03', [['Sewing', { n: 1, of: 3 }]]],
      ['2026-11-04', [['Sewing', { n: 2, of: 3 }]]],
      ['2026-11-05', [['Sewing', { n: 3, of: 3 }]]],
      ['2026-11-06', []],
    ]);
  });

  it('lists what is overdue first, oldest first; a step over days only once its last day has passed', () => {
    const old = step({ title: 'Old', onDay: '2026-10-20' });
    const older = step({ title: 'Older', onDay: '2026-10-10' });
    const running = step({ title: 'Running', onDay: '2026-10-30', untilDay: '2026-11-03' });
    const done = step({ title: 'Done', onDay: '2026-10-25', doneOn: '2026-10-25' });
    const a = buildAgenda([old, older, running, done], TODAY, 1);
    expect(a.overdue.map((s) => s.title)).toEqual(['Older', 'Old']);
    expect(a.days[0]!.entries.map((e) => e.step.title)).toEqual(['Running']);
  });

  it('keeps a done step on its day, ticked, and never overdue', () => {
    const done = step({ title: 'Cutting', onDay: TODAY, doneOn: TODAY });
    const a = buildAgenda([done], TODAY, 1);
    expect(a.overdue).toEqual([]);
    expect(a.days[0]!.entries[0]!.step.doneOn).toBe(TODAY);
  });

  it('orders a day by time first, then by the soonest job', () => {
    const later = { ...JOB, id: 'j2', dueOn: '2026-12-01' };
    const steps = [
      step({ title: 'Untimed, later job', onDay: TODAY, job: later }),
      step({ title: 'Untimed, sooner job', onDay: TODAY }),
      step({ title: 'At two', onDay: TODAY, startsAt: '14:00' }),
      step({ title: 'At nine', onDay: TODAY, startsAt: '09:00' }),
      step({ title: 'Studio', onDay: TODAY, job: null }),
    ];
    expect(entriesOn(steps, TODAY).map((e) => e.step.title)).toEqual([
      'At nine',
      'At two',
      'Untimed, sooner job',
      'Untimed, later job',
      'Studio',
    ]);
  });

  it('marks steps whose times overlap, an hour long when they have no end', () => {
    const steps = [
      step({ title: 'Fitting', onDay: TODAY, startsAt: '10:00', endsAt: '11:00' }),
      step({ title: 'Appointment', onDay: TODAY, startsAt: '10:30' }),
      step({ title: 'After', onDay: TODAY, startsAt: '11:30' }),
      step({ title: 'Done one', onDay: TODAY, startsAt: '10:00', doneOn: TODAY }),
    ];
    // Same time: by title. A done step clashes with nothing; 11:30 starts as the appointment's hour ends.
    expect(entriesOn(steps, TODAY).map((e) => [e.step.title, e.clash])).toEqual([
      ['Done one', false],
      ['Fitting', true],
      ['Appointment', true],
      ['After', false],
    ]);
  });

  it('shows only confirmed jobs and her studio work; lists steps with no day apart', () => {
    const steps = [
      step({ title: 'Draft', onDay: TODAY, job: { ...JOB, status: 'draft' } }),
      step({ title: 'On hold', onDay: TODAY, job: { ...JOB, status: 'on_hold' } }),
      step({ title: 'Delivered', onDay: '2026-10-01', job: { ...JOB, status: 'delivered' } }),
      step({ title: 'No day' }),
      step({ title: 'Studio', onDay: TODAY, job: null }),
    ];
    const a = buildAgenda(steps, TODAY, 1);
    expect(a.days[0]!.entries.map((e) => e.step.title)).toEqual(['Studio']);
    expect(a.overdue).toEqual([]);
    expect(a.undated.map((s) => s.title)).toEqual(['No day']);
  });

  it('counts open steps on each day of a month, steps over days on each', () => {
    const counts = monthCounts(
      [
        step({ onDay: '2026-10-30', untilDay: '2026-11-02' }),
        step({ onDay: '2026-11-02' }),
        step({ onDay: '2026-11-02', doneOn: '2026-11-02' }),
        step({ onDay: '2026-11-30', untilDay: '2026-12-02' }),
      ],
      '2026-11-01',
      '2026-11-30',
    );
    expect(Object.fromEntries(counts)).toEqual({ '2026-11-01': 1, '2026-11-02': 2, '2026-11-30': 1 });
  });
});

describe('what a job tells her', () => {
  it('names a step after its day, and one that was due and is not done', () => {
    expect(
      jobWarnings(
        [
          step({ title: 'Late lace', onDay: '2026-11-21' }),
          step({ title: 'Long sewing', onDay: '2026-11-18', untilDay: '2026-11-22' }),
          step({ title: 'Missed', onDay: '2026-11-01' }),
          step({ title: 'Fine', onDay: '2026-11-10' }),
          step({ title: 'Missed but done', onDay: '2026-11-01', doneOn: '2026-11-01' }),
        ],
        '2026-11-20',
        TODAY,
      ),
    ).toEqual([
      '“Late lace” is after the job’s day.',
      '“Long sewing” is after the job’s day.',
      '“Missed” was due and is not done.',
    ]);
  });
});
