# infra/ — Terraform + database bootstrap

Cloud foundation for the serverless migration (ADR-0001..0004):
Cloudflare R2 storage + custom-domain public access, and the Neon
Postgres Song schema.

## Layout

| Path | Purpose |
| --- | --- |
| `providers.tf`, `versions.tf` | AWS + Cloudflare provider wiring |
| `r2.tf` | New R2 bucket, custom domain, CORS, lifecycle |
| `sqs.tf` | Analysis queue + DLQ (redrive after 3 receives) + DLQ-depth alarm (issue #21) |
| `worker.tf` | Analysis Worker Lambda (container image, ECR, reserved concurrency 2) + SQS trigger (issue #21) |
| `locals.tf` | Shared resource tags |
| `variables.tf` | All knobs (Cloudflare token/account/zone, domain, CORS origins, worker image/DB/R2 credentials) |
| `sql/song_schema.sql` | Song table applied to Neon (plain SQL, psql) |
| `terraform.ci.tfvars` | Non-secret config used by CI's `terraform apply` (see CI/CD below) |
| `sql/migrations/` | Additive migrations applied AFTER the base schema, in filename order |

## What Terraform manages

- **`cloudflare_r2_bucket.media`** — a NEW public-read bucket
  (`infinite-worship-media`); it is never the stream-of-worship bucket.
- **`cloudflare_r2_bucket_domain.media_custom_domain`** — public access via a
  custom domain on a Cloudflare-managed zone (`media_domain` +
  `cloudflare_zone_id` vars), NOT the rate-limited/non-production `r2.dev`
  (ADR-0002). The custom domain is what lets Cloudflare cache in front of R2.
- **CORS rules** — `GET`/`HEAD` (Player fetches blobs into the Web Audio API)
  and `PUT` (browser presigned uploads) for the origins in
  `cors_allowed_origins` (default `http://localhost:3000`; add the production
  Vercel origin(s) via tfvars).
- **Lifecycle rule** — uploads PUT directly to their final `media/<song_id>`
  key (ADR-0002: no copy step, no doubled storage). Anything still under
  `pending/` was never uploaded at all (e.g. crashed browser tab before the
  PUT finished) and expires after **7 days**
  (`pending_upload_expiry_days`) — generous headroom while bounding orphan
  storage.
- **AWS provider** — Lambda + SQS resources for the analysis worker are
  declared (see the next section); nothing touches the stream-of-worship
  account.

### Analysis worker + queue (issue #21)

- **`aws_sqs_queue.analysis`** — the BFF finalize step
  (`POST /api/songs/{id}/finalize`) enqueues `{song_id, audio_key}` here;
  the worker Lambda consumes (batch size 1, max concurrency 2). Visibility
  timeout is Lambda timeout + 60s so a slow analysis is never double-run.
- **`aws_sqs_queue.analysis_dlq`** — messages that fail 3 receives redrive
  here (14-day retention); **`aws_cloudwatch_metric_alarm.analysis_dlq_not_empty`**
  fires when the DLQ holds anything (ADR-0004).
- **`aws_lambda_function.worker`** — container image from `worker/Dockerfile`
  (madmom + librosa + static ffmpeg), 3 GB / 14 min, **reserved concurrency 2**.
  CI (ADR-0004) builds/pushes the image to `aws_ecr_repository.worker` and
  applies with `-var worker_image_uri=...`.

#### Human steps for the worker (in addition to the Cloudflare/Neon steps above)

1. Create a **NEW** R2 API token for this app (Account → R2 → Edit only —
   never the stream-of-worship token) and record its access key/secret.
2. Supply via `TF_VAR_worker_database_url`,
   `TF_VAR_worker_r2_access_key_id`, `TF_VAR_worker_r2_secret_access_key`
   (or a git-ignored tfvars), plus `worker_image_uri` after the first CI
   image push.
3. Apply the migration after the base schema:
   ```sh
   psql "$NEON_CONNECTION_URI" -f sql/migrations/0001_add_failure_reason.sql
   ```

#### BFF env vars (set in Vercel; the finalize route reads them)

`DATABASE_URL`, `R2_S3_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `SQS_QUEUE_URL` (from `terraform output
analysis_queue_url`), optional `SQS_ENDPOINT`/`AWS_REGION`.

## Human steps: Cloudflare credentials (required before `apply`)

No Cloudflare API token exists in the automation environment, so the
Cloudflare-provider resources are written but **not applied**. A human must:

1. Create a **NEW** Cloudflare API token for this app (never reuse the
   stream-of-worship token) with permissions:
   - Account → R2 → Edit
   - Zone → Zone → Read (target zone)
   - Zone → DNS → Edit (target zone; custom-domain validation records)
2. Copy `terraform.tfvars.example` → `terraform.tfvars` (git-ignored) and fill in:
   - `cloudflare_api_token`
   - `cloudflare_account_id`
   - `cloudflare_zone_id` (zone serving the bucket's custom domain)
   - `media_domain` (e.g. `media.yourdomain.com`, within that zone)
   - `cors_allowed_origins` (add the production Vercel origin(s))
3. Then:
   ```sh
   terraform init
   terraform apply
   ```

   Note: without the token, `terraform plan` stops at provider configuration
   ("API tokens must only contain characters a-z, A-Z, 0-9, hyphens and
   underscores" — the provider validates `api_token` before any API call), so
   nothing Cloudflare-side can be planned or applied until step 1 is done.
   `terraform validate` does NOT need the token and passes.

## Human/automation steps blocked here: Neon project creation

The Neon API (`api.neon.tech`) was unreachable from this host during the run
(DNS for `api.neon.tech` returned no answer; direct-IP TLS returned Cloudflare
error 1016 — network-level, retried repeatedly). `$NEON_API_KEY` is set, but
the project could not be created. `sql/song_schema.sql` is ready to apply.

Once `api.neon.tech` is reachable (retry `curl -s https://api.neon.tech/v2/users/me -H "Authorization: Bearer $NEON_API_KEY"`, expect HTTP 200):

1. Create the NEW project (never the stream-of-worship project):
   ```sh
   curl -s -X POST https://api.neon.tech/v2/projects \
     -H "Authorization: Bearer $NEON_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"project": {"name": "infinite-worship"}}'
   ```
2. Grab `connection_uris[0]` (or `connection_info`) from the response — the
   `postgresql://...neon.tech/infinite-worship?sslmode=require` URI for the
   `main` branch's default endpoint.
3. Apply the schema (this also creates the `songs` table):
   ```sh
   psql "$NEON_CONNECTION_URI" -f sql/song_schema.sql
   ```
4. Verify:
   ```sh
   psql "$NEON_CONNECTION_URI" -c '\d songs'
   ```
   Expect columns `song_id text PK`, `title`, `duration`, `status` with a
   check constraint on `pending|processing|ready|failed`, `audio_url`,
   `analysis_url`, `created_at timestamptz`.
5. Record the connection string wherever the BFF/worker read their
   `DATABASE_URL` (never commit it; never use SOW_* credentials).

## CI/CD (ADR-0004, issue #24)

`.github/workflows/deploy.yml` runs on push to `main`:

1. `terraform apply` (bootstrap) — creates the ECR repo, Lambda, SQS, IAM,
   CloudWatch, and Cloudflare/R2 resources BEFORE anything is pushed. On a
   truly empty state the required `worker_image_uri` has no real value yet; if
   the Lambda resource fails to create on that first apply, push a first
   image manually (steps 2–3 below, done once from a laptop with the AWS
   profile) and re-run the workflow. Subsequent runs read the last known
   image from state.
2. Build `worker/Dockerfile` → tag
   `${ACCOUNT_ID}.dkr.ecr.us-east-1.amazonaws.com/infinite-worship-worker:<git-sha>`
   and `docker push` it (the repo exists after step 1).
3. `aws lambda update-function-code --image-uri` on `infinite-worship-worker`,
   then `aws lambda wait function-updated` so the next Lambda invocation
   (and any Terraform in-flight drift read) sees the new image.
4. `terraform apply` again with `-var worker_image_uri=<pushed URI>` (pins the
   Lambda's image and records the new tag in state; the required
   `worker_image_uri` variable is satisfied here and in step 1).

One deploy at a time (`concurrency: deploy-main`, in-progress runs are
cancelled — a queued sequential apply of a stale SHA is pure waste). Every
step fails loudly; there is no `continue-on-error` anywhere.

### Required GitHub secrets (Settings → Secrets and variables → Actions)

NEW credentials for this app only — **never** the stream-of-worship values.

| Secret | Feeds | Notes |
| --- | --- | --- |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | ECR push, Lambda update, Terraform apply | IAM key for the deployer; region pinned to `us-east-1` in the workflow (matches the `aws_region` Terraform default) |
| `CLOUDFLARE_API_TOKEN` | `TF_VAR_cloudflare_api_token` | NEW token (R2:Edit, Zone:Read, DNS:Edit) |
| `CLOUDFLARE_ACCOUNT_ID` | `TF_VAR_cloudflare_account_id` | account owning the NEW R2 bucket |
| `CLOUDFLARE_ZONE_ID` | `TF_VAR_cloudflare_zone_id` | zone serving the bucket's custom domain |
| `WORKER_DATABASE_URL` | `TF_VAR_worker_database_url` | Neon URI for the NEW project |
| `WORKER_R2_ACCESS_KEY_ID` / `WORKER_R2_SECRET_ACCESS_KEY` | `TF_VAR_worker_r2_*` | NEW R2 API token for the worker |

`gh secret list` from the automation token is denied (HTTP 403) — a human
with admin must create these; the workflow fails loudly if one is missing.

### Non-secret Terraform inputs

The workflow applies with `-var-file=terraform.ci.tfvars` (committed,
non-secret). Copy the relevant lines from `terraform.tfvars.example` into
`terraform.ci.tfvars` and keep only the non-secret keys:

```hcl
media_domain           = "media.yourdomain.com"
cors_allowed_origins   = ["http://localhost:3000", "https://infinite-worship.vercel.app"]
```

Secret keys (`cloudflare_api_token`, `worker_database_url`,
`worker_r2_*`) come from `TF_VAR_*` env sourced from GH secrets (mapped in
the workflow's `env:` block) — the simplest robust pattern: no secret ever
touches the repo or appears in a plan file.

### Vercel git integration (frontend; dashboard setup, no code)

The frontend deploys on push to `main` via Vercel's git integration —
nothing about it lives in CI. One-time dashboard steps:

1. [vercel.com/dashboard](https://vercel.com/dashboard) → **Add New… → Project**
2. Import the `mhuang74/infinite-worship` Git repository (grant the Vercel
   GitHub App access if asked)
3. **Configure Project**:
   - **Framework Preset**: `Next.js` (auto-detected)
   - **Root Directory**: `application/frontend` — expand and **enable**
     "Root Directory override"; `next.config.ts` is clean (issue #19 removed
     `output: 'export'`; no `out/` remnants, nothing to ignore, so no
     `.vercelignore` was needed)
   - **Build / Install / Development commands**: leave default (`npm`, the
     lockfile is `package-lock.json`)
4. **Environment Variables** (Production + Preview; NEW values only):

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | Neon URI for the NEW project (same value as `WORKER_DATABASE_URL`) |
   | `R2_ENDPOINT` **or** `R2_ACCOUNT_ID` | `https://<account_id>.r2.cloudflarestorage.com`, or just the account id — `src/lib/r2.ts` builds the endpoint from `R2_ACCOUNT_ID` unless `R2_ENDPOINT` is set |
   | `R2_BUCKET` | `infinite-worship-media` (or the applied `r2_bucket_name`) |
   | `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | NEW R2 API token credentials |
   | `R2_PUBLIC_BASE` | `https://media.yourdomain.com` (the custom domain from `media_domain`) |
   | `SQS_QUEUE_URL` | `terraform output analysis_queue_url` |
   | `AWS_REGION` | `us-east-1` (SQS client region; matches the Terraform `aws_region` default) |

5. **Deploy** — every subsequent push to `main` deploys Production
   automatically; PRs get Preview deployments.

### First run

The workflow assumes Terraform has been applied once manually (issue #17
created the ECR repo, Lambda, queue). If a run fails because the Lambda or
ECR repo doesn't exist yet, do the bootstrap apply locally first
(see "Human steps" above), then re-run the workflow.

## Local commands

```sh
terraform init
terraform validate
terraform plan                                  # AWS-only views; Cloudflare needs the token
```
