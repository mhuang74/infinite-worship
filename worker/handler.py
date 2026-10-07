"""Analysis Worker Lambda (container image) — Infinite Worship.

Consumes SQS messages enqueued by the BFF finalize step
(POST /api/songs/{id}/finalize, see ADR-0002). Per message:

1. Load the Song row from Postgres (DATABASE_URL). Only `pending` Songs are
   analyzed (a redriven message for an already-processed Song is skipped, not
   failed — the DLQ redrive must not clobber good state).
2. HeadObject the audio in R2 BEFORE downloading (presigned PUTs cannot
   enforce size or content-type — R2 has no POST policies; ADR-0001).
   Rejects: wrong content type, or duration over MAX_SONG_SECONDS (10 min).
3. Download to /tmp, run jukebox.InfiniteJukebox (beat caches redirect to
   /tmp — the image root filesystem is read-only-sized, not /tmp).
4. Serialize the Analysis as JSON (the legacy gzipped-pickle format is dead,
   ADR-0001) and PUT it to `analysis/<content_hash>.json` — hash-keyed, so
   identical audio from any source (upload or import) shares one Analysis
   (Q14, #62).
5. UPDATE the Song: status='ready', duration, audio_url, analysis_url.

Any validation or analysis failure marks the Song status='failed' with a
human-readable `failure_reason` (infra/sql/migrations/). The exception is
re-raised afterwards so SQS redrive can move the message to the DLQ (the
CloudWatch alarm fires on DLQ depth > 0; ADR-0004).

Required environment:
    DATABASE_URL        Neon connection string (NEW project; never SOW_*)
    R2_S3_ENDPOINT      https://<account_id>.r2.cloudflarestorage.com
    R2_BUCKET           bucket name (default: infinite-worship-media)
    R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY   R2 API token credentials
    MEDIA_BASE_URL      custom-domain base URL, e.g. https://media.example.com
    MAX_SONG_SECONDS    optional, default 600 (10 minutes, ADR-0001)
    ALLOWED_CONTENT_TYPES  optional comma list, default audio/mpeg,audio/mp3,
                        audio/wav,audio/x-wav,audio/ogg,audio/flac
    SQS_ENDPOINT        optional override (localstack dev)
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import tempfile
import traceback
from typing import Any, Callable

import boto3
import psycopg
from botocore.config import Config

LOGGER = logging.getLogger()
LOGGER.setLevel(logging.INFO)

MAX_SONG_SECONDS = int(os.environ.get("MAX_SONG_SECONDS", "600"))
R2_BUCKET = os.environ.get("R2_BUCKET", "infinite-worship-media")
MEDIA_BASE_URL = os.environ.get("MEDIA_BASE_URL", "").rstrip("/")
ALLOWED_CONTENT_TYPES = {
    ct.strip()
    for ct in os.environ.get(
        "ALLOWED_CONTENT_TYPES",
        "audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/ogg,audio/flac",
    ).split(",")
    if ct.strip()
}

# generous timeouts: R2 HEAD/GET/PUT are small ops; keeps a hung connection
# from eating the whole Lambda timeout.
_BOTO_CONFIG = Config(
    connect_timeout=10, read_timeout=60, retries={"max_attempts": 3}
)


def _r2_client():
    return boto3.client(
        "s3",
        endpoint_url=os.environ.get("R2_S3_ENDPOINT"),
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name=os.environ.get("R2_REGION", "auto"),
        config=_BOTO_CONFIG,
    )


class AnalysisError(Exception):
    """Deterministic validation/analysis failure (bad content-type, oversize,
    >10 min, corrupt audio). The Song is marked failed with a reason and the
    SQS message is deleted normally — redrive would just repeat the same
    deterministic outcome three times and then page the DLQ alarm for a
    non-problem (ADR-0004 reserves DLQ depth for pipeline breakage).

    Anything else (DB down, R2 5xx, jukebox crash) is NOT an AnalysisError:
    it re-raises unhandled so SQS retries and, after maxReceiveCount, the
    DLQ + alarm fire."""


# ~160 kB/s ceiling for MAX_SONG_SECONDS of audio (≈96 MB for 10 minutes).
# An object larger than this for a ≤10-minute song implies a bitrate/format
# worth rejecting before download; the true duration check still runs after
# decode (Content-Length alone cannot know length; Content-Encoding is not
# used on R2 audio objects).
MAX_SIZE_BYTES = MAX_SONG_SECONDS * 160_000


def _media_url(key: str) -> str:
    if not MEDIA_BASE_URL:
        raise RuntimeError("MEDIA_BASE_URL env var is required")
    return f"{MEDIA_BASE_URL}/{key}"


def _content_hash_from_song_id(song_id: str) -> str:
    """Extract the audio SHA-256 from either song_id shape.

    Uploads: `<urlsafe_b64(filename)>_<64-hex sha256>` (computed client-side,
    upload.ts). Imports: `sow_<64-hex sha256>` (sowImport.ts). Both carry the
    hash as the trailing underscore-separated 64-hex segment.
    """
    sha = song_id.rsplit("_", 1)[-1]
    if len(sha) != 64 or not all(c in "0123456789abcdef" for c in sha):
        raise AnalysisError(f"song_id {song_id!r} does not embed a 64-hex content hash")
    return sha


def _mark_failed(conn, song_id: str, reason: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE songs SET status = 'failed', failure_reason = %s "
            "WHERE song_id = %s",
            (reason, song_id),
        )
    conn.commit()
    LOGGER.info("song %s marked failed: %s", song_id, reason)


def process_record(record: dict[str, Any], r2=None, connect=None) -> str:
    """Process one SQS record. Returns the final Song status.

    `r2` and `connect` are injectable for tests (defaults: real R2 client and
    psycopg.connect(DATABASE_URL)).
    """
    body = json.loads(record["body"])
    song_id = body["song_id"]
    audio_key = body["audio_key"]
    LOGGER.info(
        json.dumps(
            {
                "event": "run_start",
                "song_id": song_id,
                "audio_key": audio_key,
                "message_id": record.get("messageId"),
            }
        )
    )

    r2 = r2 if r2 is not None else _r2_client()
    connect = connect if connect is not None else _connect_default

    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT status FROM songs WHERE song_id = %s", (song_id,)
                )
                row = cur.fetchone()
            if row is None:
                LOGGER.error("song %s not found; dropping message", song_id)
                LOGGER.info(json.dumps({"event": "run_end", "song_id": song_id, "status": "not_found"}))
                return "not_found"
            status = row[0]
            if status not in ("pending", "processing"):
                # Idempotent redrive: already terminal (ready/failed) or
                # otherwise not analyzable. 'processing' must RETRY: a
                # transient crash commits 'processing' before _analyze and
                # re-raises with the status rolled back only inside the same
                # transaction — if the Lambda dies hard (OOM, timeout), the
                # row stays 'processing' and a redelivery that skipped it
                # would let SQS consume the message before maxReceiveCount,
                # so the DLQ/alarm could never fire.
                LOGGER.info(
                    "song %s status is %s; skipping", song_id, status
                )
                LOGGER.info(
                    json.dumps({"event": "run_end", "song_id": song_id, "status": status})
                )
                return status

            with conn.cursor() as cur:
                # Idempotent: on a redelivery of a hard-crashed 'processing'
                # row this is a no-op (already processing).
                cur.execute(
                    "UPDATE songs SET status = 'processing' WHERE song_id = %s",
                    (song_id,),
                )
            conn.commit()

            try:
                _analyze(r2, conn, song_id, audio_key)
            except AnalysisError as exc:
                # Deterministic failure: record the reason, consume the
                # message. A redrive would deterministically fail again and
                # pollute the DLQ/alarm (ADR-0004).
                LOGGER.error("analysis of %s failed: %s", song_id, exc)
                conn.rollback()  # discard any uncommitted work from _analyze
                _mark_failed(conn, song_id, str(exc))
                LOGGER.info(
                    json.dumps({"event": "run_end", "song_id": song_id, "status": "failed"})
                )
                return "failed"
            except Exception as exc:
                # Transient/infra failure (DB down, R2 5xx, jukebox crash):
                # do NOT persist a terminal status. The redelivery guard
                # above admits BOTH 'pending' and 'processing' — either way
                # the next attempt re-enters analysis. Writing 'failed'
                # here would make the first retry consume the message and
                # the DLQ/alarm could never fire (ADR-0004). Roll the row
                # back to 'pending' (covers this run having committed
                # 'processing') and re-raise: SQS retries, and after
                # maxReceiveCount the DLQ + alarm fire. If every retry
                # exhausts without success, the message dies in the DLQ
                # with the Song stuck — precisely the broken-pipeline
                # signal the alarm exists for. (A hard crash — OOM/timeout
                # — skips this handler entirely; the row stays 'processing'
                # and the guard admits the retry too.)
                LOGGER.error(
                    "analysis of %s failed\n%s", song_id, traceback.format_exc()
                )
                conn.rollback()  # discard any uncommitted work from _analyze
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE songs SET status = 'pending' WHERE song_id = %s"
                        " AND status = 'processing'",
                        (song_id,),
                    )
                conn.commit()
                raise
        except Exception:
            conn.rollback()
            raise
    LOGGER.info(json.dumps({"event": "run_end", "song_id": song_id, "status": "ready"}))
    return "ready"


def _connect_default():
    return psycopg.connect(os.environ["DATABASE_URL"])


def _analyze(r2, conn, song_id: str, audio_key: str) -> None:
    """Validate → download → run jukebox → upload Analysis JSON → mark ready."""

    # ---- validate BEFORE downloading (ADR-0001: presigned PUTs cannot
    # enforce size or content type) ----
    head = r2.head_object(Bucket=R2_BUCKET, Key=audio_key)
    content_type = head.get("ContentType")
    size_bytes = head["ContentLength"]

    # Empty/missing ContentType is a reject, not a skip: a presigned PUT can
    # omit it, and an unknown-format object must not reach the decoder.
    if not content_type or content_type.split(";")[0].strip() not in ALLOWED_CONTENT_TYPES:
        raise AnalysisError(
            f"unsupported content type {content_type!r}; "
            f"allowed: {sorted(ALLOWED_CONTENT_TYPES)}"
        )

    if size_bytes > MAX_SIZE_BYTES:
        raise AnalysisError(
            f"audio object is {size_bytes} bytes, over the "
            f"{MAX_SIZE_BYTES} byte ceiling for a {MAX_SONG_SECONDS}s song"
        )

    LOGGER.info(
        json.dumps(
            {
                "event": "input_validated",
                "song_id": song_id,
                "content_type": content_type,
                "size_bytes": size_bytes,
            }
        )
    )

    # ---- download to /tmp (Lambda scratch; ~10 min audio at typical bitrates
    # is well under 10 GB) ----
    with tempfile.TemporaryDirectory(dir="/tmp") as workdir:
        local_path = os.path.join(workdir, "audio")
        r2.download_file(R2_BUCKET, audio_key, local_path)

        # ---- run the analysis; beat caches are written next to the audio
        # file (already /tmp) so the read-only image FS is never touched ----
        import numpy as np

        from jukebox import InfiniteJukebox  # deferred: heavy imports

        def _progress(pct: float, message: str) -> None:
            LOGGER.info("song %s: %.0f%% %s", song_id, pct * 100, message)

        # starting_beat_cache=np.array([]) is the documented "no cache" value:
        # the constructor calls .size on it unconditionally, so None breaks.
        jukebox = InfiniteJukebox(
            filename=local_path,
            progress_callback=_progress,
            do_async=False,
            starting_beat_cache=np.array([]),
        )

        if getattr(jukebox, "duration", None) is None:
            raise AnalysisError("no duration computed from audio")

        if jukebox.duration > MAX_SONG_SECONDS:
            raise AnalysisError(
                f"song is {jukebox.duration:.0f}s long, over the "
                f"{MAX_SONG_SECONDS}s (10 minute) limit"
            )

        LOGGER.info(
            json.dumps(
                {
                    "event": "analysis_complete",
                    "song_id": song_id,
                    "duration_s": round(float(jukebox.duration), 2),
                    "segments": len(jukebox.beats),
                    "tempo_bpm": round(float(jukebox.tempo), 1),
                    "clusters": int(jukebox.clusters),
                }
            )
        )

        analysis = _to_analysis_json(jukebox, os.path.basename(audio_key))

    # Hash-keyed (Q14/#62): identical audio from any source shares one
    # Analysis. Both song_id shapes embed the SHA-256 as the trailing
    # 64-hex segment (`<b64(filename)>_<sha256hex>` uploads,
    # `sow_<sha256hex>` imports), so the key derives from the id alone —
    # the worker never needs the DB to resolve the hash.
    content_hash = _content_hash_from_song_id(song_id)
    analysis_key = f"analysis/{content_hash}.json"
    r2.put_object(
        Bucket=R2_BUCKET,
        Key=analysis_key,
        Body=json.dumps(analysis).encode("utf-8"),
        ContentType="application/json",
    )

    audio_url = _media_url(audio_key)
    analysis_url = _media_url(analysis_key)
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE songs SET status = 'ready', duration = %s, "
            "audio_url = %s, analysis_url = %s, failure_reason = NULL "
            "WHERE song_id = %s",
            (jukebox.duration, audio_url, analysis_url, song_id),
        )
    conn.commit()
    LOGGER.info(
        "song %s ready: %d beats, %.1fs, analysis at %s",
        song_id,
        len(jukebox.beats),
        jukebox.duration,
        analysis_url,
    )

def _to_analysis_json(jukebox: Any, filename: str) -> dict[str, Any]:
    """Convert InfiniteJukebox results to the public Analysis JSON shape.

    Mirrors the legacy Flask surface consumed by the frontend
    (application/frontend/src/app/page.tsx reads `segments` as the Beat[]
    for the AudioEngine): { filename, segments, duration, tempo, sample_rate }.
    The per-beat raw-audio `buffer` (plus internal index fields) is stripped —
    it is not JSON-serializable and the Player slices audio itself.
    """
    segments = []
    for beat in jukebox.beats:
        segments.append(
            {
                "id": beat["id"],
                "start": beat["start"],
                "duration": beat["duration"],
                "cluster": beat["cluster"],
                "segment": beat["segment"],
                "jump_candidates": beat["jump_candidates"],
                "quartile": beat["quartile"],
            }
        )
    return {
        "filename": filename,
        "segments": segments,
        "duration": jukebox.duration,
        "tempo": float(jukebox.tempo),
        "sample_rate": jukebox.sample_rate,
    }


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """SQS-triggered Lambda entry point (aws_lambda_powerts-free on purpose:
    the container image stays slim and error semantics are simple)."""
    processed = []
    for record in event.get("Records", []):
        if record.get("eventSource") != "aws:sqs":
            LOGGER.warning("ignoring non-SQS record: %s", record.get("eventSource"))
            continue
        processed.append(process_record(record))
    return {"statuses": processed}
