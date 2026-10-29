import { Zip, ZipDeflate, ZipPassThrough, strFromU8, strToU8, unzipSync } from 'fflate';
import { picturesOf, readExportFile, readmeText, type ExportFile, type Read } from './format';

/**
 * The export as a zip: data.json, each picture under files/, and README.txt. Made as a stream, one picture at a
 * time as the download asks for more, so a long export never holds every picture in memory at once.
 *
 * `readPicture` gives a picture's bytes, or null when it cannot be read; a picture that cannot be read is listed in
 * the README instead of failing the whole export.
 */
export function exportZip(
  file: ExportFile,
  readPicture: (path: string) => Promise<Uint8Array | null>,
): ReadableStream<Uint8Array> {
  const pictures = picturesOf(file);
  const missing: string[] = [];
  const ready: Uint8Array[] = [];
  let failed: Error | null = null;
  let finished = false;
  let next = 0;
  let ended = false;

  const zip = new Zip((error, chunk, final) => {
    if (error) failed = error;
    else {
      ready.push(chunk);
      if (final) finished = true;
    }
  });
  const add = (name: string, bytes: Uint8Array, compress: boolean) => {
    // Pictures are compressed already; squeezing them again costs time and saves nothing.
    const entry = compress ? new ZipDeflate(name, { level: 6 }) : new ZipPassThrough(name);
    zip.add(entry);
    entry.push(bytes, true);
  };

  return new ReadableStream<Uint8Array>({
    start() {
      add('data.json', strToU8(JSON.stringify(file, null, 1)), true);
    },
    async pull(controller) {
      while (ready.length === 0 && !finished && !failed) {
        const picture = pictures[next];
        if (picture) {
          next += 1;
          const bytes = await readPicture(picture.path);
          if (bytes) add(`files/${picture.path}`, bytes, false);
          else missing.push(picture.path);
        } else if (!ended) {
          ended = true;
          add('README.txt', strToU8(readmeText(file, missing)), true);
          zip.end();
        }
      }
      if (failed) {
        controller.error(failed);
        return;
      }
      for (const chunk of ready.splice(0)) controller.enqueue(chunk);
      if (finished) controller.close();
    },
  });
}

/** Everything in a stream, as one array of bytes. */
export async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  return all;
}

export interface OpenedExport {
  file: ExportFile;
  /** Each picture's bytes, by its stored path. */
  pictures: Map<string, Uint8Array>;
  /** Pictures the data names that are not in the zip. */
  missing: string[];
}

/** Reads an export zip back: its data, checked, and its pictures. */
export function openExportZip(bytes: Uint8Array): Read<OpenedExport> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    return { ok: false, reason: 'This is not a zip file, or it is damaged.' };
  }
  const data = entries['data.json'];
  if (!data) return { ok: false, reason: 'The zip has no data.json: it is not a DAGMAWIT export.' };
  let json: unknown;
  try {
    json = JSON.parse(strFromU8(data));
  } catch {
    return { ok: false, reason: 'data.json is damaged.' };
  }
  const read = readExportFile(json);
  if (!read.ok) return read;

  const pictures = new Map<string, Uint8Array>();
  const missing: string[] = [];
  for (const p of picturesOf(read.value)) {
    const found = entries[`files/${p.path}`];
    if (found) pictures.set(p.path, found);
    else missing.push(p.path);
  }
  return { ok: true, value: { file: read.value, pictures, missing } };
}
