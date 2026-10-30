/**
 * The steps offered as buttons when she builds a job (decision 0068): the steps she has used, most used first, then
 * the common ones she has not used yet. Matched without regard to capitals, shown as she first wrote them.
 */
export const COMMON_STEPS = [
  'Appointment',
  'Sketch',
  'Buy fabric',
  'Cutting',
  'Sewing',
  'Fitting',
  'Fix',
  'Finishing and pressing',
  'Delivery',
] as const;

export function usualSteps(used: readonly { title: string; times: number }[], most = 16): string[] {
  const seen = new Map<string, string>();
  for (const u of [...used].sort((a, b) => b.times - a.times || a.title.localeCompare(b.title))) {
    const key = u.title.trim().toLowerCase();
    if (key && !seen.has(key)) seen.set(key, u.title.trim());
  }
  for (const c of COMMON_STEPS) if (!seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c);
  return [...seen.values()].slice(0, most);
}
