import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * BFF-side R2 wiring (ADR-0002): presigned PUT against the R2 S3-compatible
 * endpoint. Works with any S3-compatible endpoint (R2 in prod, MinIO locally).
 *
 * Env vars (server-side only, never NEXT_PUBLIC):
 * - R2_ACCOUNT_ID    Cloudflare account id; endpoint is
 *                    https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com.
 *                    Alternatively set R2_ENDPOINT directly (takes precedence;
 *                    MinIO/local testing uses this).
 * - R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY — R2 token credentials (secrets).
 * - R2_BUCKET        bucket name, e.g. infinite-worship-media.
 * - R2_PUBLIC_BASE   public base URL of the bucket's custom domain
 *                    (e.g. https://media.example.com); optional — only used
 *                    to build the Song's audio_url.
 */

export interface R2Config {
  s3: S3Client;
  bucket: string;
  publicBase: string | null;
}

export function getR2Config(): R2Config {
  const { R2_ACCOUNT_ID, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE } =
    process.env;

  const missing = (
    [
      ['R2_ACCESS_KEY_ID', R2_ACCESS_KEY_ID],
      ['R2_SECRET_ACCESS_KEY', R2_SECRET_ACCESS_KEY],
      ['R2_BUCKET', R2_BUCKET],
    ] as const
  )
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(`Missing required R2 env vars: ${missing.join(', ')}`);
  }

  const endpoint =
    R2_ENDPOINT ?? (R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined);
  if (!endpoint) {
    throw new Error('Missing R2 endpoint: set R2_ENDPOINT (or R2_ACCOUNT_ID)');
  }

  const s3 = new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID!,
      secretAccessKey: R2_SECRET_ACCESS_KEY!,
    },
    // R2 is path-style; force it so bucket name stays out of the hostname
    // (MinIO and localhost endpoints need this too).
    forcePathStyle: true,
  });

  return {
    s3,
    bucket: R2_BUCKET!,
    publicBase: R2_PUBLIC_BASE ? R2_PUBLIC_BASE.replace(/\/+$/, '') : null,
  };
}

/** Presign a PUT for the given key; the browser uploads the raw bytes to it. */
export async function presignPut(r2: R2Config, key: string, contentType: string): Promise<string> {
  return getSignedUrl(
    r2.s3,
    new PutObjectCommand({ Bucket: r2.bucket, Key: key, ContentType: contentType }),
    { expiresIn: 3600 },
  );
}

/**
 * HEAD an object. Returns null when the object does not exist (NoSuchKey/404);
 * shared with the finalize route's pre-enqueue existence check (#21).
 */
export async function r2HeadObject(
  s3: S3Client,
  key: string,
): Promise<{ contentLength: number; contentType: string } | null> {
  try {
    const head = await s3.send(
      new HeadObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key }),
    );
    return {
      contentLength: head.ContentLength ?? 0,
      contentType: head.ContentType ?? 'application/octet-stream',
    };
  } catch (err) {
    const errName = (err as { name?: string }).name;
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (errName === 'NoSuchKey' || errName === 'NotFound' || status === 404) {
      return null;
    }
    throw err;
  }
}
