import type { Beat, Song } from './types';
import { parseLrc, type LyricLine } from './lrc';

export interface LoadedSong {
  /** Analysis beats (the `segments` array the AudioEngine schedules). */
  beats: Beat[];
  /** Decoded-holding File built from the audio blob fetched from storage. */
  audioFile: File;
  /** URLs actually fetched — both must be the R2 custom domain, not the BFF. */
  sources: { audio: string; analysis: string };
  /**
   * Parsed, sorted timed lyric lines (issue #60) from the Song's LRC
   * (`media/<song_id>.lrc`, imports only), or null: no lyrics_url, fetch
   * failure, or fewer than two timestamped lines (#51 validity bar).
   * Playback never fails on lyrics.
   */
  lyrics: LyricLine[] | null;
}

/**
 * Player data-loading for the serverless stack (ADR-0001/0002): fetch the
 * Analysis JSON and the audio blob directly from the Song's public R2 URLs
 * (custom domain, CORS-open). No BFF proxy — playback reads are
 * browser-direct, so the audio blob can go straight into the Web Audio API.
 */
export async function loadSongForPlayback(song: Song): Promise<LoadedSong> {
  if (!song.audio_url || !song.analysis_url) {
    throw new Error(`Song "${song.title}" has no media URLs (status: ${song.status})`);
  }

  // .catch BEFORE the Promise.all: a rejected lyrics fetch (network reset,
  // CORS, blocked request) must not reject the shared Promise.all and fail
  // the whole load — lyrics are an enhancement (issue #60). HTTP-level
  // failures (404 etc.) are handled below via lyricsResponse.ok.
  const lyricsFetch: Promise<Response | null> = song.lyrics_url
    ? fetch(song.lyrics_url).catch((err) => {
        console.error('LRC fetch failed; continuing without lyrics:', err);
        return null;
      })
    : Promise.resolve(null);

  const [lyricsResponse, analysisResponse, audioResponse] = await Promise.all([
    lyricsFetch,
    fetch(song.analysis_url),
    fetch(song.audio_url),
  ] as const);

  if (!analysisResponse.ok) {
    throw new Error(`Failed to fetch analysis: ${analysisResponse.status} ${analysisResponse.statusText}`);
  }
  if (!audioResponse.ok) {
    throw new Error(`Failed to fetch audio: ${audioResponse.status} ${audioResponse.statusText}`);
  }

  const analysis = await analysisResponse.json();
  const beats: Beat[] = analysis.segments;
  if (!Array.isArray(beats) || beats.length === 0) {
    throw new Error('Analysis has no beats');
  }

  // Lyrics are an enhancement (issue #60): any failure — 404, network, bad
  // LRC, under the ≥2-line validity bar — degrades to null, never to a
  // failed song load.
  let lyrics: LyricLine[] | null = null;
  if (lyricsResponse) {
    if (lyricsResponse.ok) {
      try {
        lyrics = parseLrc(await lyricsResponse.text());
      } catch (err) {
        console.error('LRC parse failed; continuing without lyrics:', err);
      }
    } else {
      console.error(`LRC fetch failed (${lyricsResponse.status}); continuing without lyrics`);
    }
  }

  const audioBlob = await audioResponse.blob();
  const audioFile = new File([audioBlob], song.title, { type: audioBlob.type || 'audio/mpeg' });

  return { beats, audioFile, sources: { audio: song.audio_url, analysis: song.analysis_url }, lyrics };
}
