import { bridalGown, bridalGownLaceLate } from './bridal-gown';
import { busyAtelier } from './busy-atelier';
import type { Fixture } from './build';
import { impossibleDress } from './impossible-dress';

export type { Fixture } from './build';
export { bridalGown, bridalGownLaceLate, busyAtelier, impossibleDress };

export const ALL_FIXTURES: Fixture[] = [bridalGown, bridalGownLaceLate, busyAtelier, impossibleDress];
