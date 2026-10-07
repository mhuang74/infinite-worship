import { Pool } from 'pg';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { SOW_CATALOG_BPM_BAND } from '@/lib/catalogBand';

/**
 * Server-only access to the SOW Song Catalog (Stream of Worship's Neon
 * Postgres + R2, read-only). Never imported by client code.
 *
 * Facts read here (#50 resolution): `recordings.content_hash` is the SHA-256
 * of the audio file (the IW dedupe/analysis key); `hash_prefix` is its first
 * 12 chars and the R2 directory prefix; `r2_audio_url` is an `s3://`
 * *reference*, not a playable URL — playback uses IW's own copied object.
 *
 * Env vars (server-side only, never NEXT_PUBLIC):
 * - SOW_CATALOG_DATABASE_URL — SOW Neon read-role connection string.
 * - SOW_CATALOG_ENABLED — server-side feature flag, read per request (a
 *   NEXT_PUBLIC_ var would be build-time inlined: flipping it in the Vercel
 *   dashboard would no-op until a redeploy — #56 amendment).
 *
 * The staging→prod Neon swap is env-only (#56): this module never hardcodes
 * a project or role.
 */

const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;

export interface CatalogSong {
  /** SOW song id — stable catalog identity across recording revisions. */
  song_id: string;
  title: string;
  title_pinyin: string | null;
  composer: string | null;
  lyricist: string | null;
  album_name: string | null;
  /** Catalog-declared key, resolved against the recording's detected key. */
  musical_key: string | null;
  /** SOW recording content hash (64-hex SHA-256) — IW's dedupe/analysis key. */
  content_hash: string;
  /** First 12 chars of content_hash; the SOW R2 directory prefix. */
  hash_prefix: string;
  tempo_bpm: number | null;
  duration_seconds: number | null;
  imported_at: string | null;
  /** First lyric cue text of the R2 lyrics.lrc, or a DB fallback line. */
  lyrics_preview: string | null;
}

/** Shape of GET /api/catalog. */
export interface CatalogResponse {
  enabled: boolean;
  songs: CatalogSong[];
}

let sowPool: Pool | null = null;

function getSowDb(): Pool {
  if (!sowPool) {
    const connectionString = process.env.SOW_CATALOG_DATABASE_URL;
    if (!connectionString) {
      throw new Error('Missing required env var: SOW_CATALOG_DATABASE_URL');
    }
    sowPool = new Pool({
      connectionString,
      ssl: /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: true },
      max: 5,
    });
  }
  return sowPool;
}

/** Server-side feature flag, evaluated per request (never build-time-inlined). */
export function isSowCatalogEnabled(): boolean {
  return process.env.SOW_CATALOG_ENABLED === 'true';
}

/** Worker MAX_SONG_SECONDS (#50): never offer an import that would fail. */
const MAX_DURATION_SECONDS = 600;

// The curation rule (#50): SOW's own playability gate + curated synced lyrics
// + the BPM band (SOW_CATALOG_BPM_BAND in catalogBand.ts, calibrated against
// the staging distribution — 442 eligible recordings: min 58.7, p25 66.3,
// p75 99.4, max 143.6; 60–100 keeps 346 and excludes the sub-60
// half-time/tempo-detection artifacts) + the duration ceiling, so a user
// never picks a song that would fail import.

// Deterministic pick (#52, exact rule): published preferred, then most
// recent imported_at, ties broken by created_at then content_hash. DISTINCT
// ON keeps one row per song; #59's import route must apply the same rule so
// the In-IW badge (joined on content_hash) labels the same recording.
const CATALOG_SQL = `
  SELECT DISTINCT ON (s.id)
    s.id, s.title, s.title_pinyin, s.composer, s.lyricist, s.album_name,
    s.musical_key,
    r.content_hash, r.hash_prefix, r.tempo_bpm, r.duration_seconds,
    r.musical_key AS detected_key, r.musical_mode AS detected_mode,
    r.key_confidence, r.key_score_margin, r.key_window_agreement,
    r.imported_at, r.r2_lrc_url, s.lyrics_lines
  FROM recordings r
  JOIN songs s ON s.id = r.song_id
  WHERE s.deleted_at IS NULL
    AND r.deleted_at IS NULL
    AND r.visibility_status IN ('published', 'review')
    AND r.r2_audio_url IS NOT NULL
    AND r.lrc_status = 'completed'
    AND r.tempo_bpm BETWEEN $1 AND $2
    AND r.duration_seconds IS NOT NULL
    AND r.duration_seconds <= $3
  ORDER BY s.id,
    (r.visibility_status = 'published') DESC,
    r.imported_at::timestamptz DESC NULLS LAST,
    r.created_at DESC NULLS LAST,
    r.content_hash DESC
`;

const KEY_CONFIDENCE_MIN = 0.7;
const KEY_MARGIN_MIN = 0.05;
const KEY_WINDOW_AGREEMENT_MIN = 0.55;

/**
 * Mirrors SOW's effective-key resolution (delivery/webapp
 * src/lib/music/effective-key.ts): the catalog key wins when parseable; a
 * detected key overrides only its mode when confident; a confident detection
 * fills in when the catalog key is absent. Catalog keys may be ranges
 * (`G-A`, `D-Eb-F` — 19 of 346 curated staging rows), displayed `first → last`.
 */
function resolveEffectiveKey(
  catalogKey: string | null,
  detectedKey: string | null,
  detectedMode: string | null,
  keyConfidence: number | null,
  keyScoreMargin: number | null,
  keyWindowAgreement: number | null,
): string | null {
  const cat = parseKeyRange(catalogKey);
  if (cat) return cat;

  const det = parseKeyToken(detectedKey);
  if (!det) return null;
  const confident =
    (keyConfidence ?? 0) >= KEY_CONFIDENCE_MIN &&
    (keyScoreMargin ?? 0) >= KEY_MARGIN_MIN &&
    (keyWindowAgreement ?? 0) >= KEY_WINDOW_AGREEMENT_MIN;
  if (!confident) return null;

  const normalizedMode = detectedMode?.trim().toLowerCase();
  const mode = normalizedMode === 'minor' || normalizedMode === 'm' ? 'm' : '';
  return `${det.display}${mode}`;
}

/** A dash/arrow-separated key range → `first → last` (SOW's display form). */
function parseKeyRange(value: string | null): string | null {
  const raw = (value ?? '').normalize('NFKC').trim();
  if (!raw) return null;
  const tokens = raw.split(/\s*(?:-|→|~)\s*/).filter((token) => token.length > 0);
  const parsed = tokens.map(parseKeyToken);
  if (tokens.length === 0 || parsed.some((token) => token === null)) return null;
  const first = parsed[0]!.display;
  const last = parsed[parsed.length - 1]!.display;
  return first === last ? first : `${first} → ${last}`;
}

/** One key token: `D`, `Eb`, `F#m`, `G小調`… (a superset of what appears in SOW). */
function parseKeyToken(value: string | null | undefined): { display: string } | null {
  const raw = (value ?? '').normalize('NFKC').trim();
  const m = raw.match(/^([A-Ga-g])([#♯b♭]?)?(m|minor|小調)?$/);
  if (!m) return null;
  const root = `${m[1].toUpperCase()}${(m[2] ?? '').replace('♯', '#').replace('♭', 'b')}`;
  const minor = m[3] !== undefined;
  return { display: `${root}${minor ? 'm' : ''}` };
}

/** First lyric line for the browse preview: the earliest LRC cue's text. */
function firstLrcLine(lrc: string): string | null {
  for (const line of lrc.split('\n')) {
    const idx = line.indexOf(']');
    if (!line.startsWith('[') || idx === -1) continue;
    const text = line.slice(idx + 1).trim();
    if (text) return text;
  }
  return null;
}

/** songs.lyrics_lines JSON array (scraped, unsynced) — the fallback preview. */
function firstDbLyricLine(lyricsLines: string | null): string | null {
  if (!lyricsLines) return null;
  try {
    const parsed: unknown = JSON.parse(lyricsLines);
    if (Array.isArray(parsed)) {
      const line = parsed.find((l): l is string => typeof l === 'string' && l.trim().length > 0);
      return line ? line.trim() : null;
    }
  } catch {
    // Not a JSON array — treat the column as plain text.
    console.error('SOW songs.lyrics_lines is not a JSON array; using raw text');
    const text = lyricsLines.trim();
    if (text) return text.split('\n', 1)[0].trim() || null;
  }
  return null;
}

async function fetchLrcFirstLines(hashPrefixes: string[]): Promise<Record<string, string | null>> {
  const endpoint = process.env.SOW_CATALOG_R2_ENDPOINT_URL;
  const bucket = process.env.SOW_CATALOG_R2_BUCKET;
  const result: Record<string, string | null> = {};
  if (!endpoint || !bucket) {
    // Without R2 creds the preview falls back to the DB lyric lines.
    for (const hp of hashPrefixes) result[hp] = null;
    return result;
  }
  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: process.env.SOW_CATALOG_R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.SOW_CATALOG_R2_SECRET_ACCESS_KEY ?? '',
    },
  });
  await Promise.all(
    hashPrefixes.map(async (hashPrefix) => {
      try {
        const obj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: `${hashPrefix}/lyrics.lrc` }));
        const body = await obj.Body?.transformToString('utf-8');
        result[hashPrefix] = body ? firstLrcLine(body) : null;
      } catch (err) {
        // A missing/unreadable LRC is a preview gap, not a route failure.
        console.error(`lyrics.lrc fetch failed for ${hashPrefix}:`, err);
        result[hashPrefix] = null;
      }
    }),
  );
  return result;
}

interface CatalogRow {
  id: string;
  title: string;
  title_pinyin: string | null;
  composer: string | null;
  lyricist: string | null;
  album_name: string | null;
  musical_key: string | null;
  content_hash: string;
  hash_prefix: string;
  tempo_bpm: string | number | null;
  duration_seconds: string | number | null;
  detected_key: string | null;
  detected_mode: string | null;
  key_confidence: string | number | null;
  key_score_margin: string | number | null;
  key_window_agreement: string | number | null;
  imported_at: string | null;
  r2_lrc_url: string | null;
  lyrics_lines: string | null;
}

let cache: { at: number; songs: CatalogSong[] } | null = null;

/**
 * The curated catalog (#50): one query for display cols + content hash facts,
 * cached in-memory 5 min (the catalog changes only on SOW admin action, and
 * the TTL doubles as a Neon cold-start absorber).
 */
export async function getCatalog(): Promise<CatalogSong[]> {
  if (cache && Date.now() - cache.at < CATALOG_CACHE_TTL_MS) {
    return cache.songs;
  }

  const db = getSowDb();
  const result = await db.query<CatalogRow>(CATALOG_SQL, [
    SOW_CATALOG_BPM_BAND.min,
    SOW_CATALOG_BPM_BAND.max,
    MAX_DURATION_SECONDS,
  ]);
  const rows = result.rows;

  // Canonical synced lyrics live in R2 {hash_prefix}/lyrics.lrc (gated by
  // lrc_status = 'completed' in the query); DB lyrics_lines is the fallback.
  const lrcPreviews = await fetchLrcFirstLines(rows.map((row) => row.hash_prefix));

  const songs: CatalogSong[] = rows.map((row) => ({
    song_id: row.id,
    title: row.title,
    title_pinyin: row.title_pinyin,
    composer: row.composer,
    lyricist: row.lyricist,
    album_name: row.album_name,
    musical_key: resolveEffectiveKey(
      row.musical_key,
      row.detected_key,
      row.detected_mode,
      row.key_confidence === null ? null : Number(row.key_confidence),
      row.key_score_margin === null ? null : Number(row.key_score_margin),
      row.key_window_agreement === null ? null : Number(row.key_window_agreement),
    ),
    content_hash: row.content_hash,
    hash_prefix: row.hash_prefix,
    tempo_bpm: row.tempo_bpm === null ? null : Number(row.tempo_bpm),
    duration_seconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    imported_at: row.imported_at,
    lyrics_preview: lrcPreviews[row.hash_prefix] ?? firstDbLyricLine(row.lyrics_lines),
  }));

  cache = { at: Date.now(), songs };
  return songs;
}
