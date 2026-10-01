import type { Beat, Song } from './types';

export interface LoadedSong {
  /** Analysis beats (the `segments` array the AudioEngine schedules). */
  beats: Beat[];
  /** Decoded-holding File built from the audio blob fetched from storage. */
  audioFile: File;
  /** URLs actually fetched — both must be the R2 custom domain, not the BFF. */
  sources: { audio: string; analysis: string };
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

  const [analysisResponse, audioResponse] = await Promise.all([
    fetch(song.analysis_url),
    fetch(song.audio_url),
  ]);

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

  const audioBlob = await audioResponse.blob();
  const audioFile = new File([audioBlob], song.title, { type: audioBlob.type || 'audio/mpeg' });

  return { beats, audioFile, sources: { audio: song.audio_url, analysis: song.analysis_url } };
}
