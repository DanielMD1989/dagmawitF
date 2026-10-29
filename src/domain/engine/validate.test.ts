import { describe, expect, it } from 'vitest';
import { addDays } from '../dates';
import { fixed, flatCalendar, follows, wait, work } from './fixtures/build';
import { plan } from './plan';
import { ERROR_CODES, type ErrorCode, type PlanInput, type Task } from './types';

const MON = '2026-10-26';
const d = (n: number) => addDays(MON, n);

function base(tasks: Task[], extra: Partial<PlanInput> = {}): PlanInput {
  return { today: MON, calendar: flatCalendar(MON, 300, 30), tasks, ...extra };
}

function refusal(i: PlanInput) {
  const result = plan(i);
  if (result.ok) throw new Error('expected the engine to refuse');
  return result.errors;
}

const codesOf = (i: PlanInput): ErrorCode[] => refusal(i).map((e) => e.code);

describe('the engine refuses rather than guesses', () => {
  const cases: [ErrorCode, string, PlanInput][] = [
    [
      'today_outside_calendar',
      'today before the calendar',
      { ...base([work('a', null, 'A', 60)]), today: addDays(MON, -1) },
    ],
    [
      'today_outside_calendar',
      'today after the calendar',
      { ...base([work('a', null, 'A', 60)]), today: d(40) },
    ],
    [
      'bad_capacity',
      'negative minutes',
      { ...base([work('a', null, 'A', 60)]), calendar: { start: MON, usable: [300, -5, 300] } },
    ],
    [
      'bad_capacity',
      'a fraction of a minute',
      { ...base([work('a', null, 'A', 60)]), calendar: { start: MON, usable: [300, 12.5] } },
    ],
    ['bad_date', 'a date that does not exist', base([work('a', null, 'A', 60, { notBefore: '2026-02-30' })])],
    [
      'bad_date',
      'a calendar that starts on nothing',
      { ...base([work('a', null, 'A', 60)]), calendar: { start: 'soon', usable: [300] } },
    ],
    ['duplicate_id', 'two tasks with one id', base([work('a', null, 'A', 60), work('a', null, 'Again', 60)])],
    [
      'unknown_kind',
      'a kind nobody knows',
      base([{ id: 'a', orderId: null, title: 'A', kind: 'dance' as never, minutes: 60 }]),
    ],
    [
      'unknown_status',
      'a status nobody knows',
      base([work('a', null, 'A', 60, { status: 'paused' as never })]),
    ],
    ['unknown_order', 'a task for an order that is not there', base([work('a', 'ghost', 'A', 60)])],
    [
      'unknown_task',
      'a link to a missing task',
      base([work('a', null, 'A', 60)], { edges: [follows('a', 'ghost')] }),
    ],
    [
      'unknown_task',
      'a requirement for a missing task',
      base([work('a', null, 'A', 60)], { requirements: [{ taskId: 'ghost', prerequisiteId: 'x' }] }),
    ],
    [
      'unknown_prerequisite',
      'a requirement for a missing prerequisite',
      base([work('a', null, 'A', 60)], { requirements: [{ taskId: 'a', prerequisiteId: 'ghost' }] }),
    ],
    [
      'bad_buffer',
      'a negative buffer',
      base([work('a', 'o', 'A', 60)], {
        orders: [{ id: 'o', label: 'O', deliveryOn: d(10), bufferDays: -1 }],
      }),
    ],
    [
      'bad_lag',
      'a negative lag',
      base([work('a', null, 'A', 60), work('b', null, 'B', 60)], { edges: [follows('a', 'b', -1)] }),
    ],
    [
      'bad_lag',
      'half a day of lag',
      base([work('a', null, 'A', 60), work('b', null, 'B', 60)], {
        edges: [{ from: 'a', to: 'b', lagDays: 0.5 }],
      }),
    ],
    [
      'edge_to_self',
      'a task that follows itself',
      base([work('a', null, 'A', 60)], { edges: [follows('a', 'a')] }),
    ],
    [
      'cross_order_edge',
      'a link between two orders',
      base([work('a', 'o1', 'A', 60), work('b', 'o2', 'B', 60)], {
        orders: [
          { id: 'o1', label: 'O1', deliveryOn: d(10), bufferDays: 0 },
          { id: 'o2', label: 'O2', deliveryOn: d(10), bufferDays: 0 },
        ],
        edges: [follows('a', 'b')],
      }),
    ],
    [
      'cross_order_edge',
      'a link between an order and studio work',
      base([work('a', 'o1', 'A', 60), work('b', null, 'B', 60)], {
        orders: [{ id: 'o1', label: 'O1', deliveryOn: d(10), bufferDays: 0 }],
        edges: [follows('a', 'b')],
      }),
    ],
    [
      'missing_estimate',
      'work with no minutes',
      base([{ id: 'a', orderId: null, title: 'A', kind: 'work' }]),
    ],
    ['missing_estimate', 'work with zero minutes', base([work('a', null, 'A', 0)])],
    ['missing_estimate', 'work with a fraction of a minute', base([work('a', null, 'A', 12.5)])],
    [
      'wait_without_days',
      'a wait with no days',
      base([{ id: 'w', orderId: null, title: 'W', kind: 'wait' }]),
    ],
    ['fixed_without_time', 'a fixed event at 25:00', base([fixed('f', null, 'F', d(3), '25:00', 60)])],
    [
      'done_without_date',
      'a done task with no finish day',
      base([work('a', null, 'A', 60, { status: 'done' })]),
    ],
    [
      'locked_mismatch',
      'locked slots that do not add up',
      base([work('a', null, 'A', 300, { lockedSlots: [{ day: d(1), minutes: 100 }] })]),
    ],
    [
      'locked_mismatch',
      'two locked slots on one day',
      base([
        work('a', null, 'A', 300, {
          lockedSlots: [
            { day: d(1), minutes: 100 },
            { day: d(1), minutes: 200 },
          ],
        }),
      ]),
    ],
    [
      'locked_not_work',
      'locked slots on a wait',
      base([{ ...wait('w', null, 'W', 2), lockedSlots: [{ day: d(1), minutes: 60 }] }]),
    ],
    [
      'fixed_event_in_past',
      'a fixed event yesterday that is not done',
      { ...base([fixed('f', null, 'F', addDays(MON, -1), '10:00', 60)]) },
    ],
    [
      'locked_slot_in_past',
      'work locked on a day that has passed',
      base([work('a', null, 'A', 60, { lockedSlots: [{ day: addDays(MON, -2), minutes: 60 }] })]),
    ],
    [
      'beyond_calendar',
      'a fixed event after the calendar ends',
      base([fixed('f', null, 'F', d(100), '10:00', 60)]),
    ],
    [
      'beyond_calendar',
      'locked work after the calendar ends',
      base([work('a', null, 'A', 60, { lockedSlots: [{ day: d(100), minutes: 60 }] })]),
    ],
    [
      'pinned_contradiction',
      'a fitting set before the locked work it needs',
      base(
        [
          work('bodice', null, 'Bodice', 300, { lockedSlots: [{ day: d(3), minutes: 300 }] }),
          fixed('fit', null, 'Fitting', d(2), '10:30', 60),
        ],
        { edges: [follows('bodice', 'fit')] },
      ),
    ],
    [
      'pinned_contradiction',
      'two events on one day whose clock times run the wrong way',
      base(
        [
          fixed('first', null, 'Fabric run', d(2), '14:00', 60),
          fixed('second', null, 'Fitting', d(2), '10:30', 60),
        ],
        { edges: [follows('first', 'second')] },
      ),
    ],
    [
      'pinned_contradiction',
      'a fitting that starts before the previous event has ended',
      base(
        [
          fixed('first', null, 'Fabric run', d(2), '10:00', 120),
          fixed('second', null, 'Fitting', d(2), '11:30', 60),
        ],
        { edges: [follows('first', 'second')] },
      ),
    ],
    [
      'pinned_contradiction',
      'a fitting set before a done task with a rest day',
      base(
        [
          work('a', null, 'A', 60, { status: 'done', doneOn: d(0) }),
          fixed('f', null, 'F', d(0), '10:30', 60),
        ],
        {
          edges: [follows('a', 'f', 1)],
        },
      ),
    ],
  ];

  it.each(cases)('%s: %s', (code, _what, input) => {
    expect(codesOf(input)).toContain(code);
  });

  it('every refusal code has a case above', () => {
    const covered = new Set(cases.map(([code]) => code));
    const missing = ERROR_CODES.filter((c) => !covered.has(c) && c !== 'cycle'); // a cycle has its own test below
    expect(missing).toEqual([]);
  });

  it('names the tasks in a cycle, starting from the lowest id', () => {
    const errors = refusal(
      base(
        [
          work('c', null, 'C', 60),
          work('a', null, 'A', 60),
          work('b', null, 'B', 60),
          work('z', null, 'Z', 60),
        ],
        {
          edges: [follows('a', 'b'), follows('b', 'c'), follows('c', 'a'), follows('z', 'a')],
        },
      ),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'cycle', details: { tasks: ['a', 'b', 'c', 'a'] } });
    expect(errors[0]?.message).toContain('a -> b -> c -> a');
  });

  it('reports every problem at once, so she can fix them in one go', () => {
    const errors = refusal(
      base([
        work('a', null, 'A', 0),
        work('b', null, 'B', 0),
        { id: 'w', orderId: null, title: 'W', kind: 'wait' },
      ]),
    );
    expect(errors.map((e) => e.subject).sort()).toEqual(['a', 'b', 'w']);
  });

  it('gives the same refusal whatever order the same mistakes were listed in', () => {
    const permutations = <T>(items: T[]): T[][] =>
      items.length <= 1
        ? [items]
        : items.flatMap((item, i) =>
            permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
          );
    const tasks = [
      work('a', 'o1', 'A', 60),
      work('b', 'o2', 'B', 0),
      work('c', null, 'C', 60),
      work('d', 'ghost', 'D', 60),
    ];
    const edges = [
      follows('a', 'nobody'),
      follows('a', 'b'),
      follows('c', 'c'),
      { from: 'a', to: 'c', lagDays: -1 },
      { from: 'b', to: 'a', lagDays: 0.5 },
    ];
    const orders = [
      { id: 'o1', label: 'O1', deliveryOn: d(10), bufferDays: 0 },
      { id: 'o2', label: 'O2', deliveryOn: d(10), bufferDays: -2 },
    ];
    const texts = new Set<string>();
    for (const t of permutations(tasks)) {
      for (const e of permutations(edges)) {
        for (const o of permutations(orders)) {
          texts.add(JSON.stringify(refusal(base(t, { edges: e, orders: o }))));
        }
      }
    }
    expect(texts.size).toBe(1);
    expect(refusal(base(tasks, { edges, orders })).length).toBeGreaterThanOrEqual(6);
  });

  it('gives each refusal a message in plain words that names the task', () => {
    const [error] = refusal(base([work('a', null, 'Cut the gown', 0)]));
    expect(error?.message).toContain('Cut the gown');
    expect(error?.message).toContain('estimate');
  });

  it('accepts a fitting on the same day as the work it follows when the lag is 0', () => {
    const result = plan(
      base(
        [
          work('a', null, 'A', 60, { lockedSlots: [{ day: d(2), minutes: 60 }] }),
          fixed('f', null, 'F', d(2), '10:30', 60),
        ],
        {
          edges: [follows('a', 'f')],
        },
      ),
    );
    expect(result.ok).toBe(true);
  });

  it('accepts two events on one day when the second starts as the first ends', () => {
    const result = plan(
      base(
        [
          fixed('first', null, 'Fabric run', d(2), '10:00', 90),
          fixed('second', null, 'Fitting', d(2), '11:30', 60),
        ],
        { edges: [follows('first', 'second')] },
      ),
    );
    expect(result.ok).toBe(true);
  });

  it('does not compare clock times when the events are on different days', () => {
    const result = plan(
      base(
        [
          fixed('first', null, 'Fabric run', d(2), '16:00', 60),
          fixed('second', null, 'Fitting', d(3), '09:00', 60),
        ],
        { edges: [follows('first', 'second')] },
      ),
    );
    expect(result.ok).toBe(true);
  });

  it('ignores a link to a cancelled task instead of refusing it', () => {
    const result = plan(
      base([work('a', null, 'A', 60, { status: 'cancelled' }), work('b', null, 'B', 60)], {
        edges: [follows('a', 'b')],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('does not require an estimate on a task that is already done', () => {
    const result = plan(
      base([{ id: 'a', orderId: null, title: 'A', kind: 'work', status: 'done', doneOn: d(0) }]),
    );
    expect(result.ok).toBe(true);
  });
});
