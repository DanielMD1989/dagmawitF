import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The sign-in settings of the local Supabase stack (supabase/config.toml), which CI and the browser suite run on.
 * Two settings with the same name do different things, and getting them crossed once stopped every sign-in code.
 */

function setting(toml: string, section: string, key: string): string | undefined {
  let current = '';
  for (const raw of toml.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) current = header[1]!;
    else if (current === section) {
      const pair = /^([\w.]+)\s*=\s*(.+)$/.exec(line);
      if (pair?.[1] === key) return pair[2]!.trim();
    }
  }
  return undefined;
}

const config = readFileSync(join(import.meta.dirname, '..', 'supabase', 'config.toml'), 'utf8');

describe('sign-in settings of the local Supabase stack', () => {
  it('lets no one create an account from the sign-in form', () => {
    expect(setting(config, 'auth', 'enable_signup')).toBe('false');
  });

  it('keeps signing in by emailed code switched on (the email "enable_signup" is the email method itself)', () => {
    expect(setting(config, 'auth.email', 'enable_signup')).toBe('true');
  });

  it('sends six-digit codes, at most one a minute, valid for an hour', () => {
    expect(setting(config, 'auth.email', 'otp_length')).toBe('6');
    expect(setting(config, 'auth.email', 'max_frequency')).toBe('"1m0s"');
    expect(setting(config, 'auth.email', 'otp_expiry')).toBe('3600');
  });
});
