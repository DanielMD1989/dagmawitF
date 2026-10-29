/** WCAG 2.x contrast ratio between two #RRGGBB colours (1 to 21). */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

export type Theme = 'light' | 'night';

/** Reads the design tokens out of globals.css, the single place they are defined. */
export function readTokens(css: string): Record<string, Record<Theme, string>> {
  const tokens: Record<string, Record<Theme, string>> = {};
  for (const m of css.matchAll(
    /--([a-z0-9-]+):\s*light-dark\(\s*(#[0-9A-Fa-f]{6})\s*,\s*(#[0-9A-Fa-f]{6})\s*\)/g,
  )) {
    tokens[m[1]!] = { light: m[2]!.toUpperCase(), night: m[3]!.toUpperCase() };
  }
  return tokens;
}
