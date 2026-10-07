import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { Song } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/songs/search?q= — filter Songs by case-insensitive title substring,
 * newest first. Same Song shape as /api/songs.
 *
 * Legacy parity (application/backend/app.py GET /songs/search): an empty or
 * missing q returns the full list rather than an error.
 */
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams.get('q') ?? '';
    const db = getDb();
    const result = await db.query(
      `SELECT song_id, title, duration, status, failure_reason, audio_url, analysis_url, lyrics_url, source, sow_recording_id, created_at
       FROM songs
       WHERE title ILIKE '%' || $1 || '%'
       ORDER BY created_at DESC`,
      [q],
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
    return NextResponse.json({ songs, query: q });
  } catch (err) {
    console.error('GET /api/songs/search failed:', err);
    return NextResponse.json({ error: 'Failed to search songs' }, { status: 500 });
  }
}
