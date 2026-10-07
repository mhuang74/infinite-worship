import { Pool } from 'pg';
import {
  S3Client,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SOW_CATALOG_BPM_BAND } from '@/lib/catalogBand';
import { MAX_DURATION_SECONDS } from '@/lib/sowCatalog';
import { getR2Config, r2HeadObject } from '@/lib/r2';

/**
 * Server-only mechanics of the SOW Song Catalog import (#55 resolution, #59):
 * resolve the recording per the #52 auto-pick rule, R2 server-side CopyObject
 * the audio + LRC into IW's own bucket (no bytes transit the BFF), insert the
 * pending Song row, enqueue SQS — or take the dedupe fast path (row `ready`,
 * no SQS) when the hash-keyed Analysis already exists.
 *
 * Post-import the system is SOW-free (#55 boundary): the row's URLs point at
 * IW's bucket; the worker is SOW-blind. SOW is known only to this module and
 * src/lib/sowCatalog.ts (the Import component).
 *
 * Env vars (server-side only, never NEXT_PUBLIC):
 * - SOW_CATALOG_ENABLED — feature flag, read per request by the route
 *   (#56: NOT NEXT_PUBLIC_, which Next.js would inline at build so a
 *   dashboard flip would no-op until a redeploy).
 * - SOW_CATALOG_DATABASE_URL — SOW Neon read-role connection string.
 * - SOW_IMPORT_R2_ENDPOINT_URL — R2 S3 endpoint for the dual-scope token
 *   (minted in the env ticket: Read on stream-of-worship + Read/Write on
 *   infinite-worship-media; the S3 probes in that ticket verified both
 *   scopes and that SOW PUT stays AccessDenied).
 * - SOW_IMPORT_R2_BUCKET — IW's own bucket name (copy destination).
 * - SOW_IMPORT_R2_ACCESS_KEY_ID / SOW_IMPORT_R2_SECRET_ACCESS_KEY — the
 *   dual-scope token's S3 credentials.
 * - SQS_QUEUE_URL, AWS_REGION, SQS_ENDPOINT — same enqueue wiring as
 *   finalize (SQS_ENDPOINT is the localstack override for emulator runs).
 */

export interface ImportRequest {
  /** The catalog card's SOW recording content hash (64-hex SHA-256). */
  content_hash: string;
}

/** Shape of POST /api/catalog/import — status-aware per #54. */
export interface ImportResponse {
  song_id: string;
  status: 'pending' | 'processing' | 'ready' | 'failed';
}

/** Row shape the import resolves from the SOW catalog. */
export interface SowRecording {
  sow_song_id: string;
  title: string;
  /** Full 64-hex SHA-256 of the audio; also the recording's identity. */
  content_hash: string;
  /** First 12 chars of content_hash — the SOW R2 directory prefix. */
  hash_prefix: string;
  duration_seconds: number | null;
}

const IMPORT_SONG_ID_PREFIX = 'imp_';

// Deterministic pick (#52, exact rule — kept verbatim with the browse query
// in sowCatalog.ts so the In-IW badge labels the same recording the import
// picks): published preferred, then most recent imported_at, ties broken by
// created_at then content_hash. DISTINCT ON keeps one row per catalog song;
// here the card's content_hash pins the song, so this asserts the same
// recording the browse query would have picked for it.
//
// The curation gates (BPM band + duration ceiling) are NOT optional here:
// the route is the authority and the client-supplied hash is untrusted, so
// without them an out-of-band or >MAX_SONG_SECONDS recording could be
// imported out-of-band and the worker would then reject it (#50's whole
// point). Same predicates, same parameter order as CATALOG_SQL.
const PICK_SQL = `
  SELECT DISTINCT ON (s.id)
    s.id AS sow_song_id, s.title,
    r.content_hash, r.hash_prefix, r.duration_seconds
  FROM recordings r
  JOIN songs s ON s.id = r.song_id
  WHERE s.deleted_at IS NULL
    AND r.deleted_at IS NULL
    AND r.visibility_status IN ('published', 'review')
    AND r.r2_audio_url IS NOT NULL
    AND r.lrc_status = 'completed'
    AND r.tempo_bpm BETWEEN $2 AND $3
    AND r.duration_seconds IS NOT NULL
    AND r.duration_seconds <= $4
    AND r.content_hash = $1
  ORDER BY s.id,
    (r.visibility_status = 'published') DESC,
    r.imported_at::timestamptz DESC NULLS LAST,
    r.created_at DESC NULLS LAST,
    r.content_hash DESC
`;

let sowDbPool: Pool | null = null;

function getSowImportDb(): Pool {
  if (!sowDbPool) {
    const connectionString = process.env.SOW_CATALOG_DATABASE_URL;
    if (!connectionString) {
      throw new Error('Missing required env var: SOW_CATALOG_DATABASE_URL');
    }
    sowDbPool = new Pool({
      connectionString,
      ssl: /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: true },
      max: 5,
    });
  }
  return sowDbPool;
}

let importS3: S3Client | null = null;

/**
 * Read the import's env vars, validating presence once; the returned shape
 * carries narrowed string types for the caller.
 */
function importEnv(): { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string } {
  const env = process.env;
  const missing = (
    [
      ['SOW_IMPORT_R2_ENDPOINT_URL', env.SOW_IMPORT_R2_ENDPOINT_URL],
      ['SOW_IMPORT_R2_BUCKET', env.SOW_IMPORT_R2_BUCKET],
      ['SOW_IMPORT_R2_ACCESS_KEY_ID', env.SOW_IMPORT_R2_ACCESS_KEY_ID],
      ['SOW_IMPORT_R2_SECRET_ACCESS_KEY', env.SOW_IMPORT_R2_SECRET_ACCESS_KEY],
    ] as const
  )
    .filter((pair) => !pair[1])
    .map((pair) => pair[0]);
  if (missing.length > 0) {
    throw new Error(`Missing required SOW_IMPORT_R2_* env vars: ${missing.join(', ')}`);
  }
  // Presence validated above; assemble the typed snapshot from the checked
  // keys (env vars are outside the compiler's reach — the missing-list above
  // is the runtime validation for exactly these four names).
  const snapshot: Record<
    'SOW_IMPORT_R2_ENDPOINT_URL' | 'SOW_IMPORT_R2_BUCKET' | 'SOW_IMPORT_R2_ACCESS_KEY_ID' | 'SOW_IMPORT_R2_SECRET_ACCESS_KEY',
    string
  > = {
    SOW_IMPORT_R2_ENDPOINT_URL: env.SOW_IMPORT_R2_ENDPOINT_URL as string,
    SOW_IMPORT_R2_BUCKET: env.SOW_IMPORT_R2_BUCKET as string,
    SOW_IMPORT_R2_ACCESS_KEY_ID: env.SOW_IMPORT_R2_ACCESS_KEY_ID as string,
    SOW_IMPORT_R2_SECRET_ACCESS_KEY: env.SOW_IMPORT_R2_SECRET_ACCESS_KEY as string,
  };
  return {
    endpoint: snapshot.SOW_IMPORT_R2_ENDPOINT_URL,
    bucket: snapshot.SOW_IMPORT_R2_BUCKET,
    accessKeyId: snapshot.SOW_IMPORT_R2_ACCESS_KEY_ID,
    secretAccessKey: snapshot.SOW_IMPORT_R2_SECRET_ACCESS_KEY,
  };
}

/** The dual-scope R2 client; throws a clear error when env is incomplete. */
function getImportS3(): S3Client {
  if (!importS3) {
    const { endpoint, accessKeyId, secretAccessKey } = importEnv();
    importS3 = new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
  }
  return importS3;
}

function importBucket(): string {
  return importEnv().bucket;
}

/** Import song id: `imp_` + full content hash (#55 decision 5). */
export function importSongId(contentHash: string): string {
  return `${IMPORT_SONG_ID_PREFIX}${contentHash}`;
}

/** Resolved recording, or null when the hash no longer qualifies (#52 pick). */
export type ResolvedRecording = SowRecording | null;

/**
 * Resolve the recording a catalog card refers to (#52 auto-pick). The card
 * already carries the picked content_hash from GET /api/catalog, so this
 * re-applies the curation gates + pick rule to that hash: if it no longer
 * qualifies (SOW admin un-published it since the 5-min browse cache), the
 * import refuses — the browse surface never offered it.
 */
export async function resolveRecording(contentHash: string): Promise<ResolvedRecording> {
  const result = await getSowImportDb().query<SowRecording>(PICK_SQL, [
    contentHash,
    SOW_CATALOG_BPM_BAND.min,
    SOW_CATALOG_BPM_BAND.max,
    MAX_DURATION_SECONDS,
  ]);
  return result.rows[0] ?? null;
}

/**
 * The dedupe fast path (#55 decision 10): the hash-keyed Analysis already
 * exists (any source — upload or a previous import), so re-import is free:
 * insert the row `ready`, skip SQS entirely. The row still gets its own
 * audio copy at `media/<song_id>` (#55 decision 7: one layout, no
 * existence dance on media keys).
 *
 * Uses the app's own R2 credentials (r2HeadObject / R2_*), NOT the
 * dual-scope token: that token's Write on infinite-worship-media is
 * probed (#57), but its Read on the IW bucket is not — HEAD with it could
 * 403 in prod and the import would silently degrade to the slow path.
 */
export function hasAnalysisFor(contentHash: string): Promise<boolean> {
  return r2HeadObject(getR2Config().s3, `analysis/${contentHash}.json`).then((head) => head !== null);
}

/**
 * Server-side copy of the SOW recording's audio + LRC into IW's bucket
 * (#55 amendment): one CopyObjectCommand per object, cross-bucket within
 * the same Cloudflare account — bytes never transit the BFF, so no
 * maxDuration bump. Destination keys use the single `media/` layout:
 * `media/imp_<hash>` for audio, `media/imp_<hash>.lrc` for lyrics
 * (distinct keys — only the Analysis is hash-shared, per CONTEXT.md).
 */
export async function copyRecording(recording: SowRecording): Promise<void> {
  const songId = importSongId(recording.content_hash);
  const s3 = getImportS3();
  const bucket = importBucket();
  // Source bucket comes from env (the catalog-read client's bucket, which
  // the dual-scope token provably has Read on — #57 probes). Never a
  // literal: dev/MinIO and staging→prod swap must both work.
  const sourceBucket = process.env.SOW_CATALOG_R2_BUCKET;
  if (!sourceBucket) {
    throw new Error('Missing required env var: SOW_CATALOG_R2_BUCKET');
  }
  const copies = [
    { key: `${recording.hash_prefix}/audio.mp3`, destination: `media/${songId}` },
    { key: `${recording.hash_prefix}/lyrics.lrc`, destination: `media/${songId}.lrc` },
  ];
  for (const copy of copies) {
    await s3.send(
      new CopyObjectCommand({
        Bucket: bucket,
        Key: copy.destination,
        CopySource: `${sourceBucket}/${copy.key}`,
      }),
    );
  }
}

let iwDbPool: Pool | null = null;

function getIwDb(): Pool {
  if (!iwDbPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('Missing required env var: DATABASE_URL');
    }
    iwDbPool = new Pool({
      connectionString,
      ssl: /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: true },
      max: 5,
    });
  }
  return iwDbPool;
}

/**
 * Insert the import's Song row. `ready` when the dedupe fast path hit,
 * `pending` otherwise (#55 decision 9: copy-then-insert). Idempotent via
 * the partial unique index on sow_recording_id (migration 0002).
 */
export async function insertImportRow(
  recording: SowRecording,
  status: 'pending' | 'ready',
): Promise<void> {
  const songId = importSongId(recording.content_hash);
  const publicBase = process.env.R2_PUBLIC_BASE?.replace(/\/+$/, '') ?? null;
  const audioUrl = publicBase ? `${publicBase}/media/${songId}` : null;
  const lyricsUrl = publicBase ? `${publicBase}/media/${songId}.lrc` : null;
  const analysisUrl = publicBase
    ? `${publicBase}/analysis/${recording.content_hash}.json`
    : null;
  await getIwDb().query(
    `INSERT INTO songs
       (song_id, title, duration, status, audio_url, analysis_url,
        source, sow_recording_id, content_hash, lyrics_url)
     VALUES ($1, $2, $3, $4, $5, $6, 'sow', $7, $7, $8)
     ON CONFLICT (song_id) DO NOTHING`,
    [
      songId,
      recording.title,
      recording.duration_seconds,
      status,
      audioUrl,
      status === 'ready' ? analysisUrl : null,
      recording.content_hash,
      lyricsUrl,
    ],
  );
}

/** Current status of an existing import row, if any (re-pick recovery). */
export async function existingImportStatus(contentHash: string): Promise<string | null> {
  const result = await getIwDb().query<{ status: string }>(
    'SELECT status FROM songs WHERE sow_recording_id = $1',
    [contentHash],
  );
  return result.rows[0]?.status ?? null;
}

/**
 * Promote an existing row to `ready` in the dedupe fast path when it
 * re-picks after the Analysis landed (e.g. a `failed`/`pending` row whose
 * analysis exists from an earlier attempt): the row's own audio copy was
 * already made by the original import (copy-then-insert), so only status,
 * analysis_url and the stale reason need updating. Plain INSERT .. ON
 * CONFLICT DO NOTHING would leave the old status in place and the route
 * would report `ready` for a row the DB says is `failed`.
 */
export async function promoteToReady(contentHash: string): Promise<void> {
  const analysisUrl = `${process.env.R2_PUBLIC_BASE?.replace(/\/+$/, '')}/analysis/${contentHash}.json`;
  await getIwDb().query(
    `UPDATE songs
        SET status = 'ready', analysis_url = $2, failure_reason = NULL
      WHERE sow_recording_id = $1`,
    [contentHash, analysisUrl],
  );
}

/**
 * Copy-failure landing (#59): the SOW source object was missing (or the
 * copy was refused) at import time — the row goes straight to `failed` with
 * the reason so the Catalog card shows it; no SQS enqueue. Re-pick is a
 * no-op per #54 Q6 — the route never auto-retries a `failed` row; retry is
 * a separate re-enqueue action (follow-up ticket, not #59).
 */
export async function markImportFailed(contentHash: string, reason: string): Promise<void> {
  await getIwDb().query(
    `UPDATE songs SET status = 'failed', failure_reason = $2 WHERE sow_recording_id = $1`,
    [contentHash, reason],
  );
}

/**
 * Enqueue the analysis job. Same SQS message contract as the upload finalize
 * route (#55 decision 8): { song_id, audio_key } — the worker is SOW-blind
 * and downloads from IW's own bucket exactly like an upload.
 */
export async function enqueueAnalysis(songId: string): Promise<void> {
  if (!process.env.SQS_QUEUE_URL) {
    throw new Error('Server misconfigured: SQS_QUEUE_URL is not set');
  }
  const sqs = new SQSClient({
    region: process.env.AWS_REGION ?? 'us-west-2',
    // SQS_ENDPOINT is an optional override for localstack-based dev (same
    // wiring as finalize; the queue itself is AWS-side in prod).
    endpoint: process.env.SQS_ENDPOINT,
  });
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.SQS_QUEUE_URL,
      MessageBody: JSON.stringify({ song_id: songId, audio_key: `media/${songId}` }),
    }),
  );
}
