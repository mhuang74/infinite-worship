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
 * Status-aware responses (#54): 202 { song_id, status: 'pending' } for a
 * fresh import; 200 { song_id, status: <current> } for an existing row
 * (re-pick while analyzing is a no-op); 404 when the content_hash does not
 * resolve to a qualifying recording (the browse surface never offered it).
 *
 * Ordering (#55 decision 9): existing-row check → copy → insert → enqueue.
 * A failed copy is a plain 4xx/502 with no row and no SQS message — the SOW
 * object is missing at copy time → deterministic `failed` row with reason,
 * no retry loop. Enqueue failure after insert: no rollback machinery — the
 * route returns the row's status and the finalize-style re-enqueue path
 * applies on a later re-pick (same edge as the upload flow).
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

  // Idempotent re-pick: an existing row (any status) returns 200 with its
  // current status — the CTA states key off this (#54 Q6).
  try {
    const existing = await existingImportStatus(contentHash);
    if (existing) {
      const current = existing as ImportResponse['status'];
      const response: ImportResponse = { song_id: importSongId(contentHash), status: current };
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
  // copy here — deterministic, no retry loop: mark the row `failed` with the
  // reason so the Catalog card shows it, and enqueue nothing.
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
      return NextResponse.json(response, { status: 502 });
    } catch (dbErr) {
      console.error(`import ${contentHash}: failed-row write also failed`, dbErr);
      return NextResponse.json({ error: 'Import copy failed' }, { status: 502 });
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
