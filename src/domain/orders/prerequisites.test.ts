import { describe, expect, it } from 'vitest';
import { PREREQUISITE_CASES } from '../../../test/fixtures/capture-cases';
import {
  KIND_HEADING,
  KIND_LABEL,
  KIND_ORDER,
  PREREQUISITE_KINDS,
  PREREQUISITE_STATES,
  SUGGESTIONS,
  dateLabel,
  describeReadiness,
  parsePrerequisite,
  prerequisiteProblems,
  readiness,
  readinessWarnings,
  readyCount,
  stateLabel,
  type Prerequisite,
} from './prerequisites';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

const item = (over: Partial<Prerequisite> = {}): Prerequisite => ({
  id: 'x',
  kind: 'material',
  label: 'Main fabric',
  state: 'needed',
  expectedOn: null,
  blocking: true,
  note: '',
  ...over,
});

describe('an item an order waits for', () => {
  // The same cases the database's constraints are tested with, so the two cannot drift apart.
  it.each(PREREQUISITE_CASES)('agrees with the database on $label', ({ prerequisite, valid }) => {
    expect(Object.keys(prerequisiteProblems(prerequisite)).length === 0).toBe(valid);
  });

  it('is read from the form', () => {
    expect(
      parsePrerequisite(
        form({
          kind: 'material',
          label: ' Lace ',
          state: 'ordered',
          'expected-on': '2026-11-04',
          blocking: 'on',
          note: ' from Merkato ',
        }),
      ),
    ).toEqual({
      ok: true,
      value: {
        kind: 'material',
        label: 'Lace',
        state: 'ordered',
        expectedOn: '2026-11-04',
        blocking: true,
        note: 'from Merkato',
      },
    });
  });

  it('starts as needed, and is only a reminder when the box is left unticked', () => {
    expect(parsePrerequisite(form({ kind: 'other', label: 'Checklist' }))).toMatchObject({
      ok: true,
      value: { state: 'needed', blocking: false, expectedOn: null },
    });
  });

  it('accepts a date that has passed: that is what an item that is late looks like', () => {
    expect(parsePrerequisite(form({ kind: 'material', label: 'Lace', 'expected-on': '2020-01-01' })).ok).toBe(
      true,
    );
  });

  it('says what is wrong next to each field', () => {
    expect(
      parsePrerequisite(form({ kind: 'fabric', label: '', state: 'arrived', 'expected-on': '2026-02-30' })),
    ).toEqual({
      ok: false,
      errors: {
        kind: 'Choose what kind of item it is.',
        state: 'Choose where it stands.',
        'expected-on': 'Choose a day.',
        label: 'Say what it is, for example "Main fabric".',
      },
    });
  });
});

describe('the words for an item', () => {
  it('has a word for every kind and state, and they differ by kind where the meaning does', () => {
    for (const kind of PREREQUISITE_KINDS) {
      expect(KIND_HEADING[kind].length).toBeGreaterThan(0);
      expect(dateLabel(kind).length).toBeGreaterThan(0);
      for (const state of PREREQUISITE_STATES) expect(stateLabel(kind, state).length).toBeGreaterThan(0);
    }
    expect(stateLabel('material', 'received')).toBe('Received');
    expect(stateLabel('approval', 'received')).toBe('Approved');
    expect(stateLabel('measurements', 'ordered')).toBe('Booked');
  });

  it('shows every kind exactly once', () => {
    expect([...KIND_ORDER].sort()).toEqual([...PREREQUISITE_KINDS].sort());
  });

  it('offers suggestions that would all be accepted as they are', () => {
    for (const s of SUGGESTIONS) {
      expect(
        prerequisiteProblems({
          kind: s.kind,
          label: s.label,
          state: 'needed',
          expectedOn: null,
          blocking: s.blocking,
          note: '',
        }),
      ).toEqual({});
    }
    expect(new Set(SUGGESTIONS.map((s) => s.label)).size).toBe(SUGGESTIONS.length);
  });
});

describe('how ready an order is', () => {
  const today = '2026-10-25';

  it('counts what has arrived, what holds work back and what is only a reminder', () => {
    const r = readiness(
      [
        item({ id: '1', state: 'received' }),
        item({ id: '2', state: 'ordered', expectedOn: '2026-10-28' }),
        item({ id: '3', state: 'ordered' }),
        item({ id: '4', state: 'needed', blocking: false }),
        item({ id: '5', state: 'received', blocking: false }),
      ],
      today,
    );
    expect(r).toEqual({ total: 5, ready: 2, blockingOpen: 2, remindersOpen: 1, undated: 1, overdue: 0 });
  });

  it('flags a blocking item whose date has passed, but not one that is due today', () => {
    expect(readiness([item({ state: 'ordered', expectedOn: '2026-10-24' })], today)).toMatchObject({
      overdue: 1,
      undated: 0,
    });
    expect(readiness([item({ state: 'ordered', expectedOn: today })], today)).toMatchObject({ overdue: 0 });
  });

  it('does not worry about a reminder with no date, or an item that has arrived', () => {
    expect(readiness([item({ blocking: false }), item({ state: 'received' })], today)).toMatchObject({
      undated: 0,
      overdue: 0,
    });
  });

  it('is ready for nothing when nothing is listed', () => {
    expect(readiness([], today)).toEqual({
      total: 0,
      ready: 0,
      blockingOpen: 0,
      remindersOpen: 0,
      undated: 0,
      overdue: 0,
    });
  });

  it('says it in words', () => {
    expect(describeReadiness(readiness([], today))).toBe(
      'Nothing is listed yet. Add what this order is waiting for.',
    );
    expect(describeReadiness(readiness([item({ state: 'received' })], today))).toBe('Everything is in.');
    expect(
      describeReadiness(readiness([item(), item({ id: '2' }), item({ id: '3', blocking: false })], today)),
    ).toBe('2 blocking items still open. 1 reminder.');
    expect(describeReadiness(readiness([item()], today))).toBe('1 blocking item still open.');
    expect(describeReadiness(readiness([item({ blocking: false })], today))).toBe('1 reminder.');
  });
});

describe('the short wording for the orders list', () => {
  const today = '2026-10-25';

  it('counts what is ready', () => {
    const items = [
      item({ state: 'received' }),
      item({ state: 'received' }),
      item({ state: 'ordered', expectedOn: '2026-11-01' }),
    ];
    expect(readyCount(readiness(items, today))).toBe('2 of 3 ready');
    expect(readyCount(readiness([], today))).toBe('Nothing listed yet');
  });

  it('warns about blocking items with no date, and about dates that have passed', () => {
    expect(readinessWarnings(readiness([item()], today))).toEqual(['1 blocking item has no expected date']);
    expect(readinessWarnings(readiness([item(), item()], today))).toEqual([
      '2 blocking items have no expected date',
    ]);
    expect(
      readinessWarnings(readiness([item({ state: 'ordered', expectedOn: '2026-10-20' })], today)),
    ).toEqual(['1 blocking item is late']);
    expect(
      readinessWarnings(
        readiness(
          [
            item(),
            item({ state: 'ordered', expectedOn: '2026-10-20' }),
            item({ state: 'ordered', expectedOn: '2026-10-21' }),
          ],
          today,
        ),
      ),
    ).toEqual(['1 blocking item has no expected date', '2 blocking items are late']);
  });

  it('is quiet when nothing needs attention', () => {
    expect(readinessWarnings(readiness([], today))).toEqual([]);
    expect(readinessWarnings(readiness([item({ state: 'received' })], today))).toEqual([]);
    expect(readinessWarnings(readiness([item({ blocking: false })], today))).toEqual([]);
    expect(
      readinessWarnings(readiness([item({ state: 'ordered', expectedOn: '2026-10-25' })], today)),
    ).toEqual([]);
  });
});

describe('the words for a kind', () => {
  it('has a heading, a name to choose it by, and a place in the order for every kind', () => {
    for (const kind of PREREQUISITE_KINDS) {
      expect(KIND_HEADING[kind].length, kind).toBeGreaterThan(0);
      expect(KIND_LABEL[kind].length, kind).toBeGreaterThan(0);
      expect(KIND_ORDER, kind).toContain(kind);
    }
  });
});
