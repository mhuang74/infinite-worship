# Smoke test PASSED — worker R2/logging pipeline verified end-to-end (2026-10-03 ~17:15Z)

Continuation of `docs/handover-2026-10-03-worker-r2-logging-smoke.md`. All six handover
steps completed; smoke test passes.

## What was still broken after the handover

1. **The handover's pinned image was reverted.** A `deploy.yml` run (triggered by the
   handover-doc commit `351af7f` at 16:32Z) resolved the live image via
   `Code.ResolvedImageUri`, but the function was still pointing at `:bootstrap`
   (pre-fix image, digest `0e1b4838…`, built 12:30Z) — so the deploy re-asserted the
   OLD image. Lambda LastModified 16:32:40Z ≠ the handover's pinned 16:24:50Z.
   The 16:35:27Z run on the fresh stream (`…a3e5040…`) was the OLD code and died at
   `r2.head_object` with a transient R2/Cloudflare-edge `400 Bad Request`
   (non-XML body; not reproducible — same client/creds/key returned 200 locally).
2. **numba JIT cache crash (new, exposed by the libsndfile fix).** Once `librosa.load`
   could actually run, numba's `@jit(cache=True)` functions (e.g.
   `librosa.core.notation.__o_fold`) tried to write `.nbc`/`.nbi` files into
   read-only `/var/lang/lib/python3.11/site-packages/.../__pycache__` →
   `RuntimeError: cannot cache function '__o_fold': no locator available`.
   Every run on the new image died at analysis start.

## Fixes (both merged to main)

- Commit `55480af` — `worker/Dockerfile`: `ENV NUMBA_CACHE_DIR=/tmp/numba_cache`.
  Deploy run `37138526224` success; image `sha256:2d6bd5e9…` live at 16:55:59Z.
- No handler/code changes were needed for the 400 (transient); region `auto` signing
  verified working both locally and in-Lambda (manual `lambda invoke` got past
  `head_object` + download).

## Verified run (stream `2026/10/03/infinite-worship-worker[$LATEST]7727d7c16dcf4159ba806c14af6789b1`)

- 16:57:57Z `run_start` → 16:58:00 `input_validated` (audio/mpeg, 4954002 bytes)
  → 10%…100% progress → 16:59:50 `analysis_complete`
  `{duration_s: 245.39, segments: 576, tempo_bpm: 147.7, clusters: 41}`
  → 16:59:51 `run_end status=ready`. **Zero ERROR lines.** Wall time ~114 s.
- Song `MDUg…3b` ("05 願天歡喜.mp3"): `ready`, duration 245.38847, analysis_url set.
- `GET https://media.michaelhuang.xyz/analysis/<song_id>.json` → 200, JSON with
  576 segments, 40 clusters, 311 segments with jump_candidates.
- Second song `MS0w…6dc` ("1-01 Giving You My All.mp3") re-finalized after its
  message was lost in the broken era → also `ready` (327.5 s).
- Queues: main 0/0, DLQ 0/0 (stale messages drained).
- UI (browser tab): both songs listed `ready`; song auto-loaded, STATUS Playing,
  CURRENT BEAT advanced #4→#26, TOTAL PLAYING TIME 0:02→0:13.

## Environment/permission notes for future sessions

- Local `aws` default profile is the low-priv `infinite-worship-deployer` (no
  `logs:*`, no `sqs:Receive*`, no `lambda:Invoke`). Use `--profile mhuang74` for
  elevated access (log reads, DLQ drain, manual invoke).
- `infinite-worship-finalize` profile also lacks `logs:GetLogEvents`.
- DLQ drain: a `receive` under a short visibility timeout hides the message from the
  next receive; wait out the visibility window, then receive+delete.
- Manual worker invoke shape: `{"Records":[{"eventSource":"aws:sqs","messageId":…,
  "body":"<json>"}]}` — records without `eventSource: "aws:sqs"` are ignored
  (`{"statuses": []}`).

## Gotchas learned

- `deploy.yml` "Resolve current worker image URI" step trusts the LIVE function's
  image. If the function is pointing at a stale image when a deploy fires (as
  happened mid-smoke), the deploy re-pins the stale image. Verify
  `Code.ResolvedImageUri` digest matches the latest pushed commit tag after any
  deploy that mattered.
- `boto3` is unpinned in `worker/requirements.txt`; image builds pick up the latest
  (1.43.108 as of 2026-10-02). Verified NOT the cause of the 400.
- The MP3-codec fear in the handover (AL2 libsndfile 1.0.x has no MP3 decoder) did
  NOT materialize: `librosa.load` decoded `audio/mpeg` fine via soundfile/audioread.
