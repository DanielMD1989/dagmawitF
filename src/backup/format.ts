import { z } from 'zod';

/**
 * The export file (docs/harden.md, "The export"). Used by the export route, the restore command and the drill, so
 * it stays free of the server and the browser.
 */

const row = z.record(z.string(), z.unknown());

export const exportFileSchema = z.object({
  format: z.literal('dagmawit-export'),
  /** The last migration of the database it came from (decision 0053). */
  schema: z.string().regex(/^\d{14}$/),
  exported_at: z.string(),
  owner_id: z.uuid(),
  tables: z.record(z.string(), z.array(row)),
});

export type ExportFile = z.infer<typeof exportFileSchema>;

export type Read<T> = { ok: true; value: T } | { ok: false; reason: string };

export function readExportFile(json: unknown): Read<ExportFile> {
  const parsed = exportFileSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      reason: `This is not a DAGMAWIT export (${first ? `${first.path.join('.') || 'file'}: ${first.message}` : 'unreadable'}).`,
    };
  }
  return { ok: true, value: parsed.data };
}

export function exportFileName(today: string): string {
  return `dagmawit-${today}.zip`;
}

export interface Picture {
  path: string;
  contentType: string;
  sizeBytes: number;
}

/** Her pictures, from the file's attachment rows. */
export function picturesOf(file: ExportFile): Picture[] {
  return (file.tables.attachment ?? []).map((r) => ({
    path: String(r.storage_path),
    contentType: String(r.content_type),
    sizeBytes: Number(r.size_bytes),
  }));
}

/** Where a picture goes when the file is restored for another account: the owner part of the path changes. */
export function movedPath(path: string, from: string, to: string): string {
  if (!path.startsWith(`${from}/`))
    throw new Error(`A picture is stored outside its owner's folder: ${path}`);
  return `${to}${path.slice(from.length)}`;
}

/** The plain-words note that goes in the zip beside the data. */
export function readmeText(file: ExportFile, missing: readonly string[]): string {
  const counts = Object.entries(file.tables)
    .filter(([, rows]) => rows.length > 0)
    .map(([table, rows]) => `  ${table}: ${rows.length}`)
    .join('\n');
  const lines = [
    'DAGMAWIT: everything of yours, as it was at one moment.',
    '',
    `Made: ${file.exported_at}`,
    `Schema: ${file.schema}`,
    '',
    'data.json holds every record. files/ holds your pictures.',
    'Keep this file somewhere safe, away from your phone: a computer, a USB stick, a cloud drive.',
    '',
    'To bring it back, whoever looks after the app runs:',
    '  npm run restore -- --file <this file> --owner <your account id> --files',
    'It replaces everything in the account with this file. See docs/operations.md.',
    '',
    'Records:',
    counts,
  ];
  if (missing.length > 0) {
    lines.push(
      '',
      `${missing.length} picture${missing.length === 1 ? '' : 's'} could not be read and ${missing.length === 1 ? 'is' : 'are'} not in this file:`,
      ...missing.map((p) => `  ${p}`),
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * How two exports differ, the owner aside: the drill's comparison. The second may belong to another account, so
 * the owner's id (in `owner_id` and in pictures' paths) is set aside before comparing. Empty when they are the same.
 */
export function differences(a: ExportFile, b: ExportFile): string[] {
  const found: string[] = [];
  if (a.schema !== b.schema) found.push(`schema: ${a.schema} and ${b.schema}`);
  const tables = [...new Set([...Object.keys(a.tables), ...Object.keys(b.tables)])].sort();
  const plain = (file: ExportFile, rows: readonly Record<string, unknown>[]) =>
    rows.map((r) => JSON.stringify(r, Object.keys(r).sort()).split(file.owner_id).join('<owner>')).sort();
  for (const table of tables) {
    const left = a.tables[table];
    const right = b.tables[table];
    if (!left || !right) {
      found.push(`${table}: only in the ${left ? 'first' : 'second'}`);
      continue;
    }
    const l = plain(a, left);
    const r = plain(b, right);
    if (l.length !== r.length) {
      found.push(`${table}: ${l.length} rows and ${r.length} rows`);
      continue;
    }
    const at = l.findIndex((row, i) => row !== r[i]);
    if (at >= 0) found.push(`${table}: ${l[at]} and ${r[at]}`);
  }
  return found;
}
