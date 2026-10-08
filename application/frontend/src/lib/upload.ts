import type { Song, SongStatus, UploadRequest, UploadTicket } from './types';

/**
 * Client-side helpers for the presigned-upload flow (ADR-0002).
 * song_id = 'up_' + sha256(contents) — content-addressed (issue #63, Q5):
 * byte-identical audio is ONE Song regardless of filename; the filename
 * lives on as the Song title only.
 */

export async function computeSongId(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const hash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return `up_${hash}`;
}

/** Phases of the presign → PUT → finalize flow, for progress display. */
export type UploadPhase = 'presign' | 'upload' | 'finalize';

/**
 * Full upload flow (ADR-0002): presign via BFF, PUT the raw file to R2 at its
 * final key, then ask the BFF to finalize — enqueueing the analysis Worker.
 */
export async function uploadSong(file: File, onPhase?: (phase: UploadPhase) => void): Promise<UploadTicket> {
  const song_id = await computeSongId(file);
  const contentType = file.type || 'application/octet-stream';

  onPhase?.('presign');
  const presignResponse = await fetch('/api/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ song_id, title: file.name, contentType } satisfies UploadRequest),
  });
  if (!presignResponse.ok) {
    const detail = await presignResponse.json().catch(() => null);
    throw new Error(detail?.error || `Presign request failed: ${presignResponse.status} ${presignResponse.statusText}`);
  }
  const ticket: UploadTicket = await presignResponse.json();

  // PUT the raw bytes straight to the presigned URL with the signed
  // Content-Type; a mismatch makes R2 reject the request.
  onPhase?.('upload');
  const putResponse = await fetch(ticket.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file,
  });
  if (!putResponse.ok) {
    throw new Error(`Upload to storage failed: ${putResponse.status} ${putResponse.statusText}`);
  }

  // Kick off analysis: finalize enqueues the SQS message for the Worker.
  onPhase?.('finalize');
  const finalizeResponse = await fetch(`/api/songs/${encodeURIComponent(song_id)}/finalize`, {
    method: 'POST',
  });
  if (!finalizeResponse.ok) {
    const detail = await finalizeResponse.json().catch(() => null);
    throw new Error(detail?.error || `Finalize request failed: ${finalizeResponse.status} ${finalizeResponse.statusText}`);
  }

  return ticket;
}

export async function importSong(
  contentHash: string,
): Promise<{ song_id: string; status: string }> {
  const response = await fetch('/api/catalog/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content_hash: contentHash }),
  });
  const detail = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof detail?.error === 'string' ? detail.error : `Import failed: ${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return { song_id: detail.song_id, status: detail.status };
}

/** Shape of GET /api/songs and GET /api/songs/search responses. */
interface SongsResponse {
  songs: Song[];
}

export async function fetchSongs(): Promise<Song[]> {
  const response = await fetch('/api/songs');
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error || `Request failed: ${response.status} ${response.statusText}`);
  }
  const payload: SongsResponse = await response.json();
  return payload.songs;
}

/** Remove the Song from the caller's Library (issue #63): entry delete only. */
export async function removeSong(songId: string): Promise<void> {
  const response = await fetch(`/api/songs/${encodeURIComponent(songId)}`, { method: 'DELETE' });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error || `Request failed: ${response.status} ${response.statusText}`);
  }
}

export function isPlayable(status: SongStatus): boolean {
  return status === 'ready';
}
