/**
 * Song-id ↔ content-hash mapping (CONTEXT.md "Content Hash" entry, Q14/#62).
 *
 * Both song_id shapes embed the full 64-hex SHA-256 of the audio as their
 * trailing underscore-separated segment:
 * - uploads: `up_<sha256hex>` (upload.ts computeSongId; issue #63, Q5 —
 *   content-addressed: byte-identical audio is ONE Song regardless of
 *   filename, the filename lives on as the title)
 * - imports: `imp_<sha256hex>` (sowImport.ts importSongId)
 * - legacy rows keep `<urlsafe_b64(filename)>_<sha256hex>` ids from before
 *   #63; contentHashFromSongId rsplit-on-LAST-underscore still reads them.
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
