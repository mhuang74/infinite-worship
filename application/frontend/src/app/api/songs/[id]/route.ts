import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { ensureUser, userCookieHeader, type UserIdentity } from '@/lib/user';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/songs/{id} — remove the Song from the caller's Library
 * (issue #63). The Library entry is deleted; the global Song row, its audio
 * object, and its Analysis always survive (CONTEXT.md "Library": membership
 * is the only user-facing thing — a removed Song is invisible infrastructure
 * and can be re-added later, e.g. by re-importing from the Catalog or
 * re-uploading the identical file, both instant).
 *
 * 404 when the Song is not in the caller's Library (removing someone else's
 * Song — or an already-removed one — is a no-op surfaced as 404).
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  let userIdentity: UserIdentity;
  try {
    userIdentity = await ensureUser(request);
  } catch (err) {
    console.error(`DELETE songs/${id}: user resolution failed:`, err);
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
  }

  try {
    const result = await getDb().query(
      `DELETE FROM library_entries WHERE user_id = $1 AND song_id = $2`,
      [userIdentity.userId, id],
    );
    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: `Song ${id} is not in your library` },
        { status: 404 },
      );
    }
    const response = NextResponse.json({ song_id: id, removed: true });
    if (userIdentity.minted) {
      response.headers.set('Set-Cookie', userCookieHeader(userIdentity.userId));
    }
    return response;
  } catch (err) {
    console.error(`DELETE songs/${id} failed:`, err);
    return NextResponse.json({ error: 'Failed to remove song' }, { status: 500 });
  }
}
