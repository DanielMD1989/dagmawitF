/**
 * Finding a client by what she types (decision 0109): her clients are many, so she is never shown them all to pick
 * from. Two letters of a name, or three digits of a phone, are enough to start; the best matches come first.
 */

/** What she must type before any client is suggested. */
export const MIN_LETTERS = 2;
export const MIN_DIGITS = 3;

export interface Findable {
  name: string;
  phone: string;
}

/** Without case or accents, so "selam" finds "Sélam". */
const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim();
const digitsOf = (s: string) => s.replace(/\D/g, '');

/** Whether what she typed is enough to look. */
export function enoughToSearch(query: string): boolean {
  const q = fold(query);
  if (/^[\d\s+()-]+$/.test(q)) return digitsOf(q).length >= MIN_DIGITS;
  return [...q.replace(/\s/g, '')].length >= MIN_LETTERS;
}

/**
 * How well a client matches, lower is better, or null for no match: her name starting with it; then every word typed
 * starting a word of her name ("sel bek" finds Selam Bekele); then anywhere in her name; then her phone's digits.
 */
function rank(c: Findable, query: string): number | null {
  const q = fold(query);
  const name = fold(c.name);
  const words = name.split(/\s+/);
  const typed = q.split(/\s+/).filter(Boolean);
  if (name.startsWith(q)) return 0;
  if (typed.every((t) => words.some((w) => w.startsWith(t)))) return 1;
  if (name.includes(q)) return 2;
  const digits = digitsOf(q);
  if (digits.length >= MIN_DIGITS && digits.length === q.replace(/[\s+()-]/g, '').length) {
    if (digitsOf(c.phone).includes(digits)) return 3;
  }
  return null;
}

/** Her clients matching what she typed, best first, then by name; none until she has typed enough. */
export function findClients<C extends Findable>(clients: readonly C[], query: string, limit = 6): C[] {
  if (!enoughToSearch(query)) return [];
  return clients
    .map((c) => ({ c, r: rank(c, query) }))
    .filter((x): x is { c: C; r: number } => x.r !== null)
    .sort((a, b) => a.r - b.r || a.c.name.localeCompare(b.c.name))
    .slice(0, limit)
    .map((x) => x.c);
}
