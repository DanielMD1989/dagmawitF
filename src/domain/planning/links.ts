/**
 * Tasks and the links between them, as lists. Used by the library and by an order's Plan tab, so a list of tasks
 * always reads in the order the work is done, and a link that would make a loop is never offered.
 */

export interface Sortable {
  id: string;
  /** Her order of entry: breaks ties between tasks the links leave free. */
  sort: number;
}

export interface Link {
  from: string;
  to: string;
}

const bySort = (a: Sortable, b: Sortable) => a.sort - b.sort || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The tasks in the order the work is done: every task after the tasks it follows, and among those free to go
 * next, the one entered first. Links to tasks not in the list are ignored. (A loop cannot be stored; if one
 * ever were, its tasks would come last, in their entered order, rather than vanish.)
 */
export function inWorkOrder<T extends Sortable>(tasks: readonly T[], links: readonly Link[]): T[] {
  const ids = new Set(tasks.map((t) => t.id));
  const waiting = new Map<string, number>(tasks.map((t) => [t.id, 0]));
  const next = new Map<string, string[]>();
  for (const l of links) {
    if (!ids.has(l.from) || !ids.has(l.to) || l.from === l.to) continue;
    waiting.set(l.to, (waiting.get(l.to) ?? 0) + 1);
    next.set(l.from, [...(next.get(l.from) ?? []), l.to]);
  }
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const ready = tasks.filter((t) => waiting.get(t.id) === 0).sort(bySort);
  const out: T[] = [];
  while (ready.length > 0) {
    const t = ready.shift() as T;
    out.push(t);
    for (const to of next.get(t.id) ?? []) {
      const left = (waiting.get(to) ?? 0) - 1;
      waiting.set(to, left);
      if (left === 0) {
        ready.push(byId.get(to) as T);
        ready.sort(bySort);
      }
    }
  }
  if (out.length < tasks.length) {
    const placed = new Set(out.map((t) => t.id));
    out.push(...tasks.filter((t) => !placed.has(t.id)).sort(bySort));
  }
  return out;
}

/** Every task that comes after this one, however far down the links. */
export function followersOf(id: string, links: readonly Link[]): Set<string> {
  const found = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const at = stack.pop() as string;
    for (const l of links) {
      if (l.from === at && !found.has(l.to)) {
        found.add(l.to);
        stack.push(l.to);
      }
    }
  }
  return found;
}

/**
 * The tasks this one could be linked after: not itself, not one it already follows directly, and not one that
 * comes after it, which would make a loop the database refuses.
 */
export function possiblePredecessors<T extends { id: string }>(
  id: string,
  tasks: readonly T[],
  links: readonly Link[],
): T[] {
  const after = followersOf(id, links);
  const already = new Set(links.filter((l) => l.to === id).map((l) => l.from));
  return tasks.filter((t) => t.id !== id && !after.has(t.id) && !already.has(t.id));
}
