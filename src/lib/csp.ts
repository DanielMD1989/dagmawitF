/**
 * The Content-Security-Policy of every page (docs/harden.md, decision 0059). Scripts run only from the app and only
 * with this request's nonce, which Next.js adds to its own scripts; scripts they load are trusted through
 * 'strict-dynamic'. Pictures come from the app and from storage (a picture link redirects there).
 */
export function contentSecurityPolicy(
  nonce: string,
  options: { storageOrigin: string | null; dev: boolean },
): string {
  return [
    `default-src 'self'`,
    // React's development build evaluates code; the production build never does.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${options.dev ? ` 'unsafe-eval'` : ''}`,
    `style-src 'self' 'nonce-${nonce}'`,
    // Style attributes (the day's meter, say) cannot carry a nonce; they cannot run code either.
    `style-src-attr 'unsafe-inline'`,
    `img-src 'self' blob: data:${options.storageOrigin ? ` ${options.storageOrigin}` : ''}`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `worker-src 'self'`,
    `manifest-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ].join('; ');
}

/** The origin of a URL, or null if it is not one (a missing setting: the page explains that itself). */
export function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** A fresh nonce: 128 random bits, base64. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
