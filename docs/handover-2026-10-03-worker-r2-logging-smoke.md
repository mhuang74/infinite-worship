# Handover: worker R2/logging fix + upload smoke test (in progress)

Written: 2026-10-03T16:31Z. Plan of record: `local://worker-r2-logging-fix-plan.md` (read it first — this doc supplements, does not replace it). Repo: `/Users/mhuang/Projects/Development/infinite-worship`.

## What was done (all committed/pushed/merged)

1. **PR #28 merged to main** (`36f5766`), deploy run `37136101438` **success**:
   - `infra/worker.tf`: log-group ARNs got `:*` suffix → CloudWatch streams now work.
   - `worker/handler.py`: `_r2_client()` signs `region_name=os.environ.get("R2_REGION", "auto")`; structured JSON logs added — `run_start` (song_id/audio_key/messageId), `input_validated` (content_type/size_bytes), `analysis_complete` (duration_s/segments/tempo_bpm/clusters), `run_end` on every exit path (ready/failed/skip/not_found).
   - `worker/reaper.py`: same `region_name` fix (was same latent bug, outside plan but identical).
2. **Commit `fd261e2` pushed to main**, deploy run `37136580950` **success**: `worker/Dockerfile` yum line now installs `libsndfile` — first analysis attempts died at `librosa.load` with `OSError: cannot load library 'libsndfile.so'` (soundfile ctypes-dlopens it; ffmpeg does not cover it). Lambda config `LastModified 16:24:50Z` now pins digest `sha256:5ec10a80...` (tag `fd261e274d5e3bd34e80aaa9446d27e2c042f0d2`).

## Log stream to verify against

`/aws/lambda/infinite-worship-worker` → stream `2026/10/03/infinite-worship-worker[$LATEST]499eec79daaa457a893c594cd4449d2f` (21 events as of 16:27Z). Events before 16:24:50Z are OLD-image failures (libsndfile). Any run at/after ~16:25Z on the new image should get past "10% loading file".

## CRITICAL incident to know about (fixed, but re-verify)

At ~16:19Z a stray `aws lambda update-function-configuration --environment Variables={DATABASE_URL=placeholder}` **replaced the whole env map** on `infinite-worship-worker` (no merge semantics). It was restored from the sibling `infinite-worship-reaper` function's env + `terraform.ci.tfvars`/handler defaults to all 7 vars: `DATABASE_URL` (Neon `ep-still-fire-b3ooq0tp-pooler...`), `R2_S3_ENDPOINT` (`https://6c80769fe5aa4be53908b83c3d0454cd.r2.cloudflarestorage.com`), `R2_BUCKET=infinite-worship-media`, `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`, `MEDIA_BASE_URL=https://media.michaelhuang.xyz`, `MAX_SONG_SECONDS=600`. Verified: 7 keys, `LastUpdateStatus=Successful`. **Next deploy's `terraform apply` will re-sync env from worker.tf and make this state authoritative again** — no action needed, but do not hand-edit Lambda env with `--environment` (replaces map).

## Smoke-test state right now

- Two songs, both were `pending`:
  - Target song: `MDUg6aGY5aSp5q2h5ZacLm1wMw==_31f913db2c7d6107aff1847d7a4691e9441fe2bc2aae4e7c1fd41f26941d4d3b` ("05 願天歡喜.mp3", ~247.6 s expected, audio 4954002 bytes, content_type audio/mpeg). Re-finalized at ~16:19Z → 202 queued. Its SQS message has been retrying against the broken images; **receive count may already be exhausted → check DLQ** (`infinite-worship-analysis-dlq`; was 0 at 16:14Z, main queue had 3 in-flight). If it DLQ'd: receive + delete the message, re-run `POST /api/songs/<urlencoded-id>/finalize`, expect 202.
  - Second song: `MS0wMSBHaXZpbmcgWW91IE15IEFsbC5tcDM=_dad858...` ("1-01 Giving You My All.mp3") also in the retry cycle (its message may still be in flight on the new image — first run at 16:22:25Z was still old-container).
- Queue: main `infinite-worship-analysis` (us-west-2, account 762288208920), redrive maxReceiveCount 3.

## Remaining steps (per plan Steps 5–6)

1. Check DLQ depth; drain + re-finalize if needed.
2. Poll `GET https://infinite-worship.michaelhuang.xyz/api/songs` every ~45 s until `ready` or `failed` (bound 15 min; Lambda timeout 840 s). Analysis takes minutes (progress lines appear in logs).
3. Verify logs on the stream show for the new-image run, in order: `run_start` → `input_validated` (`content_type: audio/...`, `size_bytes: 4954002`) → progress lines → `analysis_complete` (`duration_s ≈ 247.6`, `segments` > 0, `tempo_bpm`, `clusters`) → `run_end status ready`. No ERROR lines.
4. Verify song `ready` with duration/audio_url/analysis_url; `curl -sS -o /dev/null -w '%{http_code}' https://media.michaelhuang.xyz/analysis/<song_id>.json` → 200 and JSON has non-empty `segments`.
5. Queues drained (main 0/0, DLQ 0).
6. UI: browser tab `iw-smoke` is open on https://infinite-worship.michaelhuang.xyz — screenshot library showing the song playable.

## Gotchas

- **AL2's libsndfile (1.0.x) has no MP3 decoder** (MP3 landed in libsndfile 1.1.0). Both smoke-test songs are `audio/mpeg`, so `librosa.load` may still fail on the new image with a *format/backend* error (NOT "libsndfile.so not found" — that is fixed). librosa's automatic audioread fallback (audioread is a librosa dependency, ffmpeg is on PATH) is expected to decode MP3; if a run still dies at `librosa.load` with an sf format error, either pre-convert via ffmpeg in `_analyze` before loading or move the image to a newer base (AL2023) with libsndfile ≥1.1. Do not re-diagnose the missing-library issue — it is fixed.

- Local machine has **no terraform, no psql, no python `numpy`**; `python` doesn't exist (use `python3`). Worker unit tests can't run locally (madmom/numpy ABI mess with Python 3.12/3.14; `uv` attempts failed) — CI is the test gate.
- Vercel `env pull` redacts secrets (`[SENSITIVE]`); do not rely on it.
- `aws sqs get-queue-attributes --attribute-names A,B` fails (`InvalidAttributeName` on comma-joined name in this CLI version) — use `--attribute-names All`.
- Never touch `SOW_*` / `sow-render-worker` (different app; also do NOT use `stream_of_worship/.env.local` DATABASE_URL — wrong Neon project).
- Dev servers may already be running externally — don't restart them.
- Uncommitted in worktree: `.gitignore` + `application/frontend/.gitignore` (adds `.vercel`, `.env*`; unrelated leftovers, leave or commit separately).
