import { describe, expect, it } from 'vitest';
import { HISTORY_ACTIONS, describeEvent, isHistoryAction, type HistoryAction } from './history';

const say = (action: HistoryAction, details: Record<string, unknown> = {}) =>
  describeEvent({ action, details });

describe('the words for what happened', () => {
  it.each<[HistoryAction, Record<string, unknown>, string]>([
    ['order_created', { number: 105, delivery_on: '2026-11-20' }, 'Job #105 created.'],
    ['status_changed', { from: 'draft', to: 'active' }, 'Job confirmed.'],
    ['status_changed', { from: 'on_hold', to: 'active' }, 'Job resumed.'],
    ['status_changed', { from: 'delivered', to: 'active' }, 'Job reopened.'],
    [
      'status_changed',
      { from: 'active', to: 'on_hold', reason: 'Client abroad' },
      'Put on hold: Client abroad.',
    ],
    [
      'status_changed',
      { from: 'active', to: 'delivered', delivered_on: '2026-10-20' },
      'Finished on Tue 20 Oct.',
    ],
    ['status_changed', { from: 'active', to: 'cancelled' }, 'Job cancelled.'],
    [
      'status_changed',
      { from: 'active', to: 'cancelled', reason: 'Changed her mind' },
      'Job cancelled: Changed her mind.',
    ],
    ['status_changed', { from: 'cancelled', to: 'draft' }, 'Job reopened as a draft.'],
    [
      'delivery_changed',
      { from: '2026-11-13', to: '2026-11-18' },
      'Day moved from Fri 13 Nov to Wed 18 Nov.',
    ],
    ['buffer_changed', { from: 2, to: 5 }, 'Buffer before handover changed from 2 days to 5 days.'],
    ['buffer_changed', { from: 1, to: 0 }, 'Buffer before handover changed from 1 day to 0 days.'],
    ['client_changed', { from: 'Hana', to: 'Mimi' }, 'Client changed from Hana to Mimi.'],
    ['garment_added', { garment_type: 'Veil' }, 'Added Veil.'],
    ['garment_changed', { garment_type: 'Long veil', was: 'Veil' }, 'Renamed Veil to Long veil.'],
    ['garment_changed', { garment_type: 'Veil', was: 'Veil' }, 'Changed the brief for Veil.'],
    ['garment_removed', { garment_type: 'Veil' }, 'Removed Veil.'],
    ['garment_measurements', { garment_type: 'Veil', to: 2 }, 'Veil is now made to measurements version 2.'],
    [
      'garment_measurements',
      { garment_type: 'Veil', from: 1, to: 2 },
      'Veil now uses measurements version 2 (was measurements version 1).',
    ],
    ['prerequisite_added', { label: 'Lace', kind: 'material' }, 'Added to preparation: Lace.'],
    [
      'prerequisite_state',
      { label: 'Lace', kind: 'material', from: 'needed', to: 'ordered' },
      'Lace: Needed → Ordered.',
    ],
    [
      'prerequisite_state',
      { label: 'Sketch', kind: 'approval', from: 'ordered', to: 'received' },
      'Sketch: Asked → Approved.',
    ],
    ['prerequisite_date', { label: 'Lace', to: '2026-11-04' }, 'Lace expected on Wed 4 Nov.'],
    [
      'prerequisite_date',
      { label: 'Lace', from: '2026-11-04', to: '2026-11-09' },
      'Lace expected on Mon 9 Nov (was Wed 4 Nov).',
    ],
    ['prerequisite_date', { label: 'Lace', from: '2026-11-09' }, 'Lace no longer has an expected date.'],
    [
      'prerequisite_blocking',
      { label: 'Lace', blocking: true },
      'Lace now holds back the work that needs it.',
    ],
    ['prerequisite_blocking', { label: 'Lace', blocking: false }, 'Lace is now only a reminder.'],
    ['prerequisite_removed', { label: 'Lace' }, 'Removed from preparation: Lace.'],
    ['file_added', { kind: 'sketch', version: 2, caption: 'New neckline' }, 'Added Sketch 2: New neckline.'],
    ['file_added', { kind: 'fabric', version: 1, caption: '' }, 'Added Fabric 1.'],
    ['file_removed', { kind: 'sketch', version: 1, caption: '' }, 'Removed Sketch 1.'],
    [
      'measurements_recorded',
      { version: 3, taken_on: '2026-10-20' },
      'New measurements recorded (version 3, taken Tue 20 Oct).',
    ],
    [
      'template_applied',
      { garment_type: 'Bridal gown', template: 'Bridal gown', version: 3, tasks: 13 },
      'Bridal gown planned from the template “Bridal gown” (version 3): 13 tasks.',
    ],
    [
      'template_applied',
      { garment_type: 'Suit', template: null, tasks: 1 },
      'Suit planned from a template since deleted: 1 task.',
    ],
    [
      'plan_approved',
      { number: 4, state: 'at_risk', ready_on: '2026-11-20' },
      'Plan 4 approved: at risk, ready Fri 20 Nov.',
    ],
    [
      'plan_approved',
      { number: 2, state: 'at_risk' },
      'Plan 2 approved: at risk, not all of its work could be planned.',
    ],
    [
      'plan_approved',
      { number: 1, state: 'infeasible', ready_on: '2026-12-01' },
      'Plan 1 approved: cannot be made in time, ready Tue 1 Dec.',
    ],
    ['plan_approved', {}, 'A plan approved: not all of its work could be planned.'],
    [
      'task_done',
      { title: 'Cut', actual: 150, estimate: 120, done_on: '2026-10-27' },
      'Done: Cut, in 2h 30m (estimate 2h 00m), Tue 27 Oct.',
    ],
    ['task_done', { title: 'Ready' }, 'Done: Ready.'],
    ['task_hold', { title: 'Fitting', reason: 'Client away' }, 'Fitting put on hold: Client away.'],
    ['task_hold', { title: 'Fitting', reason: null }, 'Fitting no longer on hold.'],
  ])('%s %j', (action, details, sentence) => {
    expect(say(action, details)).toBe(sentence);
  });

  it('has words for every event the database can write', () => {
    for (const action of HISTORY_ACTIONS) {
      const sentence = say(action, {});
      expect(sentence.length, action).toBeGreaterThan(3);
      expect(sentence, action).toMatch(/[.]$/);
    }
  });

  it('does not break on facts it was not expecting', () => {
    const odd: Record<string, unknown>[] = [
      {},
      { from: 5, to: null, label: 7, kind: [], version: 'two', delivered_on: 'soon', taken_on: '2026-99-99' },
      { from: { a: 1 }, to: 'draft', garment_type: false },
    ];
    for (const action of HISTORY_ACTIONS) {
      for (const details of odd) {
        expect(() => say(action, details), `${action} ${JSON.stringify(details)}`).not.toThrow();
        expect(say(action, details).length).toBeGreaterThan(3);
      }
    }
  });

  it('knows its own events', () => {
    for (const a of HISTORY_ACTIONS) expect(isHistoryAction(a)).toBe(true);
    for (const a of ['order_deleted', '', null, 4]) expect(isHistoryAction(a)).toBe(false);
  });
});
