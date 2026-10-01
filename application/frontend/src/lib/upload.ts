import type { Song, SongStatus, UploadRequest, UploadTicket } from './types';

/**
 * Client-side helpers for the presigned-upload flow (ADR-0002).
 * song_id = base64(filename) + '_' + sha256(contents) (CONTEXT.md), using the
 * URL-safe base64 variant the legacy backend used (app.py:
 * base64.urlsafe_b64encode(filename utf-8), ascii output — kept identical for
 * id stability).
 */

export async function computeSongId(file: File): Promise<string> {
  const bytes = new TextEncoder().encode(file.name);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  const encodedFilename = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_');

  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const hash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return `${encodedFilename}_${hash}`;
}

/**
 * Full upload flow: presign via BFF, then PUT the raw file to R2.
 * Finalize (analysis kickoff) is a separate route — not called here (#21).
 */
export async function uploadSong(file: File): Promise<UploadTicket> {
  const song_id = await computeSongId(file);
  const contentType = file.type || 'application/octet-stream';

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
  const putResponse = await fetch(ticket.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file,
  });
  if (!putResponse.ok) {
    throw new Error(`Upload to storage failed: ${putResponse.status} ${putResponse.statusText}`);
  }

  return ticket;
}

export async function fetchSongs(): Promise<Song[]> {
  const response = await fetch('/api/songs');
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error || `Request failed: ${response.status} ${response.statusText}`);
  }
  return ((await response.json()) as { songs: Song[] }).songs;
}

export function isPlayable(status: SongStatus): boolean {
  return status === 'ready';
}
