/**
 * Puts an export back (docs/harden.md, "Restore", and docs/operations.md). It REPLACES everything of one account
 * with the file's contents, so it is a command for whoever looks after the app, never a button (decision 0052).
 *
 *   npm run restore -- --file dagmawit-2026-10-30.zip --owner <account id> [--files] [--yes]
 *
 * DATABASE_URL     the database, as its owner (the "postgres" role on Supabase)
 * --files          also put the pictures back in storage, with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 * --yes            do not ask before replacing
 */
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { movedPath, picturesOf } from '../src/backup/format';
import { openExportZip } from '../src/backup/zip';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
const value = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const file = value('--file');
const owner = value('--owner');
const withFiles = args.includes('--files');
if (!file || !owner)
  fail('Usage: npm run restore -- --file <export.zip> --owner <account id> [--files] [--yes]');
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(owner))
  fail('--owner must be the account id (a UUID), from Supabase → Authentication → Users.');
const databaseUrl = process.env.DATABASE_URL ?? fail('Set DATABASE_URL to the database to restore into.');

const opened = openExportZip(new Uint8Array(readFileSync(file)));
if (!opened.ok) fail(opened.reason);
const { file: data, pictures, missing } = opened.value;
const rows = Object.values(data.tables).reduce((n, r) => n + r.length, 0);
console.log(
  `${file}: made ${data.exported_at}, schema ${data.schema}, ${rows} rows, ${pictures.size} pictures.`,
);
if (missing.length > 0) console.log(`  ${missing.length} pictures named in the data are not in the file.`);

const storage = withFiles
  ? createClient(
      process.env.SUPABASE_URL ?? fail('--files needs SUPABASE_URL.'),
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? fail('--files needs SUPABASE_SERVICE_ROLE_KEY.'),
      { auth: { persistSession: false } },
    ).storage.from('order-files')
  : null;

if (!args.includes('--yes')) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`Replace EVERYTHING of account ${owner} with this file? Type "replace": `);
  rl.close();
  if (answer.trim() !== 'replace') fail('Nothing was changed.');
}

const db = new Client({ connectionString: databaseUrl });
await db.connect();
try {
  await db.query(`select app.restore_owner($1, $2::jsonb)`, [owner, JSON.stringify(data)]);
} catch (error) {
  fail(`The restore was refused and nothing was changed: ${(error as Error).message}`);
} finally {
  await db.end();
}
console.log(`Restored ${rows} rows into account ${owner}.`);

if (storage) {
  let put = 0;
  const failed: string[] = [];
  for (const p of picturesOf(data)) {
    const bytes = pictures.get(p.path);
    if (!bytes) continue;
    const target = movedPath(p.path, data.owner_id, owner);
    const { error } = await storage.upload(target, bytes, { contentType: p.contentType, upsert: true });
    if (error) failed.push(`${target}: ${error.message}`);
    else put += 1;
  }
  console.log(`Put back ${put} pictures.`);
  if (failed.length > 0)
    fail(`These pictures could not be put back (run again with --files to retry):\n${failed.join('\n')}`);
} else if (pictures.size > 0) {
  console.log('Pictures were not put back (add --files to do so).');
}
