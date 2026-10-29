import type fc from 'fast-check';

/**
 * How hard the property tests try. The defaults give the same few hundred situations every run,
 * so a failure is never a surprise from nowhere. `npm run test:fuzz` raises the count and picks a
 * new seed each time, and prints it, so a failure it finds can be repeated with FC_SEED.
 */
export const RUNS = Number(process.env.FC_RUNS ?? 200);
export const SEED = Number(process.env.FC_SEED ?? 20261025);

export const parameters: fc.Parameters<unknown> = { numRuns: RUNS, seed: SEED };
