import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, newNonce, originOf } from './csp';

const directives = (policy: string) =>
  Object.fromEntries(policy.split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1)]));

describe('the Content-Security-Policy', () => {
  it('runs scripts only from the app with the request’s nonce', () => {
    const p = directives(contentSecurityPolicy('abc', { storageOrigin: null, dev: false }));
    expect(p['script-src']).toEqual(["'self'", "'nonce-abc'", "'strict-dynamic'"]);
    expect(p['script-src']).not.toContain("'unsafe-inline'");
    expect(p['default-src']).toEqual(["'self'"]);
  });

  it('allows evaluated code only in development', () => {
    expect(contentSecurityPolicy('n', { storageOrigin: null, dev: true })).toContain("'unsafe-eval'");
    expect(contentSecurityPolicy('n', { storageOrigin: null, dev: false })).not.toContain('unsafe-eval');
  });

  it('takes pictures from storage, and nothing else from elsewhere', () => {
    const p = directives(contentSecurityPolicy('n', { storageOrigin: 'https://x.supabase.co', dev: false }));
    expect(p['img-src']).toEqual(["'self'", 'blob:', 'data:', 'https://x.supabase.co']);
    expect(p['connect-src']).toEqual(["'self'"]);
    expect(p['frame-ancestors']).toEqual(["'none'"]);
    expect(p['object-src']).toEqual(["'none'"]);
    expect(p['form-action']).toEqual(["'self'"]);
    expect(p['base-uri']).toEqual(["'self'"]);
  });

  it('reads the storage origin from the settings, or none', () => {
    expect(originOf('https://x.supabase.co/some/path')).toBe('https://x.supabase.co');
    expect(originOf(undefined)).toBeNull();
    expect(originOf('not a url')).toBeNull();
  });

  it('makes a different nonce each time', () => {
    const a = newNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(newNonce()).not.toBe(a);
  });
});
