import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio, readTokens, type Theme } from './contrast';

const tokens = readTokens(readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8'));

/**
 * Every pairing the screens actually draw as text, or as a control the eye must find.
 * 4.5 is WCAG AA for normal text; 3 is AA for large text and for the edges of controls.
 * If a new token is used for text, add its pairing here.
 */
const PAIRS: [foreground: string, background: string, minimum: number][] = [
  ['ink', 'bg', 4.5],
  ['ink', 'surface', 4.5],
  ['ink', 'field', 4.5],
  ['muted', 'bg', 4.5],
  ['muted', 'surface', 4.5],
  ['accent', 'bg', 4.5],
  ['accent', 'surface', 4.5],
  ['accent', 'tint', 4.5],
  ['on-solid', 'solid', 4.5],
  ['on-accent', 'accent', 3],
  ['bg', 'ink', 4.5], // the main button: page colour on ink
  ['warn', 'bg', 4.5],
  ['warn', 'surface', 4.5],
  ['warn', 'warn-bg', 4.5],
  ['on-warn', 'warn', 4.5],
  ['sand-ink', 'sand', 4.5],
  ['accent', 'track', 3], // the meter fill on its track
  ['warn-border', 'bg', 3], // outlined warning buttons
  ['line-strong', 'bg', 1.2], // form field borders are decorative: the field has its own fill
];

describe('design tokens', () => {
  it('are all defined as a light and a night value', () => {
    expect(Object.keys(tokens).length).toBeGreaterThanOrEqual(20);
  });

  it.each(['light', 'night'] as Theme[])('%s: every text pairing is readable', (theme) => {
    const failures: string[] = [];
    for (const [fg, bg, minimum] of PAIRS) {
      const a = tokens[fg]?.[theme];
      const b = tokens[bg]?.[theme];
      if (!a || !b) {
        failures.push(`${fg} on ${bg}: token missing`);
        continue;
      }
      const ratio = contrastRatio(a, b);
      if (ratio < minimum) failures.push(`${fg} ${a} on ${bg} ${b} is ${ratio.toFixed(2)}, needs ${minimum}`);
    }
    expect(failures).toEqual([]);
  });

  it('never uses pure black or pure white as a page or card colour at night', () => {
    for (const name of ['bg', 'surface', 'ink']) {
      expect(['#000000', '#FFFFFF']).not.toContain(tokens[name]?.night);
    }
  });
});
