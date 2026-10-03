/**
 * BFF finalize step (ADR-0002): after the browser PUTs audio directly to R2 at
 * its final key, it calls this route to enqueue the analysis job. R2 cannot
 * emit event notifications into AWS, so this explicit call is the upload→SQS
 * handoff. Returns 202 immediately — analysis takes minutes and runs on a
 * container-image Lambda triggered from the queue (ADR-0001).
 *
 * Env vars (set in Vercel project settings, per environment):
 *   DATABASE_URL             — Neon connection string (NEW project; never SOW_*)
 *   R2_ENDPOINT (or R2_ACCOUNT_ID) — R2 S3 endpoint; r2.ts derives
 *                     https://<account_id>.r2.cloudflarestorage.com from the
 *                     account id when R2_ENDPOINT is unset
 *   R2_BUCKET                — bucket name (default: infinite-worship-media)
 *   R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY — R2 API token (S3-compatible credentials)
 *   SQS_QUEUE_URL            — analysis queue URL from `terraform output analysis_queue_url`
 *   AWS_REGION               — queue region (default us-west-2)
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY — IAM creds for the SQS client
 *                     (default provider chain; on Vercel set these for a user
 *                     allowed only sqs:SendMessage on the queue — without
 *                     them finalize 502s)
 *
 * Depends on sibling-owned helpers: `r2HeadObject(r2, key)` in src/lib/r2.ts
 * (null on missing object) and `getDb()` in src/lib/db.ts.
 */
import { NextResponse } from 'next/server';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { getR2Config, r2HeadObject } from '@/lib/r2';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * SQS message body contract with the analysis worker (worker/handler.py):
 * { song_id: string, audio_key: string } where audio_key is the object's key
 * in the single public bucket (`media/<song_id>`; uploads land directly at
 * their final key — no copy step, see ADR-0002).
 */
interface FinalizeMessage {
  song_id: string;
  audio_key: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  if (!process.env.SQS_QUEUE_URL) {
    return NextResponse.json(
      { error: 'Server misconfigured: SQS_QUEUE_URL is not set' },
      { status: 500 },
    );
  }

  let song: { status: string } | undefined;
  try {
    const result = await getDb().query(
      'SELECT status FROM songs WHERE song_id = $1',
      [id],
    );
    song = result.rows[0];
  } catch (err) {
    console.error(`finalize ${id}: database lookup failed`, err);
    return NextResponse.json(
      { error: 'Database unavailable' },
      { status: 503 },
    );
  }

  if (!song) {
    return NextResponse.json({ error: `Song ${id} not found` }, { status: 404 });
  }
  if (song.status !== 'pending') {
    return NextResponse.json(
      { error: `Song ${id} is not pending (status: ${song.status})` },
      { status: 409 },
    );
  }

  // Cheap existence check before enqueueing so a browser that never completed
  // its PUT gets an immediate 409 instead of a failed Song minutes later.
  const audioKey = `media/${id}`;
  try {
    const head = await r2HeadObject(getR2Config().s3, audioKey);
    if (!head) {
      return NextResponse.json(
        { error: `Audio for song ${id} has not finished uploading` },
        { status: 409 },
      );
    }
  } catch (err) {
    console.error(`finalize ${id}: R2 HEAD failed`, err);
    return NextResponse.json(
      { error: 'Storage unavailable' },
      { status: 503 },
    );
  }

  const message: FinalizeMessage = { song_id: id, audio_key: audioKey };
  try {
    const sqs = new SQSClient({
      region: process.env.AWS_REGION ?? 'us-west-2',
      // SQS_ENDPOINT is an optional override for localstack-based dev; the
      // queue itself is AWS-side (R2 cannot reach it, hence the explicit
      // finalize call — ADR-0002).
      endpoint: process.env.SQS_ENDPOINT,
    });
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: process.env.SQS_QUEUE_URL,
        MessageBody: JSON.stringify(message),
      }),
    );
  } catch (err) {
    console.error(`finalize ${id}: SQS enqueue failed`, err);
    return NextResponse.json(
      { error: 'Failed to enqueue analysis' },
      { status: 502 },
    );
  }

  return NextResponse.json(
    { song_id: id, status: 'queued' },
    { status: 202 },
  );
}
