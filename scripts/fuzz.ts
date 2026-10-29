import { spawnSync } from 'node:child_process';

/**
 * Tries the scheduling engine against many more random situations than the normal tests do,
 * with a seed of its own. If anything fails, run again with the printed seed to see the same thing.
 *
 *   npm run test:fuzz                  a new seed, 3000 situations per rule
 *   npm run test:fuzz -- 1234 20000    seed 1234, 20000 situations per rule
 */
const seed = Number(process.argv[2] ?? Math.floor(Math.random() * 2 ** 31));
const runs = Number(process.argv[3] ?? 3000);
console.log(`Random situations per rule: ${runs}. Seed: ${seed}`);
console.log(`To repeat exactly: npm run test:fuzz -- ${seed} ${runs}\n`);

const result = spawnSync(
  'npx',
  [
    'vitest',
    'run',
    '--config',
    'vitest.config.ts',
    'src/domain/engine/properties.test.ts',
    'src/domain/engine/soundness.test.ts',
  ],
  {
    stdio: 'inherit',
    env: { ...process.env, FC_SEED: String(seed), FC_RUNS: String(runs) },
    shell: process.platform === 'win32',
  },
);
process.exit(result.status ?? 1);
