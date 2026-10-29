/**
 * Counting time against the calendar. Days are whole numbers; `cap[d]` is the minutes free on
 * day d. Anything outside the calendar has no time.
 */

/**
 * The day on which `minutes` of work, started on `from` with every minute of every day free,
 * would be finished. Infinity if the calendar does not have that much time.
 */
export function finishIdeal(cap: readonly number[], from: number, minutes: number): number {
  if (minutes <= 0) return from;
  let remaining = minutes;
  for (let d = Math.max(from, 0); d < cap.length; d++) {
    remaining -= cap[d] ?? 0;
    if (remaining <= 0) return d;
  }
  return Infinity;
}

/**
 * The latest day on which `minutes` of work could start and still be finished by `to`, with
 * every minute of every day free. -Infinity if the calendar does not have that much time.
 */
export function startIdeal(cap: readonly number[], to: number, minutes: number): number {
  if (minutes <= 0) return to;
  let remaining = minutes;
  for (let d = Math.min(to, cap.length - 1); d >= 0; d--) {
    remaining -= cap[d] ?? 0;
    if (remaining <= 0) return d;
  }
  return -Infinity;
}

export interface Chunk {
  day: number;
  minutes: number;
}

/**
 * Takes `minutes` from the earliest days on or after `from` that have time free, without
 * changing `free`. A day's leftover smaller than `minSlot` is skipped unless it finishes the
 * task. Returns null when the calendar runs out first.
 */
export function takeEarliest(
  free: readonly number[],
  from: number,
  minutes: number,
  minSlot: number,
): Chunk[] | null {
  const chunks: Chunk[] = [];
  let remaining = minutes;
  for (let d = Math.max(from, 0); d < free.length && remaining > 0; d++) {
    const available = free[d] ?? 0;
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    if (take < remaining && take < minSlot) continue;
    chunks.push({ day: d, minutes: take });
    remaining -= take;
  }
  return remaining > 0 ? null : chunks;
}
