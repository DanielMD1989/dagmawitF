import { bridalGownInput, TODAY } from './bridal-gown';
import { fixed, follows, herCalendar, type Fixture, work } from './build';
import type { PlanInput } from '../types';

/**
 * A normal busy fortnight: the bridal gown, a linen suit that needs a fitting tomorrow, a
 * jacket, an evening gown and two jobs of the studio's own, all sharing one pair of hands.
 * Today is Sunday 25 October 2026. Same reconstruction caveat as the bridal gown.
 */

function busyAtelierInput(): PlanInput {
  const bridal = bridalGownInput('2026-10-28');
  return {
    today: TODAY,
    calendar: herCalendar(TODAY),
    orders: [
      ...(bridal.orders ?? []),
      { id: 'o098', label: 'Order #098, linen suit', deliveryOn: '2026-10-30', bufferDays: 1 },
      { id: 'o101', label: 'Order #101, jacket', deliveryOn: '2026-11-06', bufferDays: 2 },
      { id: 'o104', label: 'Order #104, evening gown', deliveryOn: '2026-11-14', bufferDays: 2 },
    ],
    tasks: [
      ...bridal.tasks,
      fixed('o098-fit', 'o098', 'Client fitting', '2026-10-26', '10:30', 30),
      work('o098-alter', 'o098', 'Take in the suit', 150),
      work('o098-press', 'o098', 'Press and pack', 45),

      work('o101-cut', 'o101', 'Cut the jacket', 90),
      work('o101-construct', 'o101', 'Construct the jacket', 300),
      work('o101-lining', 'o101', 'Construct jacket lining', 60),
      work('o101-finish', 'o101', 'Finish the jacket', 120),

      work('o104-cut', 'o104', 'Cut evening gown', 90),
      work('o104-sew', 'o104', 'Sew evening gown', 480),
      fixed('o104-fit', 'o104', 'Client fitting', '2026-11-04', '14:00', 45),
      work('o104-hem', 'o104', 'Hem and finish', 180),

      work('studio-samples', null, 'Order fabric samples', 60),
      work('studio-tidy', null, 'Tidy the cutting table', 45, { priority: 5 }),
    ],
    edges: [
      ...(bridal.edges ?? []),
      follows('o098-fit', 'o098-alter'),
      follows('o098-alter', 'o098-press'),

      follows('o101-cut', 'o101-construct'),
      follows('o101-construct', 'o101-lining'),
      follows('o101-lining', 'o101-finish'),

      follows('o104-cut', 'o104-sew'),
      follows('o104-sew', 'o104-fit', 1),
      follows('o104-fit', 'o104-hem', 1),
    ],
    prerequisites: bridal.prerequisites ?? [],
    requirements: bridal.requirements ?? [],
  };
}

export const busyAtelier: Fixture = {
  name: 'busy-atelier',
  title: 'A busy fortnight, four orders and two studio jobs',
  story:
    'Everything shares one pair of hands. The engine does the work with the least slack first, so the linen suit and the jacket go ahead of the gown that is weeks away.',
  input: busyAtelierInput(),
};
