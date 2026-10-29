import { follows, herCalendar, type Fixture, work } from './build';
import { TODAY } from './bridal-gown';

/**
 * A rush job that cannot be done. The dress needs 15 hours and she has two working days before
 * handover, with 5h 15m of planned time each. The engine must say so, with the numbers, and not
 * pretend. Today is Sunday 25 October 2026.
 */

export const impossibleDress: Fixture = {
  name: 'impossible-dress',
  title: 'A rush dress that cannot be ready in time',
  story:
    'Handover is Wednesday 28 October, so the last working day is Tuesday 27. That is two days, 10h 30m of planned time, for a 15 hour dress.',
  input: {
    today: TODAY,
    calendar: herCalendar(TODAY),
    orders: [
      { id: 'o110', label: 'Order #110, wedding guest dress', deliveryOn: '2026-10-28', bufferDays: 0 },
    ],
    tasks: [
      work('cut', 'o110', 'Cut the dress', 180),
      work('sew', 'o110', 'Sew the dress', 600),
      work('finish', 'o110', 'Finish and press', 120),
    ],
    edges: [follows('cut', 'sew'), follows('sew', 'finish')],
  },
};
