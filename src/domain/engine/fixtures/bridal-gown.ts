import { follows, fixed, herCalendar, type Fixture, wait, work } from './build';
import type { PlanInput } from '../types';

/**
 * A bridal gown, start to finish, for one client. Today is Sunday 25 October 2026.
 *
 * NOTE: this is a reconstruction from the design boards, not the PRD's own section 13 text,
 * which was not available when it was written. Replace it with the real story when it is.
 * The shape is the one the boards describe: a long construction task that must span several
 * days, lace that arrives late, fittings that are fixed, and rest overnight before a fitting.
 */

export const TODAY = '2026-10-25';
const ORDER = 'o105';

export function bridalGownInput(laceExpectedOn: string): PlanInput {
  return {
    today: TODAY,
    calendar: herCalendar(TODAY),
    orders: [{ id: ORDER, label: 'Order #105, bridal gown', deliveryOn: '2026-11-21', bufferDays: 3 }],
    tasks: [
      work('pattern', ORDER, 'Draft the pattern', 240),
      work('toile', ORDER, 'Make and test the toile', 180),
      fixed('fit1', ORDER, 'First fitting', '2026-10-29', '10:30', 60),
      work('cut', ORDER, 'Cut the gown', 180),
      work('construct', ORDER, 'Construct bodice and skirt', 600),
      wait('rest', ORDER, 'Steam and rest overnight', 1),
      fixed('fit2', ORDER, 'Second fitting', '2026-11-12', '10:30', 60),
      work('alter', ORDER, 'Alterations after the fitting', 240),
      work('trims', ORDER, 'Prepare bridal trims', 45),
      work('finish', ORDER, 'Hand finishing and pressing', 180),
    ],
    edges: [
      follows('pattern', 'toile'),
      follows('toile', 'fit1'),
      follows('fit1', 'cut', 1),
      follows('cut', 'construct'),
      follows('construct', 'rest'),
      follows('rest', 'fit2'),
      follows('fit2', 'alter', 1),
      follows('alter', 'finish'),
      follows('trims', 'finish'),
    ],
    prerequisites: [
      {
        id: 'silk',
        orderId: ORDER,
        label: 'Silk crepe',
        state: 'received',
        expectedOn: null,
        blocking: true,
      },
      {
        id: 'lace',
        orderId: ORDER,
        label: 'French lace',
        state: 'ordered',
        expectedOn: laceExpectedOn,
        blocking: true,
      },
    ],
    requirements: [
      { taskId: 'cut', prerequisiteId: 'silk' },
      { taskId: 'trims', prerequisiteId: 'lace' },
    ],
  };
}

export const bridalGown: Fixture = {
  name: 'bridal-gown',
  title: 'A bridal gown, on schedule',
  story:
    'Ten tasks over four weeks. The 10-hour construction spans three working days. The lace arrives Wednesday 28 October, well before it is needed.',
  input: bridalGownInput('2026-10-28'),
};

export const bridalGownLaceLate: Fixture = {
  name: 'bridal-gown-lace-late',
  title: 'The same gown when the lace is delayed',
  story:
    'The lace is now expected on Thursday 19 November. Everything else is unchanged. Run it next to the plan above to see the effect.',
  input: bridalGownInput('2026-11-19'),
};
