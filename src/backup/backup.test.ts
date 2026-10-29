import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  differences,
  exportFileName,
  movedPath,
  picturesOf,
  readExportFile,
  readmeText,
  type ExportFile,
} from './format';
import { collect, exportZip, openExportZip } from './zip';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ORDER = '33333333-3333-4333-8333-333333333333';

function file(owner = A, extra: Partial<ExportFile['tables']> = {}): ExportFile {
  return {
    format: 'dagmawit-export',
    schema: '20261030090000',
    exported_at: '2026-10-30T09:12:00+03:00',
    owner_id: owner,
    tables: {
      profile: [{ owner_id: owner, name: 'Dagmawit', plan_epoch: 4 }],
      attachment: [
        {
          id: 'p1',
          owner_id: owner,
          storage_path: `${owner}/${ORDER}/p1.jpg`,
          content_type: 'image/jpeg',
          size_bytes: 3,
        },
        {
          id: 'p2',
          owner_id: owner,
          storage_path: `${owner}/${ORDER}/p2.png`,
          content_type: 'image/png',
          size_bytes: 2,
        },
      ],
      task: [],
      ...extra,
    },
  };
}

describe('reading an export file', () => {
  it('takes a well-formed file', () => {
    expect(readExportFile(file())).toEqual({ ok: true, value: file() });
  });

  it.each([
    ['another format', { ...file(), format: 'something-else' }],
    ['no schema', { ...file(), schema: undefined }],
    ['a schema that is not a migration name', { ...file(), schema: 'latest' }],
    ['no owner', { ...file(), owner_id: 'nobody' }],
    ['tables that are not lists of rows', { ...file(), tables: { task: 'many' } }],
    ['nothing at all', null],
  ])('refuses %s, saying it is not an export', (_label, json) => {
    const read = readExportFile(json);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toMatch(/^This is not a DAGMAWIT export/);
  });
});

describe('the pieces of an export', () => {
  it('names the file by her day', () => {
    expect(exportFileName('2026-10-30')).toBe('dagmawit-2026-10-30.zip');
  });

  it('finds the pictures in the attachment rows', () => {
    expect(picturesOf(file())).toEqual([
      { path: `${A}/${ORDER}/p1.jpg`, contentType: 'image/jpeg', sizeBytes: 3 },
      { path: `${A}/${ORDER}/p2.png`, contentType: 'image/png', sizeBytes: 2 },
    ]);
    expect(picturesOf({ ...file(), tables: {} })).toEqual([]);
  });

  it('moves a picture into the new owner’s folder, and refuses one outside the old owner’s', () => {
    expect(movedPath(`${A}/${ORDER}/p1.jpg`, A, B)).toBe(`${B}/${ORDER}/p1.jpg`);
    expect(() => movedPath(`${B}/${ORDER}/p1.jpg`, A, B)).toThrow(/outside its owner's folder/);
    expect(() => movedPath(`${A}x/p1.jpg`, A, B)).toThrow();
  });

  it('writes a README that counts what is in it and names a missing picture', () => {
    const text = readmeText(file(), [`${A}/${ORDER}/p2.png`]);
    expect(text).toContain('Made: 2026-10-30T09:12:00+03:00');
    expect(text).toContain('  profile: 1\n  attachment: 2');
    expect(text).not.toContain('task:');
    expect(text).toContain(`1 picture could not be read and is not in this file:\n  ${A}/${ORDER}/p2.png`);
    expect(readmeText(file(), [])).not.toContain('could not be read');
  });
});

describe('comparing two exports (the drill)', () => {
  it('finds none between the same data under two owners', () => {
    expect(differences(file(A), file(B))).toEqual([]);
  });

  it('does not care about the order of rows or of fields', () => {
    const shuffled = file(B);
    shuffled.tables.attachment = [...shuffled.tables.attachment!]
      .reverse()
      .map((r) => Object.fromEntries(Object.entries(r).reverse()));
    expect(differences(file(A), shuffled)).toEqual([]);
  });

  it('names a table with a missing row, a changed value, or one table only on one side', () => {
    const fewer = file(B);
    fewer.tables.attachment = fewer.tables.attachment!.slice(1);
    expect(differences(file(A), fewer)).toEqual(['attachment: 2 rows and 1 rows']);

    const changed = file(B);
    changed.tables.profile = [{ owner_id: B, name: 'Dagmawit', plan_epoch: 5 }];
    expect(differences(file(A), changed)).toEqual([
      'profile: {"name":"Dagmawit","owner_id":"<owner>","plan_epoch":4} and {"name":"Dagmawit","owner_id":"<owner>","plan_epoch":5}',
    ]);

    const extra = file(B, { client: [] });
    expect(differences(file(A), extra)).toEqual(['client: only in the second']);
    expect(differences(file(A), { ...file(B), schema: '20261101090000' })).toEqual([
      'schema: 20261030090000 and 20261101090000',
    ]);
  });
});

describe('the export zip', () => {
  const bytes = new Map([[`${A}/${ORDER}/p1.jpg`, new Uint8Array([1, 2, 3])]]);
  const read = async (path: string) => bytes.get(path) ?? null;

  it('holds the data, each picture it could read, and a README naming the one it could not', async () => {
    const zip = await collect(exportZip(file(), read));
    const opened = openExportZip(zip);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.value.file).toEqual(file());
    expect([...opened.value.pictures.entries()]).toEqual([
      [`${A}/${ORDER}/p1.jpg`, new Uint8Array([1, 2, 3])],
    ]);
    expect(opened.value.missing).toEqual([`${A}/${ORDER}/p2.png`]);
  });

  it('reads each picture only when the download asks for more', async () => {
    const asked: string[] = [];
    const stream = exportZip(file(), async (path) => {
      asked.push(path);
      return new Uint8Array([9]);
    });
    expect(asked).toEqual([]);
    await collect(stream);
    expect(asked).toEqual([`${A}/${ORDER}/p1.jpg`, `${A}/${ORDER}/p2.png`]);
  });

  it('refuses something that is not an export', () => {
    expect(openExportZip(new Uint8Array([1, 2, 3]))).toEqual({
      ok: false,
      reason: 'This is not a zip file, or it is damaged.',
    });
    expect(openExportZip(zipSync({ 'notes.txt': strToU8('hello') }))).toEqual({
      ok: false,
      reason: 'The zip has no data.json: it is not a DAGMAWIT export.',
    });
    expect(openExportZip(zipSync({ 'data.json': strToU8('{oops') }))).toEqual({
      ok: false,
      reason: 'data.json is damaged.',
    });
    const wrong = openExportZip(zipSync({ 'data.json': strToU8('{"format":"other"}') }));
    expect(wrong.ok).toBe(false);
  });
});
