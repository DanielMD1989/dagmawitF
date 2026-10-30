import { z } from 'zod';
import { SNAPSHOT_VERSION, type DaySnapshot, type WaitingTap } from '@/domain/steps/offline';

/**
 * What Today keeps on the phone (docs/harden.md): its snapshot and the ticks waiting for the signal. Browser
 * storage can hold anything (an older version of the app wrote it, or it was cut off halfway), so everything read
 * back is checked, and anything that does not fit is treated as absent. Safe to import from client components.
 */

// Each change of what is kept takes a new key, so an older shape is simply not read (decisions 0066, 0068).
const SNAPSHOT_KEY = 'dagmawit.today.v3';
const WAITING_KEY = 'dagmawit.waiting.v2';
/** What earlier versions kept, removed on sign-out like the rest. */
const OLD_KEYS = ['dagmawit.today.v1', 'dagmawit.waiting.v1', 'dagmawit.today.v2'];
/** Tells the other open pages of the app that the waiting taps changed. */
export const WAITING_EVENT = 'dagmawit:waiting';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const entry = z.object({
  id: z.string().min(1),
  title: z.string(),
  work: z.string().nullable(),
  time: z.string().nullable(),
  part: z.string().nullable(),
  done: z.boolean(),
  clash: z.boolean(),
});

const snapshotSchema = z.object({
  version: z.literal(SNAPSHOT_VERSION),
  ownerId: z.string().min(1),
  day,
  timezone: z.string().min(1),
  madeAt: z.iso.datetime(),
  firstName: z.string(),
  overdue: z.array(entry),
  days: z.array(z.object({ day, heading: z.string(), entries: z.array(entry) })),
}) satisfies z.ZodType<DaySnapshot>;

const waitingSchema = z.array(
  z.object({
    key: z.string().min(1),
    ownerId: z.string().min(1),
    stepId: z.string().min(1),
    title: z.string(),
    sawDone: z.boolean(),
    done: z.boolean(),
    at: z.iso.datetime(),
  }),
) satisfies z.ZodType<WaitingTap[]>;

// The last value read for each key, so reading the same stored text twice gives the same object (what React's
// useSyncExternalStore needs to know nothing changed).
const lastRead = new Map<string, { raw: string | null; value: unknown }>();

function read<T>(key: string, schema: z.ZodType<T>, absent: T): T {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return absent;
  }
  const last = lastRead.get(key);
  if (last && last.raw === raw) return last.value as T;
  let value: T = absent;
  if (raw !== null) {
    try {
      const parsed = schema.safeParse(JSON.parse(raw));
      if (parsed.success) value = parsed.data;
    } catch {
      // Not JSON: treated as absent.
    }
  }
  lastRead.set(key, { raw, value });
  return value;
}

function write(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Storage full or blocked (a private window): the app still works online.
    return false;
  }
}

export function readSnapshot(): DaySnapshot | null {
  return read<DaySnapshot | null>(SNAPSHOT_KEY, snapshotSchema, null);
}

export function saveSnapshot(snapshot: DaySnapshot): boolean {
  return write(SNAPSHOT_KEY, snapshot);
}

const NONE: WaitingTap[] = [];

export function readWaiting(): WaitingTap[] {
  return read<WaitingTap[]>(WAITING_KEY, waitingSchema, NONE);
}

export function saveWaiting(waiting: readonly WaitingTap[]): boolean {
  const saved = write(WAITING_KEY, waiting);
  window.dispatchEvent(new Event(WAITING_EVENT));
  return saved;
}

/** Calls `changed` whenever what is kept may have changed: in this page, in another tab, or the signal. */
export function subscribeOffline(changed: () => void): () => void {
  const events = ['storage', WAITING_EVENT, 'online', 'offline'];
  for (const e of events) window.addEventListener(e, changed);
  return () => {
    for (const e of events) window.removeEventListener(e, changed);
  };
}

/** Signing out removes everything of hers from the phone. */
export function forgetOffline(): void {
  try {
    for (const key of [SNAPSHOT_KEY, WAITING_KEY, ...OLD_KEYS]) window.localStorage.removeItem(key);
  } catch {
    // Nothing was kept.
  }
}
