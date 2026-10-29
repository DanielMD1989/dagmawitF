import { describe, expect, it } from 'vitest';
import {
  addTap,
  isForToday,
  makeSnapshot,
  offlineTaps,
  replayReport,
  returnPath,
  undoTap,
  withWaiting,
  type DaySnapshot,
  type OfflineEntry,
  type WaitingTap,
} from './offline';
import { allowedFrom, progressProblem, staleMessage, statusAfter, takesHerTime } from './progress';
import { buildToday, type LiveTask } from './today';

const DAY = '2026-10-30';
const OWNER = 'owner-a';
const ZONE = 'Africa/Addis_Ababa';

const task = (over: Partial<LiveTask> & { id: string }): LiveTask => ({
  orderId: 'o1',
  orderLabel: 'Order #1, evening dress',
  title: over.id,
  kind: 'work',
  minutes: 120,
  status: 'not_started',
  remainingMinutes: null,
  actualMinutes: null,
  holdReason: '',
  ...over,
});

function snapshot(): DaySnapshot {
  const plan = buildToday({
    today: DAY,
    usableMinutes: 360,
    slots: [
      { taskId: 'fitting', day: DAY, minutes: 60, rank: 1, time: '10:00' },
      { taskId: 'cut', day: DAY, minutes: 120, rank: 2 },
      { taskId: 'lining', day: DAY, minutes: 90, rank: 3 },
      { taskId: 'beads', day: DAY, minutes: 60, rank: 4 },
      { taskId: 'held', day: DAY, minutes: 30, rank: 5 },
    ],
    tasks: [
      task({ id: 'fitting', title: 'First fitting', kind: 'fixed', minutes: 60 }),
      task({ id: 'cut', title: 'Cut the silk' }),
      task({ id: 'lining', title: 'Sew the lining', status: 'in_progress', remainingMinutes: 90 }),
      task({ id: 'beads', title: 'Bead the bodice' }),
      task({ id: 'held', title: 'Hem', holdReason: 'Client is away' }),
      task({
        id: 'yesterday',
        title: 'Press the skirt',
        status: 'in_progress',
        orderLabel: null,
        orderId: null,
      }),
    ],
    needs: [{ taskId: 'beads', itemId: 'i1' }],
    items: [{ id: 'i1', label: 'Beads', state: 'ordered', expectedOn: '2026-11-02', blocking: true }],
  });
  return makeSnapshot({
    ownerId: OWNER,
    day: DAY,
    timezone: ZONE,
    madeAt: new Date('2026-10-30T05:12:00Z'),
    firstName: 'Dagmawit',
    planNumber: 7,
    plan,
  });
}

const entries = (waiting: WaitingTap[] = []) => withWaiting(snapshot(), waiting);
const entry = (id: string, waiting: WaitingTap[] = []) => entries(waiting).find((e) => e.id === id)!;
const at = new Date('2026-10-30T07:00:00Z');

describe('the snapshot kept on the phone', () => {
  it('holds the day as My Day shows it, in the same sections and order', () => {
    const s = snapshot();
    expect(s).toMatchObject({
      version: 1,
      ownerId: OWNER,
      day: DAY,
      madeAt: '2026-10-30T05:12:00.000Z',
      planNumber: 7,
      plannedMinutes: 270,
      usableMinutes: 360,
      freeMinutes: 90,
    });
    expect(s.entries.map((e) => [e.id, e.section, e.state])).toEqual([
      ['fitting', 'fixed', 'ready'],
      ['cut', 'work', 'ready'],
      ['lining', 'work', 'started'],
      ['beads', 'work', 'blocked'],
      ['held', 'work', 'held'],
      ['yesterday', 'started', 'started'],
    ]);
    expect(s.entries[3]!.reason).toBe('Beads not received. Expected Mon 2 Nov.');
  });

  it('is today’s list only on the day it was made, in her time zone', () => {
    expect(isForToday(snapshot(), new Date('2026-10-30T20:59:00Z'))).toBe(true);
    // 21:00 UTC is midnight in Addis Ababa: the next day.
    expect(isForToday(snapshot(), new Date('2026-10-30T21:00:00Z'))).toBe(false);
  });
});

describe('what she can tap without signal', () => {
  it('is what My Day offers: start or finish a ready task, finish or update a started one', () => {
    expect(offlineTaps(entry('cut'))).toEqual(['start', 'done', 'remaining']);
    expect(offlineTaps(entry('lining'))).toEqual(['done', 'remaining']);
    expect(offlineTaps(entry('fitting'))).toEqual(['start', 'done', 'remaining']);
  });

  it('is nothing on a blocked, held or finished task', () => {
    expect(offlineTaps(entry('beads'))).toEqual([]);
    expect(offlineTaps(entry('held'))).toEqual([]);
    const done = addTap(
      [],
      entry('cut'),
      OWNER,
      { kind: 'done', doneOn: DAY, actualMinutes: 100 },
      'k1',
      at,
    )!;
    expect(offlineTaps(entry('cut', done))).toEqual([]);
  });

  it('offers no time left on a wait or a milestone', () => {
    const wait: OfflineEntry = { ...entry('cut'), kind: 'wait', minutes: null };
    expect(offlineTaps(wait)).toEqual(['start', 'done']);
    expect(offlineTaps({ ...wait, state: 'started', status: 'in_progress' })).toEqual(['done']);
  });
});

describe('waiting taps', () => {
  it('record the task, the change, the status she saw, and when', () => {
    const waiting = addTap([], entry('cut'), OWNER, { kind: 'start' }, 'k1', at);
    expect(waiting).toEqual([
      {
        key: 'k1',
        ownerId: OWNER,
        taskId: 'cut',
        title: 'Cut the silk',
        seen: 'not_started',
        change: { kind: 'start' },
        at: '2026-10-30T07:00:00.000Z',
      },
    ]);
  });

  it('are shown applied, in order, each one seeing the status the one before left', () => {
    let waiting = addTap([], entry('cut'), OWNER, { kind: 'start' }, 'k1', at)!;
    expect(entry('cut', waiting)).toMatchObject({
      status: 'in_progress',
      state: 'started',
      waiting: 1,
      undoKey: 'k1',
    });
    waiting = addTap(waiting, entry('cut', waiting), OWNER, { kind: 'remaining', minutes: 45 }, 'k2', at)!;
    expect(waiting[1]!.seen).toBe('in_progress');
    expect(entry('cut', waiting)).toMatchObject({ remainingMinutes: 45, waiting: 2, undoKey: 'k2' });
    waiting = addTap(
      waiting,
      entry('cut', waiting),
      OWNER,
      { kind: 'done', doneOn: DAY, actualMinutes: 110 },
      'k3',
      at,
    )!;
    expect(entry('cut', waiting)).toMatchObject({
      status: 'done',
      state: 'done',
      remainingMinutes: null,
      actualMinutes: 110,
      waiting: 3,
    });
    expect(entry('lining', waiting)).toMatchObject({ waiting: 0, undoKey: null, status: 'in_progress' });
  });

  it('refuse a tap My Day would not offer', () => {
    expect(addTap([], entry('beads'), OWNER, { kind: 'start' }, 'k', at)).toBeNull();
    expect(addTap([], entry('lining'), OWNER, { kind: 'start' }, 'k', at)).toBeNull();
  });

  it('ignore taps of another account, if the phone changed hands', () => {
    const theirs = addTap([], entry('cut'), 'owner-b', { kind: 'start' }, 'k', at)!;
    expect(entry('cut', theirs)).toMatchObject({ status: 'not_started', waiting: 0 });
  });

  it('undo only a task’s last tap', () => {
    let waiting = addTap([], entry('cut'), OWNER, { kind: 'start' }, 'k1', at)!;
    waiting = addTap(waiting, entry('lining', waiting), OWNER, { kind: 'remaining', minutes: 30 }, 'k2', at)!;
    waiting = addTap(waiting, entry('cut', waiting), OWNER, { kind: 'remaining', minutes: 60 }, 'k3', at)!;
    expect(undoTap(waiting, 'k1')).toEqual(waiting);
    expect(undoTap(waiting, 'k3').map((t) => t.key)).toEqual(['k1', 'k2']);
    expect(undoTap(waiting, 'k2').map((t) => t.key)).toEqual(['k1', 'k3']);
    expect(undoTap(waiting, 'nope')).toEqual(waiting);
  });
});

describe('after sending', () => {
  it('counts what was saved and says what was left, and why', () => {
    expect(replayReport([{ result: 'applied' }])).toEqual({
      saved: '1 tap made without signal was saved.',
      left: [],
    });
    expect(
      replayReport([
        { result: 'applied' },
        { result: 'stale', message: `Cut the silk. ${staleMessage('done')}` },
        { result: 'applied' },
        { result: 'missing', message: 'Hem. It was removed, so this was left.' },
      ]),
    ).toEqual({
      saved: '2 taps made without signal were saved.',
      left: [
        'Cut the silk. It is done now, so this was left as it is.',
        'Hem. It was removed, so this was left.',
      ],
    });
    expect(replayReport([])).toEqual({ saved: null, left: [] });
  });
});

describe('the rules of progress (forms and waiting taps alike)', () => {
  it('say what each change leaves, and from where it may be made', () => {
    expect(statusAfter({ kind: 'start' })).toBe('in_progress');
    expect(statusAfter({ kind: 'remaining', minutes: 5 })).toBe('in_progress');
    expect(statusAfter({ kind: 'reopen' })).toBe('in_progress');
    expect(statusAfter({ kind: 'done', doneOn: DAY, actualMinutes: 5 })).toBe('done');
    expect(allowedFrom({ kind: 'start' })).toEqual(['not_started']);
    expect(allowedFrom({ kind: 'reopen' })).toEqual(['done']);
    expect(allowedFrom({ kind: 'done', doneOn: DAY, actualMinutes: 5 })).toEqual([
      'not_started',
      'in_progress',
    ]);
    expect(takesHerTime('fixed')).toBe(true);
    expect(takesHerTime('milestone')).toBe(false);
  });

  it.each([
    [{ kind: 'done', doneOn: DAY, actualMinutes: 90 }, 'work', null],
    [{ kind: 'done', doneOn: '2026-10-29', actualMinutes: 90 }, 'fixed', null],
    [{ kind: 'done', doneOn: DAY, actualMinutes: null }, 'wait', null],
    [{ kind: 'done', doneOn: '2026-10-31', actualMinutes: 90 }, 'work', 'Choose today or an earlier day.'],
    [{ kind: 'done', doneOn: '2026-02-30', actualMinutes: 90 }, 'work', 'Choose a day.'],
    [{ kind: 'done', doneOn: DAY, actualMinutes: null }, 'work', 'Say how long it took, in total.'],
    [{ kind: 'done', doneOn: DAY, actualMinutes: 0 }, 'work', 'Keep the time it took under 100 hours.'],
    [{ kind: 'done', doneOn: DAY, actualMinutes: 6001 }, 'work', 'Keep the time it took under 100 hours.'],
    [{ kind: 'done', doneOn: DAY, actualMinutes: 1.5 }, 'work', 'Keep the time it took under 100 hours.'],
    [
      { kind: 'done', doneOn: DAY, actualMinutes: 30 },
      'milestone',
      'A wait or a milestone takes none of her time.',
    ],
    [{ kind: 'remaining', minutes: 30 }, 'work', null],
    [{ kind: 'remaining', minutes: 30 }, 'wait', 'Only work and appointments have time left.'],
    [{ kind: 'remaining', minutes: 0 }, 'work', 'Keep the time left under 100 hours.'],
    [{ kind: 'start' }, 'milestone', null],
  ] as const)('%j for %s: %s', (change, kind, problem) => {
    expect(progressProblem(change, kind, DAY)).toBe(problem);
  });
});

describe('trying again', () => {
  it.each([
    [undefined, '/'],
    ['', '/'],
    ['/orders/1?tab=plan', '/orders/1?tab=plan'],
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
