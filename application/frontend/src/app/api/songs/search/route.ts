import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { Song } from '@/lib/types';
import { ensureUser, userCookieHeader, type UserIdentity } from '@/lib/user';

export const dynamic = 'force-dynamic';

/**
 * GET /api/songs/search?q= — filter the caller's Library (issue #63) by
 * case-insensitive title substring, newest member first. Same Song shape as
 * /api/songs. Discovering new music is the Catalog tab's job (its own search
 * box, CatalogBrowse) — this route can only reach Songs in the User's Library.
 *
 * Legacy parity (application/backend/app.py GET /songs/search): an empty or
 * missing q returns the full list rather than an error.
 */
export async function GET(request: Request) {
  let userIdentity: UserIdentity;
  try {
    userIdentity = await ensureUser(request);
  } catch (err) {
    console.error('GET /api/songs/search: user resolution failed:', err);
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
  }
  try {
    const q = new URL(request.url).searchParams.get('q') ?? '';
    const db = getDb();
    const result = await db.query(
      `SELECT s.song_id, s.title, s.duration, s.status, s.failure_reason, s.audio_url, s.analysis_url, s.lyrics_url, s.source, s.sow_recording_id, s.created_at
       FROM songs s
       JOIN library_entries le ON le.song_id = s.song_id AND le.user_id = $1
       WHERE s.title ILIKE '%' || $2 || '%'
       ORDER BY le.added_at DESC`,
      [userIdentity.userId, q],
    );
    const songs: Song[] = result.rows.map((row) => ({
      song_id: row.song_id,
      title: row.title,
      duration: row.duration === null ? null : Number(row.duration),
      status: row.status,
      failure_reason: row.failure_reason === undefined ? undefined : row.failure_reason,
      audio_url: row.audio_url,
      analysis_url: row.analysis_url,
      lyrics_url: row.lyrics_url ?? null,
      source: row.source,
      sow_recording_id: row.sow_recording_id ?? null,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    }));
    const response = NextResponse.json({ songs, query: q });
    if (userIdentity.minted) {
      response.headers.set('Set-Cookie', userCookieHeader(userIdentity.userId));
    }
    return response;
  } catch (err) {
    console.error('GET /api/songs/search failed:', err);
    return NextResponse.json({ error: 'Failed to search songs' }, { status: 500 });
  }
}
