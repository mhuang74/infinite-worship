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

## Local commands

```sh
terraform init
terraform validate
terraform plan                                  # AWS-only views; Cloudflare needs the token
```
