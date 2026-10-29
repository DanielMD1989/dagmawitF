/** Appearance choice. 'system' follows her phone; the other two override it. */
export const THEMES = ['system', 'light', 'night'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_COOKIE = 'dagmawit-theme';

export function parseTheme(value: unknown): Theme {
  return THEMES.find((t) => t === value) ?? 'system';
}

export const THEME_LABELS: Record<Theme, string> = {
  system: 'Follow my phone',
  light: 'Light',
  night: 'Night',
};

/** Browser chrome colours, matching --bg in globals.css. */
export const THEME_COLORS = { light: '#F6F2EA', night: '#2A2723' } as const;
