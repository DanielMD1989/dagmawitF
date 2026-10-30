import type { JobKind } from './kinds';

/**
 * Which template a new job of a kind starts with, from what is being made: the one named exactly like the garment;
 * else the one whose name is a word of it ("Dress" for "Evening dress"), the longest such name first; else the
 * first of that kind. Null when she has none of that kind.
 */
export function pickTemplate<T extends { id: string; name: string; kind: JobKind }>(
  templates: readonly T[],
  kind: JobKind,
  garment: string,
): T | null {
  const ofKind = templates.filter((t) => t.kind === kind);
  const wanted = garment.trim().toLowerCase();
  if (wanted !== '') {
    const exact = ofKind.find((t) => t.name.trim().toLowerCase() === wanted);
    if (exact) return exact;
    const words = ` ${wanted.replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
    const within = ofKind
      .filter((t) => {
        const name = t.name
          .trim()
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, ' ')
          .trim();
        return name !== '' && words.includes(` ${name} `);
      })
      .sort((a, b) => b.name.length - a.name.length);
    if (within[0]) return within[0];
  }
  return ofKind[0] ?? null;
}
