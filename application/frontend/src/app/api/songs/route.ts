import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { Song } from '@/lib/types';
import { ensureUser, userCookieHeader, type UserIdentity } from '@/lib/user';

export const dynamic = 'force-dynamic';

/**
 * GET /api/songs — the caller's Library (issue #63): Songs in the User's
 * `library_entries`, newest member first. A Library holds Songs the User
 * imported from the Catalog and Songs they uploaded themselves; Songs
 * uploaded by other Users are invisible here by design.
 */
export async function GET(request: Request) {
  let userIdentity: UserIdentity;
  try {
    userIdentity = await ensureUser(request);
  } catch (err) {
    console.error('GET /api/songs: user resolution failed:', err);
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
  }
  try {
    const db = getDb();
    const result = await db.query(
      `SELECT s.song_id, s.title, s.duration, s.status, s.audio_url, s.analysis_url, s.lyrics_url,
              s.failure_reason, s.source, s.sow_recording_id, s.created_at
       FROM songs s
       JOIN library_entries le ON le.song_id = s.song_id AND le.user_id = $1
       ORDER BY le.added_at DESC`,
      [userIdentity.userId],
    );
    const songs: Song[] = result.rows.map((row) => ({
      song_id: row.song_id,
      title: row.title,
      duration: row.duration === null ? null : Number(row.duration),
      status: row.status,
      audio_url: row.audio_url,
      analysis_url: row.analysis_url,
      lyrics_url: row.lyrics_url ?? null,
      failure_reason: row.failure_reason ?? null,
      source: row.source,
      sow_recording_id: row.sow_recording_id ?? null,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    }));
    const response = NextResponse.json({ songs });
    if (userIdentity.minted) {
      response.headers.set('Set-Cookie', userCookieHeader(userIdentity.userId));
    }
    return response;
  } catch (err) {
    console.error('GET /api/songs failed:', err);
    return NextResponse.json({ error: 'Failed to list songs' }, { status: 500 });
  }
}
