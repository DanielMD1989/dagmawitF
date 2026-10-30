import { describe, expect, it } from 'vitest';
import { buildAgenda, type JobRef, type Step } from './agenda';
import {
  addTap,
  isForToday,
  makeSnapshot,
  replayReport,
  returnPath,
  undoTap,
  withWaiting,
  type WaitingTap,
} from './offline';

const TODAY = '2026-11-02';
const OWNER = 'owner-1';
const JOB: JobRef = {
  id: 'j',
  number: 7,
  kind: 'new_order',
  clientName: 'Hana',
  dueOn: '2026-11-20',
  status: 'active',
};
const step = (over: Partial<Step>): Step => ({
  id: 's',
  title: 'Step',
  onDay: null,
  untilDay: null,
  startsAt: null,
  endsAt: null,
  doneOn: null,
  job: JOB,
  ...over,
});

const steps = [
  step({ id: 'late', title: 'Buy lace', onDay: '2026-10-30' }),
  step({ id: 'fit', title: 'Fitting', onDay: TODAY, startsAt: '10:30', endsAt: '11:30' }),
  step({ id: 'sew', title: 'Sewing', onDay: TODAY, untilDay: '2026-11-04' }),
  step({ id: 'shears', title: 'Sharpen the shears', onDay: '2026-11-03', job: null, doneOn: null }),
];

const snapshot = makeSnapshot({
  ownerId: OWNER,
  today: TODAY,
  timezone: 'Africa/Addis_Ababa',
  madeAt: new Date('2026-11-02T06:00:00Z'),
  firstName: 'Dagmawit',
  agenda: buildAgenda(steps, TODAY, 3),
});

describe('the snapshot kept on the phone', () => {
  it('holds what is overdue and the days as Today shows them', () => {
    expect(snapshot.overdue).toEqual([
      {
        id: 'late',
        title: 'Buy lace',
        jobLabel: '#7 · Hana · New order',
        time: null,
        part: 'From Fri 30 Oct',
        done: false,
        clash: false,
      },
    ]);
    expect(snapshot.days.map((d) => [d.heading, d.entries.map((e) => [e.title, e.time, e.part])])).toEqual([
      [
        'Today',
        [
          ['Fitting', '10:30–11:30', null],
          ['Sewing', null, 'Day 1 of 3'],
        ],
      ],
      [
        'Tomorrow',
        [
          ['Sewing', null, 'Day 2 of 3'],
          ['Sharpen the shears', null, null],
        ],
      ],
      ['Wed 4 Nov', [['Sewing', null, 'Day 3 of 3']]],
    ]);
    expect(snapshot.days[1]!.entries[1]!.jobLabel).toBeNull();
  });

  it('is today’s only on the day it was made, in her time zone', () => {
    expect(isForToday(snapshot, new Date('2026-11-02T20:59:00Z'))).toBe(true);
    expect(isForToday(snapshot, new Date('2026-11-02T21:00:00Z'))).toBe(false);
  });
});

describe('ticks that wait for the signal', () => {
  const at = new Date('2026-11-02T07:00:00Z');
  const view = (waiting: WaitingTap[]) => withWaiting(snapshot, waiting);
  const fitting = (waiting: WaitingTap[]) => view(waiting).days[0]!.entries[0]!;

  it('record the step, what she saw and what she made it, and show it applied', () => {
    const once = addTap([], fitting([]), OWNER, 'k1', at);
    expect(once).toEqual([
      {
        key: 'k1',
        ownerId: OWNER,
        stepId: 'fit',
        title: 'Fitting',
        sawDone: false,
        done: true,
        at: at.toISOString(),
      },
    ]);
    expect(fitting(once)).toMatchObject({ done: true, waiting: 1, undoKey: 'k1' });
    const twice = addTap(once, fitting(once), OWNER, 'k2', at);
    expect(twice[1]).toMatchObject({ sawDone: true, done: false });
    expect(fitting(twice)).toMatchObject({ done: false, waiting: 2, undoKey: 'k2' });
  });

  it('apply to every day a step is on', () => {
    const sewing = view([]).days[0]!.entries[1]!;
    const waiting = addTap([], sewing, OWNER, 'k1', at);
    expect(view(waiting).days.map((d) => d.entries.find((e) => e.id === 'sew')!.done)).toEqual([
      true,
      true,
      true,
    ]);
  });

  it('ignore taps of another account, if the phone changed hands', () => {
    const theirs = addTap([], fitting([]), 'someone-else', 'k1', at);
    expect(fitting(theirs)).toMatchObject({ done: false, waiting: 0 });
  });

  it('undo only a step’s last tap', () => {
    const once = addTap([], fitting([]), OWNER, 'k1', at);
    const twice = addTap(once, fitting(once), OWNER, 'k2', at);
    expect(undoTap(twice, 'k1')).toEqual(twice);
    expect(undoTap(twice, 'k2')).toEqual(once);
    expect(undoTap(twice, 'nope')).toEqual(twice);
  });
});

describe('after sending', () => {
  it('counts what was saved and says what was left, and why', () => {
    expect(replayReport([{ result: 'applied' }])).toEqual({
      saved: '1 tick made without signal was saved.',
      left: [],
    });
    expect(
      replayReport([
        { result: 'applied' },
        { result: 'stale', message: 'Cut the silk. It was already ticked done on another device.' },
        { result: 'applied' },
        { result: 'missing', message: 'Hem. That step is no longer there.' },
      ]),
    ).toEqual({
      saved: '2 ticks made without signal were saved.',
      left: [
        'Cut the silk. It was already ticked done on another device.',
        'Hem. That step is no longer there.',
      ],
    });
    expect(replayReport([])).toEqual({ saved: null, left: [] });
  });
});

describe('trying again', () => {
  it.each([
    [undefined, '/'],
    ['', '/'],
    ['/orders/1', '/orders/1'],
    ['/', '/'],
    ['https://elsewhere.example', '/'],
    ['//elsewhere.example', '/'],
    ['/\\elsewhere.example', '/'],
    ['/offline', '/'],
    ['/offline?from=/x', '/'],
    ['/api/export', '/'],
  ])('from %j goes to %j', (from, to) => {
    expect(returnPath(from)).toBe(to);
  });
});
