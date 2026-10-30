import { chars, text, type FieldErrors, type Result } from './form-input';

/**
 * Sketches and photos. What may be kept, and where. The same limits are in the database (the attachment
 * table and the order-files bucket). A file is checked by what is inside it, never by its name.
 */

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_FILES_PER_ORDER = 40;
/** Photos are shrunk in the browser so that their longest side is at most this many pixels. */
export const MAX_PICTURE_SIDE = 1600;

export const ATTACHMENT_KINDS = ['sketch', 'inspiration', 'fabric', 'fitting', 'other'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export function isAttachmentKind(value: unknown): value is AttachmentKind {
  return typeof value === 'string' && (ATTACHMENT_KINDS as readonly string[]).includes(value);
}

/** Her sketches first, then what the client brought, then fabric, then fittings; within a kind, oldest first. */
export function compareAttachments(
  a: { kind: AttachmentKind; version: number },
  b: { kind: AttachmentKind; version: number },
): number {
  return ATTACHMENT_KINDS.indexOf(a.kind) - ATTACHMENT_KINDS.indexOf(b.kind) || a.version - b.version;
}

export const ATTACHMENT_KIND_LABEL: Readonly<Record<AttachmentKind, string>> = {
  sketch: 'Sketch',
  inspiration: 'Inspiration',
  fabric: 'Fabric',
  fitting: 'Fitting photo',
  other: 'Photo',
};

/**
 * How the job's Design brief page groups its pictures: each kind under its own heading with its own button to add
 * one, so a fitting photo is added under Fittings rather than by picking a kind from a list.
 */
export const ATTACHMENT_GROUP: Readonly<Record<AttachmentKind, { heading: string; add: string }>> = {
  sketch: { heading: 'Sketches', add: 'Add a sketch' },
  inspiration: { heading: 'Inspiration from the client', add: 'Add an inspiration picture' },
  fabric: { heading: 'Fabric', add: 'Add a fabric photo' },
  fitting: { heading: 'Fittings', add: 'Add a fitting photo' },
  other: { heading: 'Other photos', add: 'Add a photo' },
};

/** The type a file really is, from its first bytes. Null if it is not a picture we keep. */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  const at = (i: number) => bytes[i] ?? -1;
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (
    at(0) === 0x89 &&
    at(1) === 0x50 &&
    at(2) === 0x4e &&
    at(3) === 0x47 &&
    at(4) === 0x0d &&
    at(5) === 0x0a &&
    at(6) === 0x1a &&
    at(7) === 0x0a
  )
    return 'image/png';
  // WebP: "RIFF" size "WEBP"
  if (
    at(0) === 0x52 &&
    at(1) === 0x49 &&
    at(2) === 0x46 &&
    at(3) === 0x46 &&
    at(8) === 0x57 &&
    at(9) === 0x45 &&
    at(10) === 0x42 &&
    at(11) === 0x50
  )
    return 'image/webp';
  return null;
}

const EXTENSION: Readonly<Record<ImageType, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function extensionFor(type: ImageType): string {
  return EXTENSION[type];
}

/** Where a file is kept: <her id>/<order id>/<file id>.<ext>. The database insists on exactly this. */
export function storagePath(ownerId: string, orderId: string, fileId: string, type: ImageType): string {
  return `${ownerId}/${orderId}/${fileId}.${extensionFor(type)}`;
}

export type UploadCheck = { ok: true; type: ImageType } | { ok: false; message: string };

/** Judges an upload from its size and its first bytes. */
export function checkUpload(size: number, head: Uint8Array): UploadCheck {
  if (size <= 0) return { ok: false, message: 'That file is empty.' };
  if (size > MAX_FILE_BYTES) return { ok: false, message: 'That picture is too large. The limit is 5 MB.' };
  const type = sniffImageType(head);
  if (!type) return { ok: false, message: 'Only JPEG, PNG or WebP pictures can be added.' };
  return { ok: true, type };
}

/** The size a picture is shrunk to: the same shape, the longest side at most `limit`. Never enlarges. */
export function shrunkSize(width: number, height: number, limit: number = MAX_PICTURE_SIDE) {
  const longest = Math.max(width, height);
  if (longest <= limit) return { width, height };
  const scale = limit / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

const CAPTION_TOO_LONG = 'Keep the caption under 200 characters.';

/** A picture's caption: what she types under it. Optional. */
export function parseCaption(data: FormData): Result<string> {
  const caption = text(data, 'caption');
  return chars(caption) > 200
    ? { ok: false, errors: { caption: CAPTION_TOO_LONG } }
    : { ok: true, value: caption };
}

export interface AttachmentDetails {
  kind: AttachmentKind;
  caption: string;
}

/** The kind and caption she gives a picture when she adds it. */
export function parseAttachmentDetails(data: FormData): Result<AttachmentDetails> {
  const errors: FieldErrors = {};
  const kind = text(data, 'kind');
  if (!isAttachmentKind(kind)) errors.kind = 'Choose what the picture is.';
  const caption = parseCaption(data);
  if (!caption.ok) errors.caption = caption.errors.caption ?? CAPTION_TOO_LONG;
  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, value: { kind: kind as AttachmentKind, caption: caption.ok ? caption.value : '' } };
}

/** How long a stored file may have no record before tidying removes it: longer than any upload takes. */
export const STRAY_AFTER_MS = 60 * 60 * 1000;

/**
 * Stored pictures no record points to (docs/harden.md, "Tidy stored pictures"): left when the server stopped between
 * storing a picture and recording it. A file younger than an hour is never stray: its record may be on its way.
 */
export function strayFiles(
  stored: readonly { path: string; createdAt: string | null }[],
  recorded: ReadonlySet<string>,
  now: Date,
): string[] {
  return stored
    .filter((f) => !recorded.has(f.path))
    .filter((f) => {
      const at = f.createdAt === null ? Number.NaN : Date.parse(f.createdAt);
      return Number.isFinite(at) && now.getTime() - at >= STRAY_AFTER_MS;
    })
    .map((f) => f.path)
    .sort();
}
