import { NextResponse, type NextRequest } from 'next/server';

/**
 * Per-user Library identity (issue #63): mint the User cookie on the very
 * first request of a visit, BEFORE the page's parallel API calls fire.
 * Without this, the client's concurrent cookie-less fetches each make a
 * route mint a different user id, and the browser keeps only the last
 * Set-Cookie — library state could land on a discarded user.
 *
 * Edge runtime: cookie minting ONLY — no database here (`pg` cannot load on
 * the Edge). Route handlers still call ensureUser() for the DB-side
 * identity/seed work and re-set the cookie whenever they minted the ID
 * themselves (requests that bypassed this middleware, e.g. direct API
 * calls).
 */

const USER_COOKIE = 'iw_uid';
const USER_ID_RE = /^u_[0-9a-f]{32}$/;
const ONE_YEAR = 60 * 60 * 24 * 365;

export function middleware(request: NextRequest) {
  const existing = request.cookies.get(USER_COOKIE)?.value;
  if (existing && USER_ID_RE.test(existing)) {
    return NextResponse.next();
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const userId = `u_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;

  const requestHeaders = new Headers(request.headers);
  // Downstream route handlers in THIS same request see the minted cookie —
  // a first-visit GET /api/songs is scoped to the cookie the page will
  // store, not to a second, discarded mint.
  const cookieHeader = request.headers.get('cookie');
  requestHeaders.set('cookie', cookieHeader ? `${cookieHeader}; ${USER_COOKIE}=${userId}` : `${USER_COOKIE}=${userId}`);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.cookies.set({
    name: USER_COOKIE,
    value: userId,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: ONE_YEAR,
  });
  return response;
}

export const config = {
  // API routes + the page itself; static assets don't need identity.
  matcher: ['/', '/api/:path*'],
};
