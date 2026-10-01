# Infinite Worship

A web app that plays worship songs as a seamless, endless remix: it analyzes a song's musical structure, then jumps probabilistically between acoustically similar beats while keeping playback musically coherent — forever.

## Architecture

Fully serverless (see `docs/adr/0001-serverless-stack.md`):

- **Frontend + BFF** — Next.js on Vercel. The UI is a single-page client; Next.js API routes (`src/app/api/`) are the only HTTP surface ("BFF"). Deploys via Vercel's git integration.
- **Worker** — the analysis pipeline (`InfiniteJukebox`, ported into `worker/` as the `jukebox` Python package) runs as a container-image AWS Lambda, triggered from SQS — never synchronously (analysis takes minutes).
- **Storage** — Cloudflare R2: one public-read bucket behind a custom domain holds both audio and Analysis JSON (zero egress fees; CDN-cached playback).
- **Metadata** — Neon serverless Postgres: the `songs` table with a `pending → processing → ready | failed` status lifecycle.

Data flow (ADR-0002):

1. `POST /api/uploads` (BFF) mints a presigned R2 PUT URL and inserts a `pending` Song row in Neon. `song_id = urlsafe_base64(filename) + '_' + sha256hex(contents)` is computed **client-side** (`src/lib/upload.ts`).
2. The browser PUTs the audio directly to its final public key `media/<song_id>`.
3. `POST /api/songs/{id}/finalize` (BFF) enqueues `{song_id, audio_key}` on SQS — this explicit handoff exists because R2 event notifications cannot reach SQS.
4. The Worker Lambda downloads, analyzes, writes `analysis/<song_id>.json`, and marks the Song `ready` (or `failed` with a human-readable `failure_reason`; failures redrive to a DLQ that alarms).
5. The Player loads the audio blob and Analysis JSON **directly from R2** (no BFF proxy) and schedules beats with the Web Audio API; the UI polls Song status until analysis finishes.

## Repository Layout

```
application/frontend/   Next.js app: UI + BFF API routes (the only app under application/)
worker/                 jukebox Python package + Lambda handler + Dockerfile + tests
infra/                  Terraform (R2, SQS+DLQ, Lambda) + Neon SQL schema/migrations
exploration/            Research notebooks (laplacian segmentation, etc.)
music/                  Sample MP3 assets
docs/adr/               Architecture decision records (0001–0004)
```

`REFERENCE/` is vendored third-party source for reading only. The legacy Flask stack (`application/backend/`, docker-compose files, `nginx.conf`, `build.sh`) is **pending deletion** — see [Cutover pending](#cutover-pending-issue-25).

## Development

Prerequisites: Node.js ≥ 18.17, Python 3.11, Docker (for local emulators).

### Frontend + BFF

```sh
cd application/frontend
npm install
npm run dev        # http://localhost:3000 — UI and API routes together
npm run lint       # ESLint (next lint)
npx tsc --noEmit   # typecheck
```

BFF env vars (`.env.local` for dev): `DATABASE_URL`, `R2_ENDPOINT` (or `R2_ACCOUNT_ID`), `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BASE`, and `SQS_QUEUE_URL` for the finalize route. Server-side only — never `NEXT_PUBLIC_*`.

### Local emulators

The BFF and Worker work against any S3-compatible endpoint and plain Postgres, so local verification runs on Docker emulators (as used in the #19–#23 verifications):

```sh
docker run -d --name iw-postgres -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16
docker run -d --name iw-minio -p 9000:9000 -p 9001:9001 minio/minio server /data --console-address ":9001"
docker run -d --name iw-localstack -p 4566:4566 localstack/localstack

# point the BFF/worker at them: R2_ENDPOINT=http://localhost:9000,
# SQS_ENDPOINT=http://localhost:4566, DATABASE_URL=postgres://...
```

### Worker

```sh
cd worker
pip install -e .
python -m unittest test_remixatron
```

Pins matter here — see the gotchas in `AGENTS.md` before touching `requirements.txt` or the Dockerfile.

### Database schema

```sh
psql "$DATABASE_URL" -f infra/sql/song_schema.sql
psql "$DATABASE_URL" -f infra/sql/migrations/0001_add_failure_reason.sql   # after base schema
```

## Deployment

- **Frontend/BFF**: push to `main` → Vercel git integration deploys (ADR-0004).
- **Worker + infra**: GitHub Actions on merge to `main` builds the container image, pushes to ECR, updates the Lambda, and runs `terraform apply` (ADR-0004). Cloudflare credentials gate the apply.

## How the remix works

1. **Beat/downbeat detection** — librosa load + madmom DBN downbeat tracking.
2. **Segmentation** — CQT chromagram → Laplacian segmentation (McFee 2014).
3. **Clustering** — sklearn KMeans over beat features; for each beat, jump candidates among similar beats.
4. **Playback** — the client-side `AudioEngine` schedules beats with a lookahead loop and jumps with probability 0.15 to a weighted-random candidate, crossfading — looping forever.

## Technologies

Next.js 15 · React 19 · TypeScript · Tailwind CSS 4 · Web Audio API · wavesurfer.js · Python 3.11 · librosa · madmom · scikit-learn · AWS Lambda + SQS · Terraform · Cloudflare R2 · Neon Postgres · Vercel

## Cutover pending (issue #25)

The legacy deployment stack is still in-tree but is **not** the current architecture. The following human/decommission steps are deferred until the new Cloudflare/Neon credentials exist and the #24 pipeline is live — do not treat the files below as current:

- [ ] Delete `application/backend/` (Flask API + DSP)
- [ ] Delete `application/docker-compose*.yml`, `application/dockerfile*`, `application/nginx.conf`, `application/build.sh`
- [ ] Delete the legacy public ECR images (`public.ecr.aws/u4p9h6o7/mhuang74/infinite-worship:*`)
- [ ] Decommission the Graviton host (`t4g.medium` running docker-compose)

Until then, everything under `application/` except `frontend/` is legacy and unmaintained.

## License

Apache License 2.0 — see the [LICENSE](LICENSE) file.
