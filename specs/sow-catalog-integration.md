# Infinite Worship — SOW Catalog Integration (Spec)

Status: **approved design brief, decided via structured interview (grill-with-docs), 2026-10-06. IMPLEMENTED 2026-10-07 (PR #64, release #61) with deviations — this file is design history, not ground truth; see CONTEXT.md, AGENTS.md, and `src/lib/sowImport.ts` docstrings. Key deviations: the BFF does the byte movement (dual-scope `SOW_IMPORT_R2_*` token, server-side CopyObject — `media/imp_<hash>`, `media/imp_<hash>.lrc`); the Worker stays SOW-blind (`{song_id, audio_key}` SQS body, no source descriptor / copy_only mode); import song id prefix is `imp_`, not `sow_`.**

## Problem Statement

Today the only way to get a Song into Infinite Worship is uploading a file from the user's computer. The user already maintains a curated worship catalog in the sibling Stream of Worship (SOW) app: songs with metadata, hash-addressed recordings (audio + LRC lyrics + analysis), so picking from that catalog should be the primary path. Uploads remain supported but secondary. Because our analysis takes minutes, users must also be able to see which songs are already processed and playable without waiting.

## Decisions (settled in interview — Q numbers refer to the grilling rounds)

| # | Decision | Choice |
|---|---|---|
| Q1 | Selection unit | SOW **Song** (never expose the Recording concept to users) |
| Q2 | Domain model | Extend our `songs` table with `source` + `sow_recording_id`; one lifecycle for uploads and imports |
| Q3 | Analysis dedupe | By content hash: identical audio → existing Analysis reused, Song is `ready` immediately |
| Q4 | "Already processed" list | Derived view: all `ready` Songs in our DB (imports + uploads), no curation |
| Q5 | Credentials | New **read-only** credentials created for this app; never SOW's own service secrets |
| Q6 | Upload role | Two tabs: catalog picker is the default; upload is the second tab, flow unchanged |
| Q7 | LRC purpose | Show lyrics during playback, **jump-aware** |
| Q8 | Multiple recordings | Deterministic auto-pick: published first, tie-break most recent |
| Q9 | Audio path | Worker copies audio + LRC from SOW R2 into our own bucket at import time; playback never touches SOW |
| Q10 | Catalog search | Mirror SOW's text search: `search_vector` tsvector OR ILIKE over title/title_pinyin/composer/lyricist/album; no semantic search |
| Q11 | Picker filter | `recordings.lrc_status='completed'` AND `recordings.visibility_status IN ('published','review')` |
| Q12 | Lyrics model | Lyrics follow the **source position of the currently sounding audio**; snap on jumps |
| Q13/Q14 | Analysis keying | Analysis JSON is keyed by **content hash for all songs** (uploads and imports share one file per hash) |
| Q15 | Lyrics surface | Single large centered line (karaoke-style), one line at a time |
| Q16 | Env naming | Neutral `SOW_CATALOG_*` prefix for the new credentials |

## Facts from SOW (scouted from `../stream_of_worship`, 2026-10-06)

- One Neon Postgres DB shared by SOW admin CLI (writer) and SOW webapp (reader). No public catalog API — every SOW webapp route is session-gated. Direct read-only DB access is the only practical path.
- `songs`: `id TEXT PK`, `title`, `title_pinyin`, `composer`, `lyricist`, `album_name`, `search_vector tsvector` (GIN).
- `recordings`: `content_hash TEXT PK` (SHA-256 of audio), `hash_prefix TEXT UNIQUE` (12 hex), `song_id FK`, `duration_seconds`, `lrc_status` (`pending|processing|completed|failed`), `visibility_status` (`published|review|hold|NULL`), `download_status`, `imported_at`, `created_at/updated_at`, `deleted_at`.
- R2: one bucket, objects `{hash_prefix}/audio.mp3`, `{hash_prefix}/lyrics.lrc`, `{hash_prefix}/analysis.json`, `{hash_prefix}/components.json`, `{hash_prefix}/stems/*.flac`. S3-compatible access with endpoint + access key pair.
- SOW already stores beat/downbeat timestamps and section labels, but **no clusters or jump candidates** — our Worker analysis is still required for every new content hash.
- SOW's own playability gate is `visibility_status IN ('published','review')` (signed-url shared-handler). We mirror it (Q11).
- Webapp catalog access uses `SOW_DATABASE_URL`; R2 uses `SOW_R2_ENDPOINT_URL` / `SOW_R2_ACCESS_KEY_ID` / `SOW_R2_SECRET_ACCESS_KEY` / `SOW_R2_BUCKET`. We do **not** reuse these names (Q16).

## Terminology (see CONTEXT.md — the glossary is normative)

Import, SOW Song Catalog, Song Source, Content Hash, Lyrics — defined there. This spec uses them accordingly: an **Import** is the act of selecting a catalog Song; the resulting row is a Song with source `sow`.

## Solution Overview

The single page gains two tabs: **SOW Catalog** (default) and **Upload**. The catalog tab searches SOW via a new BFF route that queries SOW Neon directly with a read-only connection. Selecting a song imports it: the BFF resolves the song to one qualifying recording (deterministic rule), creates (or reuses) our Song row, enqueues the SQS message carrying a source descriptor, and the Worker fetches the audio + LRC from SOW R2, analyzes it, and writes audio, lyrics, and Analysis into our own R2 bucket at content-hash-keyed paths. Playback and the ready list are unchanged in shape. During playback of a Song that has Lyrics, one large centered lyric line is shown, driven by the source position of the audio currently sounding.

## Data Model (our Postgres)

Migration `infra/sql/migrations/0002_add_sow_import.sql` (additive, following repo convention):

```sql
ALTER TABLE songs
    ADD COLUMN source text NOT NULL DEFAULT 'upload'
        CONSTRAINT songs_source_valid CHECK (source IN ('upload', 'sow')),
    ADD COLUMN sow_recording_id text,
    ADD COLUMN lyrics_url text,
    ADD COLUMN content_hash text;

CREATE INDEX songs_content_hash_idx ON songs (content_hash);

-- Only sow rows may carry a sow_recording_id; uploads never do.
ALTER TABLE songs
    ADD CONSTRAINT songs_sow_recording_id_source_check
    CHECK ((source = 'sow' AND sow_recording_id IS NOT NULL)
        OR (source = 'upload' AND sow_recording_id IS NULL));
```

- `song_id` for imports: `sow_` + `content_hash` (full 64-hex SHA-256, not the 12-char prefix). For uploads: unchanged (`base64(filename) + '_' + sha256(contents)`). Both embed the same content hash, which is what dedupe reads.
- `content_hash`: the bare SHA-256 hex, extracted from the song_id at write time for both sources. `songs_content_hash_idx` makes the dedupe lookup an index scan.
- `lyrics_url`: public URL of the copied LRC in our bucket; NULL for uploads.
- `title` for imports: SOW `songs.title` (Traditional Chinese, as-is).
- `analysis_url` points at the hash-keyed analysis JSON (see R2 layout below).

### R2 layout (our bucket)

All artifacts live in our own bucket, keyed so identical audio shares the expensive ones:
| Object | Key | Written by |
|---|---|---|
| Audio | `media/<song_id>` (unchanged — song_id embeds the hash) | upload PUT (uploads) / Worker copy (imports) |
| Analysis JSON | `analysis/<content_hash>.json` | Worker |
| Lyrics (LRC copy) | `lyrics/<song_id>.lrc` | Worker (imports only) |

- Public URLs derive from `R2_PUBLIC_BASE` (our custom domain, CORS-open, same as today's audio/analysis URLs).
- **Dedupe (Q3/Q14) and where the bytes move.** The BFF never transfers audio bytes: a Vercel function cannot stream a ~96 MB object through memory/time limits. All byte movement (S3 GetObject from SOW, PutObject to our keys) belongs to the **Worker**, which already downloads the audio to `/tmp` for analysis.
  - **True re-import fast path (no bytes to move):** if `analysis/<content_hash>.json` **and** `media/<song_id>` **and** `lyrics/<song_id>.lrc` all already exist (R2 `head_object` checks, cheap — this is by construction the same `song_id` as before), the BFF just inserts/updates our Song row as `ready` with the existing URLs — no SQS message, no copies, instant `ready`.
  - **Everything else goes through the Worker**, including the case where the shared analysis exists (e.g. produced by an **upload** of identical audio under a different `song_id`) but the import's per-song_id keys don't: the SQS message carries a **copy-only flag**; the Worker skips the jukebox analysis (it head-checks `analysis/<hash>.json` itself, or trusts the flag), copies audio + LRC into our keys, and marks the row `ready`. Copy-only runs are fast (no DSP) but still use the Worker's room for byte transfer.
  - **Full slow path:** no shared analysis either — the Worker validates, downloads, runs jukebox, writes hash-keyed analysis, copies audio + LRC, marks `ready`.
  - Pre-feature analysis objects (per-song-id key scheme) miss the hash-keyed head check → treated as no-analysis → full slow path; the Worker writes the hash-keyed file.
  - If the BFF's head checks error (R2 flaky), fall through to the slow path — the Worker is the retry owner.

## BFF API

New routes (all server-side, using the read-only SOW DSN):

### `GET /api/catalog?q=&limit=&offset=`

- Connects to `SOW_CATALOG_DATABASE_URL` (Neon, TLS, same pool pattern as `getDb()`; separate lazy singleton).
- Query: songs with at least one qualifying recording:
  ```sql
  SELECT s.id, s.title, s.title_pinyin, s.composer, s.lyricist, s.album_name
  FROM songs s
  JOIN recordings r ON r.song_id = s.id
  WHERE r.lrc_status = 'completed'
    AND r.visibility_status IN ('published', 'review')
    AND r.deleted_at IS NULL
    AND s.deleted_at IS NULL
    AND (
      $1 = ''
      OR s.search_vector @@ plainto_tsquery('simple', $1)
      OR s.title ILIKE '%' || $2 || '%'
      OR s.title_pinyin ILIKE '%' || $2 || '%'
      OR s.composer ILIKE '%' || $2 || '%'
      OR s.lyricist ILIKE '%' || $2 || '%'
      OR s.album_name ILIKE '%' || $2 || '%'
    )
  GROUP BY s.id
  ORDER BY s.title
  LIMIT $3 OFFSET $4
  ```
  Search mirrors SOW's own `fullTextSearchSongs` (`delivery/webapp/src/lib/db/search.ts:27-48`): `plainto_tsquery('simple', …)` OR'd with ILIKE on title/title_pinyin/composer/lyricist/album_name. The OR-ILIKE is load-bearing, not optional: `'simple'` does not segment CJK, so tsvector alone only matches whole-string Chinese titles; partial-title search works only via ILIKE. The ILIKE term must be `%q%` with `%`/`_`/`\` escaped in the term, not in the tsquery input.
- Response: `{ songs: [{ sow_song_id, title, title_pinyin, composer, lyricist, album_name, already_processed }] }` — `already_processed: boolean` computed by joining our own `songs` table on `sow_recording_id`/`content_hash`, so the picker can badge songs whose import is already `ready` without a second round-trip.
- Errors: SOW DB unreachable → `{ error }` with 502; the catalog tab shows an error state, the Upload tab keeps working.

### `POST /api/catalog/import`

Body: `{ song_id_of_sow: string }` (the SOW `songs.id`).
- Look up the song + its qualifying recordings (same filter as above).
- Recording pick (Q8): among recordings passing the filter, prefer `visibility_status='published'`; among those, the most recent `imported_at` (tie-break: `created_at`, then `content_hash` for determinism). If none published, same rule over `'review'`.
- Compute `song_id = 'sow_' + content_hash`; extract `content_hash`.
- **Routing the import (dedupe rules live in the R2 layout section):**
  - True re-import (all three objects already in our bucket) → row set `ready` with existing URLs, `{ status: 'ready' }`, no SQS message.
  - Otherwise → insert Song row (`pending`, `source='sow'`, `sow_recording_id`, `content_hash`, title from SOW) and enqueue:
  ```json
  { "song_id": "sow_<hash>", "audio_key": "<hash_prefix>/audio.mp3",
    "source": { "kind": "sow", "bucket": "<SOW_CATALOG_R2_BUCKET>",
                "lrc_key": "<hash_prefix>/lyrics.lrc",
                "copy_only": false } }
  ```
  `copy_only: true` when the BFF's head check found `analysis/<content_hash>.json` already present but the per-song_id keys aren't (e.g. shared analysis produced by an upload) — the Worker copies audio + LRC and skips the jukebox. Keeping the source descriptor in the message (not env) means one Worker deployment serves both sources; the old `{song_id, audio_key}` shape stays valid for uploads (source absent = our own bucket). SOW's object keys carry no extra prefix — `audio_key`/`lrc_key` use SOW's raw layout, `{hash_prefix}/audio.mp3` / `{hash_prefix}/lyrics.lrc`.
  - If the BFF's head checks error (R2 flaky), default to `copy_only: false` slow path — the Worker re-checks and is the retry owner.
- Response: `{ song_id, status }` — `pending` or `ready`; the existing 3s status polling on the client takes over (unchanged).
- Failure: recording vanished / not qualifying → 404 `{error}`; SOW DB down → 502; our DB/R2 down → 500; the import tab shows an error state next to the row.

### Existing routes

- `GET /songs` and `GET /songs/search` (our ready library, i.e. the derived processed list, Q4): unchanged — they already return the whole `songs` table; the response gains `source` and `lyrics_url` fields (types only).
- `POST /uploads`, `POST /songs/[id]/finalize`: unchanged except they now also persist `content_hash` (parsed from the client-computed song_id) and `source='upload'` on insert. No behavior change.

## Worker (`worker/handler.py`)

- `process_record` reads `body["source"]` (optional; absent = our own bucket, i.e. the upload path unchanged). For `kind: "sow"`:
  - Builds a **second boto3 S3 client** pointed at the SOW endpoint (`SOW_CATALOG_R2_ENDPOINT_URL`, `SOW_CATALOG_R2_ACCESS_KEY_ID`, `SOW_CATALOG_R2_SECRET_ACCESS_KEY`) — read-only creds; validation HEAD + download run against SOW's bucket with the message's `source.bucket`/`audio_key`.
  - Runs the same jukebox analysis (the SOW file is an ordinary MP3; content-type/size/duration validation applies as today).
  - Writes artifacts to **our** bucket: `analysis/<content_hash>.json` (hash-keyed — extracted from song_id), plus copies `audio` → `media/<song_id>` and `lyrics.lrc` → `lyrics/<song_id>.lrc` (S3 GetObject from SOW, PutObject to ours; the audio bytes are already local in `/tmp` from analysis, so the "copy" is a re-upload of the local bytes, plus one small LRC GET).
  - **URL derivation is from OUR destination keys, never the SOW source key:** today `_analyze` sets `audio_url = _media_url(audio_key)` — the key it downloaded. For imports that would mint a URL under our `MEDIA_BASE_URL` pointing at a nonexistent key. The rewrite must derive `audio_url = _media_url("media/" + song_id)` and `analysis_url = _media_url("analysis/" + content_hash + ".json")` explicitly, independent of where the bytes came from. This is the one deliberate divergence from the current upload flow (where source key == destination key).
  - In `copy_only` mode: skip jukebox entirely (head-check `analysis/<hash>.json`; if missing despite the flag, run full analysis instead), download audio + LRC from SOW, upload to our keys, mark `ready` (duration from SOW `recordings.duration_seconds`).
  - Updates our row: `status='ready'`, `audio_url`, `analysis_url`, `lyrics_url`, `duration`.
- Analysis key change (Q14): the analysis object key becomes `analysis/<content_hash>.json` **for uploads too**; the finalize/song row update derives it the same way. Worker env gains the four `SOW_CATALOG_R2_*` vars (endpoint, access key id, secret, bucket). `MAX_SONG_SECONDS` guard applies to imports as to uploads (a too-long SOW recording fails with the normal `failure_reason` UX).
- **Blast radius of the hash-keyed analysis** (everything that mentions `analysis/<song_id>.json` today):
  - `worker/reaper.py:83-84` — the pending-row cleanup deletes `media/<song_id>` plus an analysis key via `_key_from_url(analysis_url, f"analysis/{song_id}.json")`. Reaped rows are always `pending` (no `analysis_url` yet), so that fallback key never exists and the delete is a **silent no-op today** — the reaper effectively deletes only `media/<song_id>`. Preserve that behavior: **drop the analysis key from the delete batch entirely; do NOT repoint the fallback at `analysis/<content_hash>.json`.** A hash-keyed analysis is shared by every Song of identical audio — reaping a stuck pending upload whose hash has a ready sibling (an import, or a second upload) would 404 the sibling's playback while its `ready` row keeps the dead URL. A pending row uniquely owns exactly one object: `media/<song_id>`; the analysis object is owned by the content hash, not the row.
  - Docs to update at implementation (currently state the old key):
    - `AGENTS.md` — Architecture & Data Flow step 2 ("writes `analysis/<song_id>.json`").
    - `README.md` — data-flow step 4 (same phrase).
    - `infra/README.md` — mermaid diagram edge (`analysis/<song_id>.json`, ~line 25) and the smoke-test `curl -I .../analysis/<song_id>.json` (~line 836).
  - Historical handover notes under `docs/` record past smoke runs verbatim — leave untouched.
- Worker tests: extend `worker/test_remixatron.py`-style unit tests where the handler is directly testable via the injected `r2`/`connect` seams — cover source-descriptor routing (sow vs default), hash-keyed analysis key construction, and the copy-upload of audio/LRC bytes. Follow the existing injection-points convention (no mocks beyond the injected fakes).

## Frontend

### Tabs (`src/app/page.tsx`)

- New top-level tab state: `'catalog' | 'upload'`. Default `'catalog'`. Upload tab contains the existing upload flow verbatim; ready-library list and playback remain below/beside, shared across tabs (the processed list is one derived thing, Q4).
- Catalog tab: search input → `GET /api/catalog?q=`; list rows show title (+composer/album secondary); an "already processed ✓ / ready" badge for songs whose import exists in `ready` state; selecting a row → `POST /api/catalog/import` → the row/Song joins the existing polling list with the existing `pending → processing → ready|failed` status UX; on `ready`-fast-path the row is immediately playable.
- Errors per-row and per-tab as today (try/catch + error state; no toasts).

### Lyrics during playback

- New `src/lib/lyrics.ts`: parse LRC (`[mm:ss.xx]line` format) into `{ time, text }[]`; blank lines (SOW Gap Placeholder moments) render as empty lyric moments.
- `player.ts` (`loadSongForPlayback`) additionally fetches `lyrics_url` when present and returns parsed lines to the page.
- `audio.ts` (AudioEngine): the scheduler already knows the **source-time origin of the currently scheduled beat** (each beat has `start`/`duration` in source time; the engine tracks the current beat index and position within it). Add a lyric-position derivation: `sourceTime = currentBeat.start + elapsedInBeat`, exposed via the existing beat/progress callback cadence (one update per beat change or per animation tick — whatever the current progress UI already subscribes to; no new callback machinery beyond a getter).
- Display (Q15): one large centered line under/over the player area, keyed on the LRC line whose window contains `sourceTime`; snaps on jumps because the engine's current beat (and thus `sourceTime`) snaps. Instrumental gaps → blank. No scrolling list, no previous/next context.
- Upload-sourced Songs have no `lyrics_url` → no lyric surface at all (layout unchanged for them).
- This is the largest new client surface; it rides the existing Web Audio clock so it needs no separate timer and cannot drift from the audio.

## Environment & Credentials (Q5/Q16)

New vars in **this** app (never SOW's own names or values):

| Var | Used by | Notes |
|---|---|---|
| `SOW_CATALOG_DATABASE_URL` | BFF (`/api/catalog*`) | read-only Neon role, TLS |
| `SOW_CATALOG_R2_ENDPOINT_URL` | Worker (byte copies) | `https://<account>.r2.cloudflarestorage.com` |
| `SOW_CATALOG_R2_ACCESS_KEY_ID` | Worker | new R2 token, object-read-only scope |
| `SOW_CATALOG_R2_SECRET_ACCESS_KEY` | Worker | |
| `SOW_CATALOG_R2_BUCKET` | Worker | e.g. `stream-of-worship-prod` |

Provisioning (human/cloud steps, like the cutover checklist): create a read-only Postgres role on the SOW Neon project; create an R2 API token restricted to object reads on the catalog bucket. Least privilege: `SOW_CATALOG_DATABASE_URL` goes to **Vercel only**; the four `SOW_CATALOG_R2_*` vars go to the **Lambda only** — the BFF head-checks only our own bucket, which its existing `r2.ts` credentials already cover, so SOW R2 credentials must never reach Vercel. Document in `infra/README.md` and rewrite the AGENTS.md SOW gotcha to carve out the `SOW_CATALOG_*` exception ("these are ours, read-only, the only sanctioned cross-app access").

## Testing & Verification

- **Worker**: injection-point unit tests (fake `r2`, fake `connect`) for: sow-source routing, hash-keyed analysis keys, destination-key (not source-key) URL derivation, audio/LRC copy upload, copy-only mode (skips jukebox when analysis present, falls back to full analysis when flag lies), and slow-path statuses. Run: `cd worker && python -m unittest test_remixatron` (suite extended).
- **Frontend/BFF**: repo has no runner; QA = `npm run lint` + `npx tsc --noEmit` + exercising the real dev server. Local emulator verification: run SOW-shaped fakes (Postgres with SOW's `songs`/`recordings` schema + seeded rows, MinIO with `{hash}/audio.mp3`/`lyrics.lrc`), point `SOW_CATALOG_*` at them, and walk: catalog search (including partial-Chinese title) → import slow path (status polling to ready) → true re-import fast path (instant ready, zero SQS) → copy-only path (upload a byte-identical file, then import the seeded recording; no re-analysis) → playback with lyric snapping across a forced jump (temporarily raise jump probability or shrink min-beats-between-jumps in dev) → upload tab still works.
- **Lyrics parser**: pure function — plain Node script with `assert` (no framework, matching repo practice) or a `worker/`-style placement decision at implementation time; it must cover multi-timestamp lines, blank lines, and out-of-order timestamps.

## Out of Scope

- Semantic / embedding search over the catalog (pgvector): deferred (Q10).
- Lyrics for upload-sourced songs (user-supplied LRC upload): not requested.
- Lyrics rendering beyond the single current line (scrolling context, translations): rejected (Q15).
- Editing SOW data from this app: never — access is read-only by design.
- Streaming playback directly from SOW R2: rejected (Q9); the copy-at-import cost is accepted.
- Auto-import / bulk import of the whole catalog: not requested; imports happen per user selection.
- Reusing SOW's own analysis (beats/downbeats) to seed or shortcut our jukebox analysis: rejected — SOW has no clusters/jump candidates, and its beat times come from a different pipeline (allin1) than our madmom/Laplacian stack; mixing them buys nothing.

## Open Items for Implementation

- Whether the LRC parser tests live in `worker/` (Python) or as a Node script — decided at implementation; LRC parsing itself happens client-side, so Node.
- `R2_PUBLIC_BASE` naming for the lyrics URL construction (reuse the existing helper in `r2.ts`).
- BFF head-check helper: reuse the `r2.ts` client or a minimal read-only S3 HEAD client — decided at implementation (the BFF only needs HEAD, never GET/PUT).
