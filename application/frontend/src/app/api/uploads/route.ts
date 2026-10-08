import { NextResponse } from 'next/server';
import { getR2Config, presignPut } from '@/lib/r2';
import { getDb } from '@/lib/db';
import { contentHashFromSongId } from '@/lib/songId';
import { ensureUser, userCookieHeader, type UserIdentity } from '@/lib/user';

export const dynamic = 'force-dynamic';

/**
 * POST /api/uploads — BFF presign step (ADR-0002).
 *
 * Body: { song_id, title, contentType } where song_id was computed CLIENT-side
 * as 'up_' + sha256(contents) (issue #63, Q5 — content-addressed; the
 * filename is the title only).
 *
 * Returns a presigned R2 PUT URL for the final public key `media/<song_id>`
 * and inserts the pending Song row + the caller's Library entry (issue #63:
 * uploading puts the Song in YOUR Library; nobody else's). Re-uploading
 * byte-identical audio reuses the same Song row — the entry insert is the
 * only mutation (idempotent). Finalize (POST /api/songs/{id}/finalize)
 * decides whether analysis is needed.
 */
export async function POST(request: Request) {
  let userIdentity: UserIdentity;
  try {
    userIdentity = await ensureUser(request);
  } catch (err) {
    console.error('POST /api/uploads: user resolution failed:', err);
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
  }

  let body: { song_id?: string; title?: string; contentType?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { song_id, title, contentType } = body;
  if (!song_id || typeof song_id !== 'string') {
    return NextResponse.json({ error: 'song_id is required' }, { status: 400 });
  }
  if (!song_id.startsWith('up_')) {
    return NextResponse.json(
      { error: 'song_id must be content-addressed: "up_" + 64-hex sha256 of the file contents' },
      { status: 400 },
    );
  }
  try {
    contentHashFromSongId(song_id);
  } catch {
    return NextResponse.json(
      { error: 'song_id must embed a 64-hex sha256 content hash as its final segment' },
      { status: 400 },
    );
  }
  if (!title || typeof title !== 'string') {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }

  // Signed content type keeps the browser's PUT honest without a server round
  // trip; the analysis worker re-validates real content later.
  const type = typeof contentType === 'string' && contentType.length > 0 ? contentType : 'application/octet-stream';

  // Final public key (ADR-0002): uploads land directly at media/<song_id>.
  const key = `media/${song_id}`;

  try {
    const r2 = getR2Config();
    const upload_url = await presignPut(r2, key, type);
    const audio_url = r2.publicBase ? `${r2.publicBase}/${key}` : null;

    const db = getDb();
    await db.query(
      `INSERT INTO songs (song_id, title, status, audio_url, analysis_url, source, content_hash)
       VALUES ($1, $2, 'pending', $3, NULL, 'upload', $4)
       ON CONFLICT (song_id) DO NOTHING`,
      [song_id, title, audio_url, contentHashFromSongId(song_id)],
    );
    // The Library entry is the user-visible fact (issue #63): uploading puts
    // the Song in YOUR Library, nobody else's. Idempotent on re-upload.
    await db.query(
      `INSERT INTO library_entries (user_id, song_id) VALUES ($1, $2)
       ON CONFLICT (user_id, song_id) DO NOTHING`,
      [userIdentity.userId, song_id],
    );

    const response = NextResponse.json({ song_id, upload_url, key, audio_url });
    if (userIdentity.minted) {
      response.headers.set('Set-Cookie', userCookieHeader(userIdentity.userId));
    }
    return response;
  } catch (err) {
    console.error('POST /api/uploads failed:', err);
    return NextResponse.json({ error: 'Failed to create upload ticket' }, { status: 500 });
  }
}
