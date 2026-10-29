import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_KINDS,
  ATTACHMENT_KIND_LABEL,
  IMAGE_TYPES,
  MAX_FILE_BYTES,
  MAX_PICTURE_SIDE,
  checkUpload,
  compareAttachments,
  extensionFor,
  parseAttachmentDetails,
  parseCaption,
  shrunkSize,
  sniffImageType,
  strayFiles,
  storagePath,
} from './files';

const bytes = (...b: number[]) => new Uint8Array(b);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0);
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50);
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe('what a file really is', () => {
  it('is told by its first bytes', () => {
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(WEBP)).toBe('image/webp');
  });

  it.each([
    ['a GIF', bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)],
    ['a PDF', bytes(0x25, 0x50, 0x44, 0x46, 0x2d)],
    ['a web page', new TextEncoder().encode('<html><script>alert(1)</script>')],
    [
      'a RIFF file that is not WebP (a WAV)',
      bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45),
    ],
    ['a PNG cut short', bytes(0x89, 0x50, 0x4e, 0x47)],
    ['nothing', bytes()],
  ])('refuses %s', (_label, head) => expect(sniffImageType(head)).toBeNull());

  it('judges an upload by size and content, not by its name or the type the browser claims', () => {
    expect(checkUpload(120_000, JPEG)).toEqual({ ok: true, type: 'image/jpeg' });
    expect(checkUpload(MAX_FILE_BYTES, PNG)).toEqual({ ok: true, type: 'image/png' });
    expect(checkUpload(MAX_FILE_BYTES + 1, PNG)).toMatchObject({
      ok: false,
      message: expect.stringContaining('5 MB'),
    });
    expect(checkUpload(0, JPEG)).toMatchObject({ ok: false });
    expect(checkUpload(500, new TextEncoder().encode('<svg onload=alert(1)>'))).toMatchObject({ ok: false });
  });
});

describe('where a file is kept', () => {
  const owner = '11111111-1111-4111-8111-111111111111';
  const order = '22222222-2222-4222-8222-222222222222';
  const file = '33333333-3333-4333-8333-333333333333';

  it('is her folder, the order, then the file', () => {
    expect(storagePath(owner, order, file, 'image/jpeg')).toBe(`${owner}/${order}/${file}.jpg`);
    expect(storagePath(owner, order, file, 'image/png')).toBe(`${owner}/${order}/${file}.png`);
    expect(storagePath(owner, order, file, 'image/webp')).toBe(`${owner}/${order}/${file}.webp`);
  });

  it('has an extension for every type we keep', () => {
    expect(IMAGE_TYPES.map(extensionFor)).toEqual(['jpg', 'png', 'webp']);
  });
});

describe('shrinking a picture', () => {
  it('keeps the shape and brings the longest side down to the limit', () => {
    expect(shrunkSize(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(shrunkSize(3000, 4000)).toEqual({ width: 1200, height: 1600 });
  });

  it('never makes a picture bigger', () => {
    expect(shrunkSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(shrunkSize(MAX_PICTURE_SIDE, 10)).toEqual({ width: MAX_PICTURE_SIDE, height: 10 });
  });

  it('never makes a side vanish', () => {
    expect(shrunkSize(100_000, 10)).toEqual({ width: 1600, height: 1 });
  });
});

describe('what she says about a picture', () => {
  it('is its kind and an optional caption', () => {
    expect(parseAttachmentDetails(form({ kind: 'sketch', caption: ' First idea ' }))).toEqual({
      ok: true,
      value: { kind: 'sketch', caption: 'First idea' },
    });
    expect(parseAttachmentDetails(form({ kind: 'fabric' }))).toEqual({
      ok: true,
      value: { kind: 'fabric', caption: '' },
    });
  });

  it('refuses a kind we do not have, and a long caption', () => {
    expect(parseAttachmentDetails(form({ kind: 'receipt' }))).toMatchObject({
      ok: false,
      errors: { kind: expect.any(String) },
    });
    expect(parseAttachmentDetails(form({ kind: 'sketch', caption: 'c'.repeat(201) }))).toMatchObject({
      ok: false,
      errors: { caption: expect.any(String) },
    });
  });

  it('has a caption that can be changed on its own', () => {
    expect(parseCaption(form({ caption: ' Longer train ' }))).toEqual({ ok: true, value: 'Longer train' });
    expect(parseCaption(form({}))).toEqual({ ok: true, value: '' });
    expect(parseCaption(form({ caption: '😀'.repeat(200) })).ok).toBe(true);
    expect(parseCaption(form({ caption: '😀'.repeat(201) }))).toMatchObject({
      ok: false,
      errors: { caption: 'Keep the caption under 200 characters.' },
    });
  });

  it('has words for every kind', () => {
    for (const k of ATTACHMENT_KINDS) expect(ATTACHMENT_KIND_LABEL[k].length).toBeGreaterThan(0);
  });
});

describe('the order pictures are shown in', () => {
  const pic = (kind: (typeof ATTACHMENT_KINDS)[number], version: number) => ({ kind, version });

  it('puts her sketches first, then the client’s pictures, then fabric, then fittings', () => {
    const shuffled = [
      pic('other', 1),
      pic('fitting', 1),
      pic('fabric', 1),
      pic('inspiration', 1),
      pic('sketch', 1),
    ];
    expect([...shuffled].sort(compareAttachments).map((p) => p.kind)).toEqual([...ATTACHMENT_KINDS]);
  });

  it('keeps the oldest version of a kind first', () => {
    const sorted = [pic('sketch', 3), pic('sketch', 1), pic('sketch', 2)].sort(compareAttachments);
    expect(sorted.map((p) => p.version)).toEqual([1, 2, 3]);
  });

  it('knows every kind', () => {
    for (const kind of ATTACHMENT_KINDS) expect(compareAttachments(pic(kind, 1), pic(kind, 1))).toBe(0);
  });
});

describe('stray stored pictures', () => {
  const now = new Date('2026-10-30T12:00:00Z');
  const file = (path: string, createdAt: string | null) => ({ path, createdAt });

  it('are the stored files no record points to, an hour old or more', () => {
    expect(
      strayFiles(
        [
          file('o/1/b.jpg', '2026-10-30T10:00:00Z'),
          file('o/1/a.jpg', '2026-10-30T11:00:00Z'),
          file('o/1/kept.jpg', '2026-10-01T00:00:00Z'),
        ],
        new Set(['o/1/kept.jpg']),
        now,
      ),
    ).toEqual(['o/1/a.jpg', 'o/1/b.jpg']);
  });

  it('leave alone a file younger than an hour: its record may be on its way', () => {
    expect(strayFiles([file('o/1/new.jpg', '2026-10-30T11:00:01Z')], new Set(), now)).toEqual([]);
  });

  it('leave alone a file whose age is not known', () => {
    expect(strayFiles([file('o/1/x.jpg', null), file('o/1/y.jpg', 'yesterday')], new Set(), now)).toEqual([]);
  });
});
