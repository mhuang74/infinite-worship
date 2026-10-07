import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { Song } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/songs — list Songs, newest first (CONTEXT.md language; Song rows in
 * Postgres per infra/sql/song_schema.sql).
 */
export async function GET() {
  try {
    const db = getDb();
    const result = await db.query(
      `SELECT song_id, title, duration, status, audio_url, analysis_url, lyrics_url, failure_reason, source, sow_recording_id, created_at
       FROM songs
       ORDER BY created_at DESC`,
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
    return NextResponse.json({ songs });
  } catch (err) {
    console.error('GET /api/songs failed:', err);
    return NextResponse.json({ error: 'Failed to list songs' }, { status: 500 });
  }
}
