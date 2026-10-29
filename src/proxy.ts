import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { contentSecurityPolicy, newNonce, originOf } from '@/lib/csp';

/**
 * Runs before every page. It does three jobs:
 *  1. Keeps her session fresh (refreshes the token and rewrites the cookie).
 *  2. Sends people who are not signed in to the sign-in page, and signed-in people away from it.
 *  3. Gives the page its Content-Security-Policy with a fresh nonce (decision 0059). Next.js reads the nonce from
 *     the request's policy and puts it on its own scripts.
 *
 * This is a convenience, not the security boundary. The boundary is row-level security in the
 * database; every page and action also checks the user itself (see src/server/session.ts).
 */
export async function proxy(request: NextRequest) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const policy = contentSecurityPolicy(newNonce(), {
    storageOrigin: originOf(url),
    dev: process.env.NODE_ENV === 'development',
  });
  // Passes the request on with the policy, and with the cookies as they are now (a refresh may have changed them).
  const forward = () => {
    const headers = new Headers(request.headers);
    headers.set('content-security-policy', policy);
    const next = NextResponse.next({ request: { headers } });
    next.headers.set('content-security-policy', policy);
    return next;
  };
  if (!url || !key) {
    // Let the page render its own clear error rather than failing here with no explanation.
    return forward();
  }

  let response = forward();

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list, headers) {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = forward();
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
        // Responses that carry session cookies must never be cached by a CDN.
        for (const [header, value] of Object.entries(headers)) response.headers.set(header, value);
      },
    },
  });

  // Do not put any code between creating the client and this call: it is what refreshes the session.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims.sub);
  const { pathname } = request.nextUrl;
  const onSignIn = pathname === '/sign-in';
  // The page shown with no signal reads only what is kept on the phone; it must open signed in or not.
  if (pathname === '/offline') return response;
  // A request from the app's own code (the export, the waiting taps) gets an answer it can read, not a page.
  if (!signedIn && pathname.startsWith('/api/')) {
    const refused = new NextResponse('Please sign in.', { status: 401 });
    for (const cookie of response.cookies.getAll()) refused.cookies.set(cookie);
    return refused;
  }

  if (!signedIn && !onSignIn) return redirectKeepingCookies(request, response, '/sign-in');
  if (signedIn && onSignIn) return redirectKeepingCookies(request, response, '/');
  return response;
}

function redirectKeepingCookies(request: NextRequest, from: NextResponse, path: string) {
  const redirect = NextResponse.redirect(new URL(path, request.url));
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  from.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'cache-control' || key === 'expires' || key === 'pragma')
      redirect.headers.set(key, value);
  });
  return redirect;
}

export const config = {
  // Everything except static files, the service worker, the manifest, icons and the offline page.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icons/|offline.html).*)'],
};
