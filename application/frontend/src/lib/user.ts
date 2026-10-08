import crypto from 'node:crypto';
import { getDb } from '@/lib/db';

/**
 * User identity for per-user Libraries (issue #63; CONTEXT.md "User").
 *
 * A User is distinguished without accounts: the BFF mints an opaque
 * `u_<32-hex>` ID on first request and returns it in an httpOnly cookie
 * (`iw_uid`). Every BFF route that reads or writes Library state calls
 * ensureUser() with the incoming Request. When a User row is inserted for
 * the FIRST time in the whole table, that user's Library is seeded with
 * every existing `ready` Song — the pre-#63 app had one shared Library, and
 * seeding keeps those Songs reachable (migration 0003 header).
 *
 * Minting is normally done by src/middleware.ts (edge, cookie only — no DB
 * there). It still works without the cookie: ensureUser mints and reports
 * `minted` so the route sets the cookie. No other auth exists by design.
 */

export const USER_COOKIE = 'iw_uid';

/** Shape ensureUser hands back so the route can set the cookie when minted. */
export interface UserIdentity {
  userId: string;
  /** True when this call minted the ID and the route must Set-Cookie. */
  minted: boolean;
}

function mintUserId(): string {
  return `u_${crypto.randomBytes(16).toString('hex')}`;
}

/**
 * Resolve the calling User from the request cookie — or mint a new User,
 * report `minted` so the route sets the cookie. Throws on database
 * failure; routes map that to 503.
 *
 * Seeding runs exactly once for the first User row ever INSERTed — not for
 * "the request that happens to see an empty table": a middleware-minted
 * cookie from request A may race a concurrent request B; whoever's INSERT
 * wins the advisory lock and lands the first row seeds. Serialized by a
 * transaction-scoped advisory lock.
 */
export async function ensureUser(request: Request): Promise<UserIdentity> {
  const existing = request.headers
    .get('cookie')
    ?.split(/;\s*/)
    .map((pair) => pair.split('='))
    .find(([name]) => name === USER_COOKIE)?.[1];

  // Fast path: a middleware-supplied cookie usually already has its row (the
  // middleware minted it earlier in this visit). Insert-if-missing is
  // idempotent; the seeding decision runs inside the same transaction as
  // the insert so the FIRST row ever inserted seeds its Library — whether
  // it arrived via middleware mint or here.
  if (existing && /^u_[0-9a-f]{32}$/.test(existing)) {
    await ensureUserRow(existing);
    return { userId: existing, minted: false };
  }

  const userId = mintUserId();
  await ensureUserRow(userId);
  return { userId, minted: true };
}

/**
 * Insert the User row (if missing) and seed the Library when this insert
 * landed the FIRST row in `users` — the pre-#63 shared Library's songs stay
 * reachable for exactly one User (migration 0003 header). Serialized by a
 * transaction-scoped advisory lock: concurrent first-visit requests cannot
 * both observe an empty table and both seed.
 */
async function ensureUserRow(userId: string): Promise<void> {
  const client = await getDb().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('iw_user_seed')::bigint)`);
    const inserted = await client.query(
      `INSERT INTO users (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING RETURNING user_id`,
      [userId],
    );
    if (inserted.rowCount === 1) {
      const count = await client.query('SELECT count(*)::int AS n FROM users');
      if (count.rows[0].n === 1) {
        await client.query(
          `INSERT INTO library_entries (user_id, song_id)
           SELECT $1, song_id FROM songs WHERE status = 'ready'
           ON CONFLICT (user_id, song_id) DO NOTHING`,
          [userId],
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Set-Cookie header value for a freshly minted User ID (1-year max-age). */
export function userCookieHeader(userId: string): string {
  return `${USER_COOKIE}=${userId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`;
}
