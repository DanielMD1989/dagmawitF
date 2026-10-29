/**
 * The restore drill (docs/harden.md, "The drill").
 *
 *   npm run drill:restore                         make a person with data in every table, and round-trip her
 *   npm run drill:restore -- --file <export.zip>  round-trip a real export
 *
 * DATABASE_URL names a PostgreSQL server where throwaway databases may be made (the database tests' default if not
 * set). Nothing outside the throwaway databases is touched, and they are dropped at the end.
 */
import { readFileSync } from 'node:fs';
import { runDrill } from './drill';

const DEFAULT_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const args = process.argv.slice(2);
const at = args.indexOf('--file');
const path = at >= 0 ? args[at + 1] : undefined;
if (at >= 0 && !path) {
  console.error('Say which file: --file <export.zip>');
  process.exit(2);
}

const problems = await runDrill(
  process.env.DATABASE_URL ?? DEFAULT_URL,
  { zip: path ? new Uint8Array(readFileSync(path)) : undefined },
  (line) => console.log(`· ${line}`),
);
if (problems.length > 0) {
  console.error(`\nThe drill FAILED:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('\nThe drill passed: the export restores whole.');
