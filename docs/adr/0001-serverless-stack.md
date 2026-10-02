# Serverless stack: Vercel frontend, Lambda analysis worker, Cloudflare R2 storage, serverless Postgres

The legacy stack (Flask + docker-compose on a Graviton host, static-export Next.js, local-disk sqlite/pickles) is being replaced to eliminate server ops and cost at near-zero traffic. Decided shape: Next.js on Vercel **with API routes** (not a static export) as the only HTTP surface; audio analysis runs as a container-image **AWS Lambda triggered from a queue** (never synchronously — analysis takes minutes, exceeding every HTTP timeout in the path); audio and Analysis JSON live in **Cloudflare R2**, not S3, because R2 has zero egress fees and playback is a CDN-read-heavy workload — cost was the deciding priority over keeping everything in one cloud; metadata lives in **serverless Postgres** (not DynamoDB) per user preference. Songs start clean: legacy uploads are not migrated; the Graviton/ECR stack is decommissioned after cutover.

## Considered Options

- **S3 + DynamoDB (all-AWS)**: rejected on egress cost (S3 data-out charges for every play) and user preference for Postgres.
- **Fargate worker**: kept as escape hatch only; the queue decoupling makes swapping Lambda→Fargate a small change if 15-minute Lambda timeouts bite.
- **Static export + direct API Gateway calls**: rejected; user wants the Vercel backend layer (BFF) as the single API surface.

## Consequences

- R2 emits no S3-style event notifications into AWS, so the upload→enqueue handoff must be explicit (see upload pipeline design).
- The gzipped-pickle artifact format dies; Analysis is stored as JSON only.
- Anonymous access is retained; abuse control is Worker-side validation (R2 presigned PUT cannot carry size limits — only POST policies can, and R2 doesn't support POST uploads — so the Worker checks object size/content-type before downloading and marks offenders `failed`) plus an R2 lifecycle rule expiring stale pending uploads.
- A single public-read R2 bucket holds both audio and Analysis JSON; Song status gates playability. Uploads land directly at their final key — no private-to-public copy step, no doubled storage.
