/**
 * Song-id ↔ content-hash mapping (CONTEXT.md "Content Hash" entry, Q14/#62).
 *
 * Both song_id shapes embed the full 64-hex SHA-256 of the audio as their
 * trailing underscore-separated segment:
 * - uploads: `<urlsafe_b64(filename)>_<sha256hex>` (upload.ts computeSongId;
 *   filenames have no underscores in the b64 alphabet's collision surface —
 *   urlsafe_b64 uses - and _ within the encoded half, hence rsplit on the
 *   LAST underscore)
 * - imports: `imp_<sha256hex>` (sowImport.ts importSongId)
 *
 * The hash is what dedupe and the Analysis object key are built on: one
 * `analysis/<content_hash>.json` per identical audio regardless of source.
 */

/** True when the string is a full lowercase 64-hex SHA-256. */
export function isContentHash(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

/** The audio SHA-256 embedded in a song_id; throws on a non-conforming id. */
export function contentHashFromSongId(songId: string): string {
  const sha = songId.slice(songId.lastIndexOf('_') + 1);
  if (!isContentHash(sha)) {
    throw new Error(`song_id "${songId}" does not embed a 64-hex content hash`);
  }
  return sha;
}
