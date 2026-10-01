"""Scheduled reap entry point: delete objects for Songs that never finalized.

Why this exists: the lifecycle story (ADR-0002) is "expire objects that never
finalize", but R2 lifecycle rules cannot join against the `songs` table — a
prefix/age rule either matches nothing (uploads land at their final
media/<song_id> key, no copy step) or expires READY Songs' objects, which
would break the "immutable and playable indefinitely once ready" contract.
So reaping is done here, with DB knowledge, on a weekly schedule
(infra/worker.tf aws_cloudwatch_event_schedule.reaper).

Rules:
- Only Songs with status 'pending' older than GRACE_HOURS are reaped. A
  crashed browser tab (or a Song whose analysis message died in the DLQ)
  leaves a pending row + orphaned audio; that is the only case this deletes.
- 'processing', 'ready', and 'failed' Songs are never touched: 'ready' is
  immutable and playable indefinitely (no time-based retention);
  'processing' means a message may still be mid-flight; 'failed' keeps its
  audio for debugging (and its key is content-addressed — a later
  successful re-upload of the same bytes would produce the same Song ID,
  so deleting a failed Song's object could break a concurrent retry).
- No dry-run flag: this runs unattended weekly; if manual inspection is
  needed, query the songs table directly.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import boto3
import psycopg
from botocore.config import Config

LOGGER = logging.getLogger()
LOGGER.setLevel(logging.INFO)

R2_BUCKET = os.environ.get("R2_BUCKET", "infinite-worship-media")
# Grace period: uploads can legitimately sit pending while the browser
# streams bytes and the finalize call races the user closing the tab.
GRACE_HOURS = int(os.environ.get("REAP_GRACE_HOURS", "24"))

_BOTO_CONFIG = Config(connect_timeout=10, read_timeout=60, retries={"max_attempts": 3})


def _r2_client():
    return boto3.client(
        "s3",
        endpoint_url=os.environ.get("R2_S3_ENDPOINT"),
        aws_access_key_id=os.environ.get("R2_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("R2_SECRET_ACCESS_KEY"),
        region_name=os.environ.get("AWS_REGION", "us-east-1"),
        config=_BOTO_CONFIG,
    )


def reap(connect: Callable[[], Any] | None = None, r2: Any | None = None) -> dict[str, Any]:
    """Delete objects for pending Songs past the grace window. Returns stats."""
    connect = connect if connect is not None else (
        lambda: psycopg.connect(os.environ["DATABASE_URL"])
    )
    r2 = r2 if r2 is not None else _r2_client()

    cutoff = datetime.now(timezone.utc) - timedelta(hours=GRACE_HOURS)

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT song_id, audio_url, analysis_url FROM songs
                 WHERE status = 'pending'
                   AND created_at < %s
                """,
                (cutoff,),
            )
            rows = cur.fetchall()

        reaped: list[str] = []
        for song_id, audio_url, analysis_url in rows:
            keys = [
                _key_from_url(audio_url, f"media/{song_id}"),
                _key_from_url(analysis_url, f"analysis/{song_id}.json"),
            ]
            batch: list[dict[str, str]] = [{"Key": k} for k in keys if k]
            if not batch:
                continue
            r2.delete_objects(Bucket=R2_BUCKET, Delete={"Objects": batch})
            reaped.append(song_id)
            LOGGER.info("reaped %s (keys: %s)", song_id, keys)

        if reaped:
            with conn.cursor() as cur:
                # Row is only deleted once its objects are gone; status stays
                # 'failed' with a reason so the UI can explain the disappearance.
                cur.execute(
                    """
                    UPDATE songs
                       SET status = 'failed',
                           failure_reason = 'upload expired: analysis never completed (orphaned upload reaped after %s h)'
                     WHERE song_id = ANY(%s)
                    """,
                    (GRACE_HOURS, reaped),
                )
            conn.commit()

    return {"reaped": reaped, "count": len(reaped)}


def _key_from_url(url: str | None, fallback: str) -> str:
    """Extract the object key from a stored public URL; None url → fallback."""
    if not url:
        return fallback
    return url.rstrip("/").split("/", 3)[-1] if "/" in url else fallback


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """EventBridge-scheduled entry point (rate: rate(7 days))."""
    stats = reap()
    LOGGER.info("reap complete: %s", json.dumps(stats))
    return stats
