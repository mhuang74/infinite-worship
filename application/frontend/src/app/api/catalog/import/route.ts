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
  promoteToReady,
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
 * Status-aware responses (#54 Q6), by existing-row state:
 * - no row: copy → insert → (enqueue | ready) → 202 pending / 200 ready.
 * - `ready`: 200 ready, pure no-op.
 * - `pending`: re-pick while analyzing is a no-op for the message itself,
 *   but the enqueue-failed edge (#55 decision 9 sanctions the re-enqueue
 *   there) needs a fresh SendMessage — a `pending` row whose enqueue 503'd
 *   has no message in flight and would hang forever. Skip the copy (it
 *   already ran), re-enqueue (idempotent: SQS redelivery + the worker's
 *   redelivery guard admit duplicates), 202 pending.
 * - `processing`: the worker provably holds the message → 200, untouched.
 * - `failed`: NO auto-retry from the route (#54 Q6: retry is a separate
 *   re-enqueue action, follow-up ticket) → 200 with the current status;
 *   the card keeps rendering the failed chip + reason.
 * - fast path (analysis exists) applies to fresh and re-picked rows alike:
 *   promote to `ready` (UPDATE, not just the ON-CONFLICT-DO-NOTHING insert)
 *   so a stale `failed`/`pending` row cannot linger under a `ready` report.
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

  let existingStatus: string | null = null;
  try {
    existingStatus = await existingImportStatus(contentHash);
  } catch (err) {
    console.error(`import ${contentHash}: database lookup failed`, err);
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
  }

  // Re-pick semantics (#54 Q6): an existing row is status-aware and a no-op
  // by default — the CTA states key off the returned status.
  // - `ready`: nothing to do.
  // - `pending`/`processing`: the row exists with its IW copies (copy-then-
  //   insert guarantees it); SQS redelivery + the worker's idempotent
  //   redelivery guard make a duplicate analysis harmless, but per #54 Q6
  //   re-pick while analyzing is a NO-OP — except the enqueue-failed edge
  //   (#55 decision 9 sanctions the re-enqueue there): a `pending` row whose
  //   enqueue 503'd has no message in flight and would hang forever, so
  //   `pending` gets a fresh SendMessage (idempotent; the worker guard
  //   admits redelivery). `processing` means the worker provably holds the
  //   message → untouched.
  // - `failed`: NO auto-retry from the route (#54 Q6: retry is a separate
  //   re-enqueue action, a follow-up ticket) — return 200 with the current
  //   status; the card keeps rendering the failed chip + reason.
  if (existingStatus === 'ready' || existingStatus === 'processing' || existingStatus === 'failed') {
    const current = existingStatus as ImportResponse['status'];
    const response: ImportResponse = { song_id: importSongId(contentHash), status: current };
    return NextResponse.json(response, { status: 200 });
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

  // Copy-then-insert (#55 decision 9). Reaches here only when there is no
  // row, or the row is `pending` (enqueue-failed edge, re-pick after the
  // copy is already done and harmless — the copy is idempotent). A missing
  // SOW source object fails the copy: mark the row `failed` with the reason
  // and answer 200 failed — status-aware (#54): the row is the state
  // surface, the card renders the failed chip + reason; a 502 with a
  // half-written state would tell the client nothing actionable.
  const skipCopy = existingStatus === 'pending';
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
      // The Analysis exists: promote the row to ready regardless of its
      // current status (a fresh insert here is a no-op via ON CONFLICT, so
      // an existing pending/failed row is UPDATEd — reporting `ready` while
      // the DB says `failed` would leave the card stuck). The row's own
      // audio copy was made by the original import (copy-then-insert) or by
      // the copy above; either way media/imp_<hash> exists.
      await insertImportRow(recording, 'ready');
      if (existingStatus) {
        await promoteToReady(contentHash);
      }
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
