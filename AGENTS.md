# Repository Guidelines

## Project Overview

Infinite Worship: a web app that plays worship songs as a seamless, endless remix. Audio analysis (beat/downbeat detection, Laplacian segmentation, beat clustering) computes jump points between similar beats; the client schedules beats with the Web Audio API and jumps probabilistically between them, looping forever.

Serverless architecture (ADR-0001..0004): Next.js on Vercel (UI + BFF API routes) is the only HTTP surface; a container-image AWS Lambda Worker runs analysis triggered from SQS; audio + Analysis JSON live in a public-read Cloudflare R2 bucket behind a custom domain; Song metadata lives in Neon serverless Postgres.

## Architecture & Data Flow

1. **Upload** (`src/lib/upload.ts`): the browser computes `song_id = urlsafe_base64(filename) + '_' + sha256hex(contents)` **client-side** (unicode-safe), POSTs `POST /api/uploads` → BFF mints a presigned R2 PUT and inserts a `pending` Song row in Neon → browser PUTs the file directly to its final public key `media/<song_id>` → browser calls `POST /api/songs/{id}/finalize`, which enqueues `{song_id, audio_key}` on SQS (the finalize call is the explicit upload→queue handoff — R2 events cannot reach SQS; ADR-0002).
2. **Worker** (`worker/handler.py`): Lambda consumes the SQS message; HeadObjects the audio in R2 BEFORE downloading (content-type allowlist, size/duration ceiling — presigned PUTs can't enforce limits), downloads to `/tmp`, runs `jukebox.InfiniteJukebox`, writes `analysis/<content_hash>.json` (hash-keyed: identical audio from any source shares one Analysis), sets the Song `ready`. Any failure marks it `failed` with `failure_reason`, then re-raises so SQS redrive → DLQ → CloudWatch alarm (ADR-0004).
3. **Analysis** (`worker/jukebox/remixatron.py`, ported from `exploration/remixatron`): librosa load (stereo 44.1 kHz) → trim → mono → madmom downbeat tracking → CQT chromagram → Laplacian segmentation (McFee 2014) → sklearn clustering → beats with `cluster`, `segment`, `jump_candidates`. Serialized as **JSON** (the legacy gzipped-pickle format is dead).
4. **Playback** (`src/lib/player.ts` + `src/lib/audio.ts`): `loadSongForPlayback` fetches the audio blob and Analysis JSON **directly from the Song's public R2 URLs** (custom domain, CORS-open in `infra/r2.tf`) — no BFF proxy; imported Songs also fetch `lyrics_url` (`media/<song_id>.lrc`, copied from SOW at import) and parse it client-side (`src/lib/lrc.ts`); lyric failures degrade to lyric-less playback, never a load error. `AudioEngine` schedules beats with a 100 ms-lookahead loop; jumps with probability 0.15 (min 8 beats between jumps) to a weighted-random candidate ≥16 beats away; 16-beat exponential crossfade. Loops forever. Zen Mode renders the single active lyric line, keyed to the current beat's source position so it stays correct across jumps (issue #60).
5. **Status UX** (`src/app/page.tsx`): after upload, the library re-fetches every 3 s until the polled Song reaches a terminal status; only `ready` Songs are playable; `failed` Songs show the stored `failure_reason`.

BFF API routes (`src/app/api/`): `POST /uploads`, `GET /songs`, `GET /songs/search?q=`, `POST /songs/[id]/finalize`.

## Key Directories

- `application/frontend/` — the only app under `application/`. Next.js App Router: `src/app/page.tsx` (single-page client, all UI state via hooks), `src/app/api/` (BFF routes), `src/components/` (UI), `src/lib/` (`audio.ts` AudioEngine, `player.ts` direct-R2 loading, `upload.ts` presigned flow + song_id, `r2.ts` presigning, `db.ts` Neon pool, `types.ts` shared types)
- `worker/` — `jukebox` Python package (`jukebox/remixatron.py`, installable via `pyproject.toml`), `handler.py` Lambda entry, `Dockerfile` (madmom/librosa pins — see gotchas), `test_remixatron.py`
- `infra/` — Terraform: `r2.tf` (bucket + custom domain + CORS + lifecycle), `sqs.tf` (queue + DLQ + alarm), `worker.tf` (Lambda + ECR), `sql/song_schema.sql`, `sql/migrations/` (additive, in filename order); see `infra/README.md`
- `exploration/` — research notebooks only (the old `exploration/remixatron` code lives on as `worker/jukebox`)
- `music/` — sample MP3 assets; `REFERENCE/` — vendored third-party source, read-only, never built

Legacy stack deleted (issue #25, commit `fd9c38e`): `application/backend/`, `application/docker-compose*.yml`, `application/dockerfile*`, `application/nginx.conf`, `application/build.sh` are gone; only `application/frontend/` remains.

## Development Commands

| Command | Purpose |
|---|---|
| `cd application/frontend && npm run dev` | Frontend + BFF dev server (:3000) |
| `npm run lint` | ESLint (`next lint`, eslint 8 + next config) |
| `npx tsc --noEmit` | Typecheck (no dedicated script; tsconfig is strict) |
| `cd worker && pip install -e . && python -m unittest test_remixatron` | Worker tests |
| `cd infra && terraform validate` | Validate Terraform (init first if needed) |
| `cd infra && terraform plan` | Plan (AWS-only views; Cloudflare needs the token) |
| `psql "$DATABASE_URL" -f infra/sql/song_schema.sql` | Apply Song schema to Neon |
| `psql "$DATABASE_URL" -f infra/sql/migrations/0001_add_failure_reason.sql` | Apply failure_reason migration (after base schema) |

Local emulator verification (used for #19–#23): run the BFF/worker against Docker Postgres + MinIO + LocalStack — e.g. `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16`, `docker run -d -p 9000:9000 minio/minio server /data`, `docker run -d -p 4566:4566 localstack/localstack`; point `R2_ENDPOINT`/`SQS_ENDPOINT`/`DATABASE_URL` at them. `r2.ts` accepts `R2_ENDPOINT` directly (takes precedence over `R2_ACCOUNT_ID`) for exactly this.

## Code Conventions & Common Patterns

- **Naming**: camelCase in TS/JS (`handlePlayPause`), snake_case in Python (`process_record`); React components `PascalCase.tsx`, lib files camelCase (`player.ts`), Python modules snake_case (`handler.py`). TS path alias `@/*` → `src/*`.
- **React**: function components with typed props interfaces; all state in the single `page.tsx` via hooks (no state library); `'use client'` directives; `useCallback`/`useRef` for engine refs; Tailwind utility classes inline.
- **Error handling**: frontend — try/catch/finally with `console.error` + user-facing error state. BFF routes return JSON `{error: ...}` with 4xx/5xx. Worker — catch, mark `failed` with `failure_reason`, re-raise so SQS redrive still applies.
- **Async**: TS — async/await + `fetch` (axios is legacy), audio scheduling via lookahead loops on the Web Audio clock, status polling via `setInterval`. Python — synchronous handler; the Lambda container is single-record (SQS batch size 1).
- **DI/state**: no frameworks — constructor-injected callbacks (`onBeatChange`, `onJump`) in the engine; `worker/handler.py` accepts `r2`/`connect` injection points for tests.

## Important Files

- `application/frontend/src/app/page.tsx` — single-page client owning all UI state + status polling
- `application/frontend/src/app/api/` — BFF routes (uploads presign, songs list/search, finalize→SQS)
- `application/frontend/src/lib/player.ts` — loads audio blob + Analysis JSON directly from R2
- `application/frontend/src/lib/audio.ts` — `AudioEngine` playback/jump scheduler
- `application/frontend/src/lib/upload.ts` — client-side `song_id` computation + presign→PUT→finalize flow
- `worker/handler.py` — Lambda entry: validate → analyze → JSON to R2 → status update
- `worker/jukebox/remixatron.py` — `InfiniteJukebox` DSP pipeline (~1000 lines, adapted from Dave Rensin's Infinite Jukebox)
- `worker/Dockerfile` — Lambda container image; carries the madmom/numpy/scipy/setuptools pins
- `infra/README.md` — Terraform layout, what each `.tf` file manages, human credential steps
- `application/frontend/GEMINI.md`, `application/backend/GEMINI.md` — legacy per-app assistant guidelines (legacy, pending deletion for the backend one)
- Root `.gitignore` — excludes `.env*`, media files (`*.mp3/*.wav/*.ogg`), `**/uploads/`

## Runtime/Tooling

- **Frontend: Node.js ≥ 18.17 + npm** (lockfile is `package-lock.json`; no Bun/pnpm/yarn). Next.js 15.5 (App Router, server-side API routes — the old `output: 'export'` static export is gone), React 19, TypeScript 5.9 (strict), Tailwind CSS 4, `@aws-sdk/client-s3`/`client-sqs`.
- **Worker: Python 3.11** (Lambda container base `public.ecr.aws/lambda/python:3.11`) with numpy 1.24.3, scipy 1.11.3, librosa 0.10.1, madmom (git HEAD).
- BFF env (Vercel): `DATABASE_URL`, `R2_ENDPOINT` (or `R2_ACCOUNT_ID`), `R2_BUCKET`, `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BASE`, `SQS_QUEUE_URL`, optional `SQS_ENDPOINT`/`AWS_REGION`. Worker env: `DATABASE_URL`, `R2_S3_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`, `MEDIA_BASE_URL`, optional `MAX_SONG_SECONDS` (default 600), `ALLOWED_CONTENT_TYPES`.
- No CI on the frontend (Vercel git integration deploys on push); worker/infra CI per #24/ADR-0004. No Makefile, no Prettier/Python formatter configs. Do not add tooling unprompted.

## Testing & QA

- First-party tests: `worker/test_remixatron.py` — Python stdlib `unittest` (`TestCase`, `subTest` parameterization, `np.allclose`, `assertRaises`). Run: `cd worker && python -m unittest test_remixatron` (needs the worker deps installed; no test framework elsewhere).
- Frontend has **no test framework** (no jest/vitest, no test script). QA signal is `npm run lint` + `npx tsc --noEmit`, plus exercising the real dev server for behavioral changes.
- No coverage tooling or expectations anywhere.
- Test conventions: `test_*.py` placed flat beside the module under test; pure-function unit tests, no mocking; injection points (`r2`, `connect`) instead of mock libraries.
- **Never** run bare `pytest` from the repo root — it sweeps in `REFERENCE/` suites with missing heavy deps. Scope test commands to `worker/`.

## Assistant Gotchas

- **`SOW_*` env vars belong to a DIFFERENT app** (`stream-of-worship`) — never use them, never point at its R2 bucket/Neon project/Cloudflare zone. All new Neon/Cloudflare resources for this app must be NEW ones (user directive; `infra/` declares them as such). **Exception (`SOW_CATALOG_*` / `SOW_IMPORT_*`)**: our own read-only credentials INTO SOW's catalog — minted for this app (Q5/Q16), the only sanctioned cross-app access. `SOW_CATALOG_DATABASE_URL` (staging Neon read role) is Vercel-only; `SOW_CATALOG_R2_*` (SOW bucket object-read) + `SOW_IMPORT_R2_*` (dual-scope copy token) belong to the BFF/Vercel; the Worker never gets SOW credentials (the BFF CopyObject does the byte movement; SQS bodies stay `{song_id, audio_key}`).
- **madmom pin gotcha** (bit us during the #18 port): madmom's git HEAD declares `scipy>=1.13`/numpy 2.x, which breaks the pinned numpy 1.24.3/scipy 1.11.3 stack librosa 0.10.1 needs. Install madmom with `--no-deps` (`pip install --no-deps madmom @ git+https://github.com/CPJKU/madmom`) and keep the pins — see `worker/Dockerfile`.
- **setuptools gotcha**: pin `setuptools<81` — librosa 0.10.1 still imports `pkg_resources` (removed in setuptools 81).
- **Pure-sine inputs hit a KMeans degenerate-input bug** in the jukebox clustering (degenerate covariance on synthetic tones) — do not "verify" analysis with generated sine waves; real music works.
- Dev servers may already be running externally — do NOT restart them.
- `application/frontend/GEMINI.md` describes the current frontend/BFF stack; `application/backend/GEMINI.md` was deleted with the legacy backend (issue #25).
- `REFERENCE/` is vendored third-party code — read for patterns, never modify.

## Cutover (issue #25) — in-repo steps DONE; cloud steps remain

In-repo (done, commit `fd9c38e` + this cleanup): legacy backend, docker-compose files, dockerfiles, nginx.conf, build.sh deleted; README/AGENTS rewritten. Remaining cloud-side steps (need creds / are irreversible):

- [x] Update the two `GEMINI.md` files (drop the legacy notes; delete `application/backend/GEMINI.md`)
- [ ] Delete the legacy public ECR images (`public.ecr.aws/u4p9h6o7/mhuang74/infinite-worship` — 16 images, irreversible; DELETE with `aws ecr-public batch-delete-image`)
- [ ] Decommission the Graviton host (`t4g.medium`, docker-compose deployment) — no such instance exists in the current AWS account inventory (only `sow-render-worker`, which belongs to a different app and must NOT be touched); if the host still exists it is in another account/region
- [ ] Final repo-wide grep: no remaining references to the Flask backend, docker-compose, or port 5001 (done at cutover; remaining hits are intentional legacy banners/cutover notes)

## Agent skills

### Issue tracker

Issues live in GitHub Issues on this repo, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
