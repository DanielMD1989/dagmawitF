import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { differences, movedPath, picturesOf, readExportFile, type ExportFile } from '../../src/backup/format';
import { collect, exportZip, openExportZip } from '../../src/backup/zip';
import { connect, migrate, migrations, scratchDatabase, type Scratch } from './database';
import { fillPerson } from './full-person';

/**
 * The restore drill (docs/harden.md, "The drill"): export, restore as another person into a fresh database,
 * export again, compare, and carry on. Returns the problems found; none means the drill passed.
 */

type Say = (line: string) => void;

async function newAccount(db: Client, id: string = randomUUID()): Promise<string> {
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{"name":"Dagmawit"}'::jsonb)`,
    [id, `${id.slice(0, 8)}@drill.test`],
  );
  return id;
}

/** Runs `fn` as the person, the way the API does (her role, her claims), then goes back to the owner. */
async function asPerson<T>(db: Client, id: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`set role authenticated`);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: id, role: 'authenticated' }),
  ]);
  try {
    return await fn();
  } finally {
    await db.query(`reset role`);
    await db.query(`select set_config('request.jwt.claims', '', false)`);
  }
}

async function exportOf(db: Client, id: string): Promise<ExportFile> {
  const { rows } = await asPerson(db, id, () => db.query(`select public.export_my_data() as d`));
  const read = readExportFile(rows[0]?.d);
  if (!read.ok) throw new Error(read.reason);
  return read.value;
}

/** A picture that is recognisably its own: its path, as bytes. */
const fakePicture = (path: string) => new TextEncoder().encode(`picture ${path}`);

export async function runDrill(
  adminUrl: string,
  options: { zip?: Uint8Array } = {},
  say: Say = () => undefined,
): Promise<string[]> {
  const problems: string[] = [];
  const latest = migrations().at(-1)!.version;
  const given = options.zip ? openExportZip(options.zip) : null;
  if (given && !given.ok) return [given.reason];
  const schema = given?.ok ? given.value.file.schema : latest;
  if (!migrations().some((m) => m.version === schema))
    return [`No migration ${schema} in this copy of the app.`];

  const scratches: Scratch[] = [];
  const clients: Client[] = [];
  const open = async (upTo: string) => {
    const s = await scratchDatabase(adminUrl, 'dagmawit_drill', upTo);
    scratches.push(s);
    const c = await connect(s.url);
    clients.push(c);
    return c;
  };

  try {
    // 1. The original: her data, from the given file or made up in every table.
    const first = await open(schema);
    let owner: string;
    const stored = new Map<string, Uint8Array>();
    if (given?.ok) {
      owner = await newAccount(first, given.value.file.owner_id);
      await first.query(`select app.restore_owner($1, $2::jsonb)`, [owner, JSON.stringify(given.value.file)]);
      for (const [path, bytes] of given.value.pictures) stored.set(path, bytes);
      if (given.value.missing.length > 0)
        problems.push(`The file lacks ${given.value.missing.length} pictures.`);
      say(`Restored the given file (schema ${schema}) into a fresh database.`);
    } else {
      owner = await newAccount(first);
      const { pictures } = await asPerson(first, owner, () => fillPerson(first));
      for (const path of pictures) stored.set(path, fakePicture(path));
      say('Made a person with something in every table.');
    }

    // 2. Her export, as the app makes it.
    const before = await exportOf(first, owner);
    const empty = Object.entries(before.tables).filter(([, rows]) => rows.length === 0);
    if (!given && empty.length > 0) problems.push(`Nothing to test in: ${empty.map(([t]) => t).join(', ')}.`);
    if (given?.ok) {
      const drift = differences(given.value.file, before);
      if (drift.length > 0) problems.push(...drift.map((d) => `The given file came back different: ${d}`));
    }
    const zip = await collect(exportZip(before, async (path) => stored.get(path) ?? null));
    const opened = openExportZip(zip);
    if (!opened.ok) return [...problems, `The export could not be read back: ${opened.reason}`];
    if (opened.value.missing.length > 0)
      problems.push(`The export lacks pictures: ${opened.value.missing.join(', ')}`);
    say(
      `Exported ${Object.values(before.tables).reduce((n, rows) => n + rows.length, 0)} rows and ` +
        `${opened.value.pictures.size} pictures (${zip.length} bytes).`,
    );

    // 3. Restored as someone else, into a second fresh database, pictures moved to the new folder.
    const second = await open(schema);
    const other = await newAccount(second);
    await second.query(`select app.restore_owner($1, $2::jsonb)`, [other, JSON.stringify(opened.value.file)]);
    const restored = new Map<string, Uint8Array>();
    for (const [path, bytes] of opened.value.pictures) restored.set(movedPath(path, owner, other), bytes);
    say('Restored it as another person into a second fresh database.');

    // 4. The same data, row by row, and every picture in its place.
    const after = await exportOf(second, other);
    problems.push(...differences(before, after));
    for (const p of picturesOf(after)) {
      const bytes = restored.get(p.path);
      const original = stored.get(movedPath(p.path, other, owner));
      if (!bytes || !original || Buffer.compare(Buffer.from(bytes), Buffer.from(original)) !== 0)
        problems.push(`Picture ${p.path} did not come back as it was.`);
    }
    say(problems.length === 0 ? 'The two exports are the same, the owner aside.' : 'The exports differ.');

    // 5. An older file: bring the database up to this version of the app.
    if (schema !== latest) {
      await migrate(second, { from: schema });
      say(`Migrated the restored database from ${schema} to ${latest}.`);
    }

    // 6. She can carry on: a new order with its history line, and a new plan.
    await asPerson(second, other, async () => {
      const lastSeq = Number(
        (await second.query(`select coalesce(max(seq), 0) as n from public.activity_log`)).rows[0]?.n,
      );
      await second.query(
        `select public.create_order(null, 'After the drill', '', null,
                (app.today_for((select auth.uid())) + 30)::date, null, '', 'Evening dress', '', false)`,
      );
      const newSeq = Number((await second.query(`select max(seq) as n from public.activity_log`)).rows[0]?.n);
      if (!(newSeq > lastSeq)) problems.push('The history did not carry on after the restored lines.');
      const counters = (
        await second.query(
          `select plan_epoch as e, progress_epoch as p, to_char(app.today_for((select auth.uid())), 'YYYY-MM-DD') as d
           from public.profile`,
        )
      ).rows[0]!;
      const n = (
        await second.query(`select public.save_proposal($1, $2, $3::date, '{}'::jsonb, '[]'::jsonb) as n`, [
          counters.e,
          counters.p,
          counters.d,
        ])
      ).rows[0]!.n;
      await second.query(`select public.approve_plan($1)`, [n]);
    });
    say('She carried on: a new order, its history line, and a new plan approved.');
  } catch (error) {
    problems.push(`The drill stopped: ${(error as Error).message}`);
  } finally {
    for (const c of clients) await c.end().catch(() => undefined);
    for (const s of scratches) await s.drop().catch(() => undefined);
  }
  return problems;
}
