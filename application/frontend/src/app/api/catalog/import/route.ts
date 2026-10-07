import { NextResponse } from 'next/server';
import {
  isSowCatalogEnabled,
} from '@/lib/sowCatalog';
import {
  copyRecording,
  enqueueAnalysis,
  existingImportStatus,
  hasAnalysisFor,
  importSongId,
  insertImportRow,
  markImportFailed,
  resetForRetry,
  resolveRecording,
  type ImportRequest,
  type ImportResponse,
  type ResolvedRecording,
} from '@/lib/sowImport';

export const dynamic = 'force-dynamic';

/**
 * POST /api/catalog/import — the Import (#55 resolution, #59): copy-at-import
 * executed by the BFF via R2 server-side CopyObject, then pending row + SQS
 * (or the dedupe fast path: row `ready`, no SQS, when the hash-keyed
 * Analysis already exists — re-import is free, per CONTEXT.md).
 *
 * Status-aware responses (#54), by existing-row state:
 * - no row: copy → insert → (enqueue | ready) → 202 pending / 200 ready.
 * - `ready`: 200 ready, pure no-op (nothing left to do).
 * - `pending`/`processing`: row + IW copies already exist (copy-then-insert
 *   guarantees it) — skip the copy, re-enqueue (covers the enqueue-failed
 *   edge; a duplicate analysis run on the same hash is idempotent), 202.
 * - `failed`: the user-visible retry — re-copy (SOW side may have healed),
 *   reset the row to `pending`, enqueue; copy failure re-marks `failed` with
 *   the fresh reason and answers 200 failed (status-aware, #54: the row is
 *   the state surface; the card renders it).
 *
 * 404 when the content_hash does not resolve to a qualifying recording
 * (the browse surface never offered it, or curation dropped it since).
 *
 * Ordering (#55 decision 9): existing-row check → copy → insert → enqueue.
 * A copy is never followed by a `ready` row without its own IW copies
 * (fast path copies first, insert second — playback must not 404).
 *
 * Env: SOW_CATALOG_ENABLED (server-side flag, per request), the
 * SOW_CATALOG_* / SOW_IMPORT_R2_* credentials — see src/lib/sowImport.ts.
 */

/** Body of the request the Catalog card's Import CTA sends. */
type ImportBody = Partial<ImportRequest>;

export async function POST(request: Request) {
  if (!isSowCatalogEnabled()) {
    // Flag off: the route does not exist (#56). 404, not 403 — the feature
    // surface is absent, and no request body logic runs.
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let body: ImportBody;
  try {
    body = (await request.json()) as ImportBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const contentHash = body.content_hash;
  if (!contentHash || typeof contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(contentHash)) {
    return NextResponse.json(
      { error: 'content_hash is required (64-hex SHA-256 of the recording audio)' },
      { status: 400 },
    );
  }

  // Re-pick semantics (route doc): `ready` rows are a pure no-op — 200 and
  // done. `pending`/`processing`/`failed` fall through to the main flow:
  // pending/processing skip the copy (copy-then-insert already ran; the
  // enqueue-failed edge gets a fresh message) and re-enqueue; failed rows
  // re-copy (SOW may have healed) then reset + re-enqueue — the user-visible
  // retry.
  let existingStatus: string | null = null;
  try {
    existingStatus = await existingImportStatus(contentHash);
    if (existingStatus === 'ready') {
      const response: ImportResponse = { song_id: importSongId(contentHash), status: 'ready' };
      return NextResponse.json(response, { status: 200 });
    }
  } catch (err) {
    console.error(`import ${contentHash}: database lookup failed`, err);
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
  }

  let recording: ResolvedRecording;
  try {
    recording = await resolveRecording(contentHash);
  } catch (err) {
    console.error(`import ${contentHash}: SOW catalog lookup failed`, err);
    return NextResponse.json({ error: 'Catalog unavailable' }, { status: 503 });
  }
  if (!recording) {
    return NextResponse.json(
      { error: 'Recording not found in the curated catalog' },
      { status: 404 },
    );
  }

  // Copy-then-insert (#55 decision 9). A missing SOW source object fails the
  // copy here — deterministic, no retry loop inside the request: mark the
  // row `failed` with the reason (fresh or pre-existing row alike) and
  // answer 200 failed — status-aware (#54): the row is the state surface,
  // the card renders the failed chip + reason; 502 with a half-written state
  // would tell the client nothing actionable.
  const skipCopy = existingStatus === 'pending' || existingStatus === 'processing';
  if (!skipCopy) {
    try {
      await copyRecording(recording);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`import ${contentHash}: R2 CopyObject failed`, err);
      try {
        await insertImportRow(recording, 'pending');
        await markImportFailed(contentHash, `Import copy failed: ${message}`);
        const response: ImportResponse = {
          song_id: importSongId(contentHash),
          status: 'failed',
        };
        return NextResponse.json(response, { status: 200 });
      } catch (dbErr) {
        console.error(`import ${contentHash}: failed-row write also failed`, dbErr);
        return NextResponse.json({ error: 'Import copy failed' }, { status: 502 });
      }
    }
  }

  // Dedupe fast path (#55 decision 10): the hash-keyed Analysis already
  // exists → row `ready`, skip SQS. Still copy first (done above) so the
  // row's audio/lyrics URLs are live immediately.
  const analysisExists = await hasAnalysisFor(contentHash).catch((err) => {
    console.error(`import ${contentHash}: analysis HEAD failed`, err);
    return false; // R2 flaky → fall through to the slow path; the worker owns retries
  });

  try {
    if (analysisExists) {
      await insertImportRow(recording, 'ready');
      const response: ImportResponse = {
        song_id: importSongId(contentHash),
        status: 'ready',
      };
      return NextResponse.json(response, { status: 200 });
    }

    // Recovery landing: a `failed` row that made it past the re-copy gets
    // reset to `pending` (reason cleared) before the fresh enqueue. For
    // `pending`/`processing` the row is already correct — re-enqueue only.
    if (existingStatus === 'failed') {
      await resetForRetry(contentHash);
    }
    await insertImportRow(recording, 'pending');
    await enqueueAnalysis(importSongId(contentHash));
    const response: ImportResponse = {
      song_id: importSongId(contentHash),
      status: 'pending',
    };
    return NextResponse.json(response, { status: 202 });
  } catch (err) {
    console.error(`import ${contentHash}: insert/enqueue failed`, err);
    return NextResponse.json({ error: 'Failed to import recording' }, { status: 503 });
  }
}
