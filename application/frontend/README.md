# Infinite Worship Frontend

Next.js 15 (App Router) UI + BFF. The BFF API routes under `src/app/api/` are
the only HTTP surface; the browser talks to them plus the R2 custom domain
directly (uploads PUT to presigned URLs; the Player fetches audio/Analysis
straight from storage).

## Structure

- `src/app/` — pages and BFF route handlers (`api/uploads`, `api/songs`,
  `api/songs/[id]/finalize`, `api/songs/search`)
- `src/components/` — `FileUpload`, `SongLibrary`, `SongSearch`,
  `PlaybackControls`, `Visualization`, `SongMetadata`
- `src/lib/` — `upload.ts` (client song_id + presign→PUT→finalize flow),
  `player.ts` (direct-from-R2 loading), `audio.ts` (Web Audio `AudioEngine`),
  `r2.ts`/`db.ts` (server-side helpers), `api.ts`, `types.ts`

## Development

```bash
npm install
npm run dev        # http://localhost:3000
```

The BFF needs env vars (dev: `.env.local`): `DATABASE_URL` (Neon; local dev
can point at a docker Postgres with the schema from `infra/sql/`),
`R2_ENDPOINT` (or `R2_ACCOUNT_ID`), `R2_BUCKET`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BASE`, `SQS_QUEUE_URL`, `AWS_REGION`.
Local emulators (docker Postgres + MinIO + ElasticMQ) work; see the root
`README.md` and `AGENTS.md`.

There is no docker-compose in this repo anymore — the legacy container stack
was deleted (ADR-0003).

## QA

```bash
npx tsc --noEmit   # typecheck (strict)
npm run lint       # eslint via next lint
```
