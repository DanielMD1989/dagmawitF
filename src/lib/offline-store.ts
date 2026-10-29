import { z } from 'zod';
import { SNAPSHOT_VERSION, type DaySnapshot, type WaitingTap } from '@/domain/day/offline';
import { TASK_STATUSES } from '@/domain/day/progress';
import { TASK_KINDS } from '@/domain/planning/words';

/**
 * What My Day keeps on the phone (docs/harden.md): today's snapshot and the taps waiting for the signal. Browser
 * storage can hold anything (an older version of the app wrote it, or it was cut off halfway), so everything read
 * back is checked, and anything that does not fit is treated as absent. Safe to import from client components.
 */

const SNAPSHOT_KEY = 'dagmawit.today.v1';
const WAITING_KEY = 'dagmawit.waiting.v1';
/** Tells the other open pages of the app that the waiting taps changed. */
export const WAITING_EVENT = 'dagmawit:waiting';

const minutes = z.number().int().min(0).max(100_000);
const status = z.enum(TASK_STATUSES);

const snapshotSchema = z.object({
  version: z.literal(SNAPSHOT_VERSION),
  ownerId: z.string().min(1),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.string().min(1),
  madeAt: z.iso.datetime(),
  firstName: z.string(),
  planNumber: z.number().int().nullable(),
  plannedMinutes: minutes,
  usableMinutes: minutes,
  freeMinutes: minutes,
  entries: z.array(
    z.object({
      id: z.string().min(1),
      section: z.enum(['fixed', 'work', 'started']),
      title: z.string(),
      orderLabel: z.string().nullable(),
      kind: z.enum(TASK_KINDS),
      minutes: minutes.nullable(),
      minutesToday: minutes,
      time: z.string().nullable(),
      status,
      remainingMinutes: minutes.nullable(),
      actualMinutes: minutes.nullable(),
      state: z.enum(['done', 'started', 'held', 'blocked', 'ready']),
      reason: z.string().nullable(),
    }),
  ),
}) satisfies z.ZodType<DaySnapshot>;

const waitingSchema = z.array(
  z.object({
    key: z.string().min(1),
    ownerId: z.string().min(1),
    taskId: z.string().min(1),
    title: z.string(),
    seen: status,
    change: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('start') }),
      z.object({ kind: z.literal('done'), doneOn: z.string(), actualMinutes: minutes.nullable() }),
      z.object({ kind: z.literal('remaining'), minutes }),
    ]),
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
    window.localStorage.removeItem(SNAPSHOT_KEY);
    window.localStorage.removeItem(WAITING_KEY);
  } catch {
    // Nothing was kept.
  }
}
