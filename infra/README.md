# infra/ — Deployment guide (serverless stack)

Single ordered runbook for standing up the Infinite Worship cloud stack from
nothing: **credentials → Neon → Terraform bootstrap → GitHub secrets → CI →
Vercel → smoke test → operations → teardown**. Execute top-to-bottom; every
phase assumes only the previous ones.

For local development and emulator verification (Docker Postgres + MinIO +
LocalStack), see the root [`README.md`](../README.md) — not duplicated here.

Architecture (ADR-0001..0004): Next.js on Vercel is the only HTTP surface
(UI + BFF API routes); a container-image AWS Lambda analyzes uploads
triggered from SQS; audio + Analysis JSON live in a public-read Cloudflare
R2 bucket behind a custom domain; Song metadata lives in Neon Postgres.

```mermaid
flowchart LR
    B[Browser] -- "1. POST /api/uploads" --> V[Vercel BFF]
    V --> N[(Neon Postgres<br/>songs table)]
    V -- "presigned PUT URL" --> B
    B -- "2. PUT media/&lt;song_id&gt;" --> R[(R2 bucket<br/>infinite-worship-media)]
    B -- "3. POST /api/songs/{id}/finalize" --> V
    V -- "SendMessage" --> Q[(SQS analysis queue)]
    Q -- "batch size 1" --> L[Lambda infinite-worship-worker]
    L -- "analysis/&lt;song_id&gt;.json" --> R
    L -- "status ready/failed" --> N
    B -- "4. fetch audio + analysis blobs" --> D[R2 custom domain<br/>media.yourdomain.com]
    ER[EventBridge rate(7 days)] --> RP[Lambda infinite-worship-reaper]
    RP --> N
    RP --> R
    Q -- "3 failed receives" --> DLQ[(analysis-dlq)]
```

## Resources Terraform manages

| Resource | Name | Key config |
| --- | --- | --- |
| `cloudflare_r2_bucket.media` | `infinite-worship-media` | public-read, NEW (never stream-of-worship) |
| `cloudflare_r2_bucket_domain.media_custom_domain` | `var.media_domain` | custom domain on a Cloudflare zone — not rate-limited `r2.dev`; enables edge caching (ADR-0002) |
| `cloudflare_r2_bucket_cors.media_cors` | — | `GET`/`HEAD` (Player blob fetches) + `PUT` (presigned uploads) for `cors_allowed_origins` |
| `cloudflare_r2_bucket_lifecycle.media_lifecycle` | — | **disabled stub** (`count = 0`) — orphan cleanup is the reaper Lambda, not an R2 rule (R2 can't join against `songs`) |
| `aws_sqs_queue.analysis` | `infinite-worship-analysis` | visibility timeout = Lambda timeout + 60 s; redrive → DLQ after 3 receives |
| `aws_sqs_queue.analysis_dlq` | `infinite-worship-analysis-dlq` | 14-day retention |
| `aws_cloudwatch_metric_alarm.analysis_dlq_not_empty` | `infinite-worship-analysis-dlq-not-empty` | fires when the DLQ holds anything |
| `aws_ecr_repository.worker` | `infinite-worship-worker` | image scan on push |
| `aws_lambda_function.worker` | `infinite-worship-worker` | container image, x86_64, 3008 MB, 840 s timeout, reserved concurrency 2, SQS batch size 1, max concurrency 2 |
| `aws_lambda_function.reaper` | `infinite-worship-reaper` | same image, `reaper.lambda_handler` entrypoint, 512 MB / 120 s, `rate(7 days)`, `REAP_GRACE_HOURS=24` |
| `aws_cloudwatch_log_group.*` | `/aws/lambda/infinite-worship-worker` + `…-reaper` | 14-day retention, JSON format |

Database: Neon `songs` table — `infra/sql/song_schema.sql` (base) +
`infra/sql/migrations/0001_add_failure_reason.sql` (applied after, in
filename order).

Terraform state is remote (S3 `infinite-worship-tfstate` + DynamoDB lock
`infinite-worship-tflock`, `backend.tf`) — required, because each CI run is
a fresh runner.

## Phase 0 — Prerequisites

Accounts: AWS (new resources only), a Cloudflare-managed DNS zone, Neon,
GitHub admin on `mhuang74/infinite-worship`, Vercel.

Local tooling:

- `terraform` ≥ 1.6 (CI pins 1.9.8)
- `aws` CLI (configured with the deployer credentials from Phase 1)
- `docker`
- `psql`
- `gh` (GitHub CLI)

**Every credential in this guide must be NEW for this app.** Never reuse the
stream-of-worship (`SOW_*`) bucket, Neon project, or Cloudflare zone.

## Phase 1 — Credentials

Create each credential, then record it where its consumer reads it
(`TF_VAR_*` for local Terraform, GitHub secrets for CI, Vercel env vars for
the BFF).

| Credential | Where created | Consumed by |
| --- | --- | --- |
| Cloudflare API token (Account → R2 → **Edit**; Zone → Zone → **Read**; Zone → DNS → **Edit** on the target zone) | Cloudflare dashboard → My Profile → API Tokens | `TF_VAR_cloudflare_api_token` / GH secret `CLOUDFLARE_API_TOKEN` |
| `cloudflare_account_id` | Cloudflare dashboard (account overview) | `TF_VAR_cloudflare_account_id` / GH secret `CLOUDFLARE_ACCOUNT_ID` |
| `cloudflare_zone_id` | Cloudflare dashboard (zone overview) | `TF_VAR_cloudflare_zone_id` / GH secret `CLOUDFLARE_ZONE_ID` |
| R2 API token (Account → R2 → Manage API tokens; Object Read & Write on the bucket) | Cloudflare dashboard | BFF env vars in Vercel + `TF_VAR_worker_r2_access_key_id` / `TF_VAR_worker_r2_secret_access_key` / GH secrets `WORKER_R2_ACCESS_KEY_ID` / `WORKER_R2_SECRET_ACCESS_KEY` |
| Neon connection string (`postgresql://…neon.tech/infinite-worship?sslmode=require`) | Phase 2 | `TF_VAR_worker_database_url` / GH secret `WORKER_DATABASE_URL` / Vercel `DATABASE_URL` |
| IAM **deployer** user (ECR push, `lambda:UpdateFunctionCode`, Terraform apply, S3/DynamoDB state access) | AWS IAM console | GH secrets `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` |
| IAM **BFF finalize** user (policy: `sqs:SendMessage` on the analysis queue ARN **only**) | AWS IAM console | Vercel `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` |

The finalize queue ARN is deterministic before any apply:
`arn:aws:sqs:us-east-1:<account-id>:infinite-worship-analysis`
(`resource_prefix` default `infinite-worship`, region default `us-east-1`).

## Phase 2 — Neon bootstrap

Create the NEW Neon project (console is the reliable path; the API also
works when reachable):

```sh
# API path (fallback: Neon console → New project, name it `infinite-worship`)
curl -s -X POST https://api.neon.tech/v2/projects \
  -H "Authorization: Bearer $NEON_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"project": {"name": "infinite-worship"}}'
```

Grab `connection_uris[0]` from the response (the `main` branch's default
endpoint). Apply the schema, then the migration:

```sh
export NEON_CONNECTION_URI='postgresql://…'
psql "$NEON_CONNECTION_URI" -f sql/song_schema.sql
psql "$NEON_CONNECTION_URI" -f sql/migrations/0001_add_failure_reason.sql
```

Verify:

```sh
psql "$NEON_CONNECTION_URI" -c '\d songs'
```

Expect: `song_id text` PK, `title`, `duration`, `status` with a check
constraint on `pending|processing|ready|failed`, `audio_url`,
`analysis_url`, `created_at timestamptz`, plus `failure_reason` from the
migration. Record the connection string — it becomes `DATABASE_URL` (BFF)
and `WORKER_DATABASE_URL` (worker/CI). Never commit it.

## Phase 3 — Terraform bootstrap (first apply from a laptop)

CI can't do the first apply: the Lambda needs a `worker_image_uri` and an
empty remote state has no prior value to resolve.

1. Create the remote state bucket + lock table (once):

   ```sh
   aws s3 mb s3://infinite-worship-tfstate --region us-east-1
   aws dynamodb create-table --table-name infinite-worship-tflock \
     --attribute-definitions AttributeName=LockID,AttributeType=S \
     --key-schema AttributeName=LockID,KeyType=HASH \
     --billing-mode PAY_PER_REQUEST --region us-east-1
   ```

2. Fill tfvars:

   ```sh
   cd infra
   cp terraform.tfvars.example terraform.tfvars   # git-ignored
   # Fill in: cloudflare_api_token, cloudflare_account_id, cloudflare_zone_id,
   # media_domain, cors_allowed_origins, worker_database_url, worker_r2_*
   # (or export them as TF_VAR_* instead of putting them in the file).
   ```

3. Init, validate, build + push a bootstrap image, apply:

   ```sh
   terraform init
   terraform validate
   docker build -t "$(aws sts get-caller-identity --query Account --output text).dkr.ecr.us-east-1.amazonaws.com/infinite-worship-worker:bootstrap" ../worker/
   aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin "$(aws sts get-caller-identity --query Account --output text).dkr.ecr.us-east-1.amazonaws.com"
   docker push "$(aws sts get-caller-identity --query Account --output text).dkr.ecr.us-east-1.amazonaws.com/infinite-worship-worker:bootstrap"
   terraform apply -var-file=terraform.ci.tfvars \
     -var "worker_image_uri=$(aws sts get-caller-identity --query Account --output text).dkr.ecr.us-east-1.amazonaws.com/infinite-worship-worker:bootstrap"
   ```

   Note: `terraform plan` stops at provider configuration without the
   Cloudflare token ("API tokens must only contain characters a-z, A-Z,
   0-9, hyphens and underscores" — the provider validates `api_token`
   before any API call). `terraform validate` does NOT need the token and
   always passes.

4. Record the outputs for later phases:

   ```sh
   terraform output analysis_queue_url     # → Vercel SQS_QUEUE_URL
   terraform output analysis_queue_arn     # → finalize IAM user policy
   terraform output media_base_url         # → Vercel R2_PUBLIC_BASE
   ```

## Phase 4 — GitHub secrets

`gh secret set` each of the 8 secrets (names match the header comment in
`.github/workflows/deploy.yml`; a human with admin must create them — the
workflow fails loudly if one is missing):

```sh
gh secret set AWS_ACCESS_KEY_ID            # deployer IAM access key
gh secret set AWS_SECRET_ACCESS_KEY        # deployer IAM secret key
gh secret set CLOUDFLARE_API_TOKEN         # R2:Edit, Zone:Read, DNS:Edit
gh secret set CLOUDFLARE_ACCOUNT_ID
gh secret set CLOUDFLARE_ZONE_ID
gh secret set WORKER_DATABASE_URL          # Neon URI from Phase 2
gh secret set WORKER_R2_ACCESS_KEY_ID      # R2 API token (worker/BFF token)
gh secret set WORKER_R2_SECRET_ACCESS_KEY
```

Fill the committed, non-secret `terraform.ci.tfvars` with the real values
(secret keys come from `TF_VAR_*` env sourced from GH secrets — no secret
ever touches the repo):

```hcl
media_domain         = "media.yourdomain.com"
cors_allowed_origins = ["http://localhost:3000", "https://infinite-worship.vercel.app"]
```

Include **every** Vercel origin (Production + Preview domains) plus
localhost — a missing origin fails browser blob fetches and uploads with
CORS errors.

## Phase 5 — CI

`.github/workflows/deploy.yml` runs on **push to `main`** only
(`concurrency: deploy-main`, cancel-in-progress — no stale queued applies).
Three phases per run:

1. **`terraform apply` (bootstrap infra)** — creates/refreshes ECR, SQS,
   IAM, CloudWatch, and the Cloudflare/R2 resources, with the
   `worker_image_uri` recorded by the previous run (remote state).
2. **Build + push worker image** — `worker/Dockerfile` →
   `<account>.dkr.ecr.us-east-1.amazonaws.com/infinite-worship-worker:<git-sha>`.
3. **Update Lambda code** — `aws lambda update-function-code --image-uri`,
   `aws lambda wait function-updated`, then a final `terraform apply` with
   `-var worker_image_uri=<pushed URI>` so state pins the new tag.

The frontend is **not** deployed here — Vercel's git integration owns it.

## Phase 6 — Vercel (frontend + BFF)

One-time dashboard setup:

1. [vercel.com/dashboard](https://vercel.com/dashboard) → **Add New… → Project**.
2. Import `mhuang74/infinite-worship` (grant the Vercel GitHub App access if asked).
3. **Configure Project**: Framework Preset `Next.js` (auto-detected);
   **Root Directory** `application/frontend` (expand and enable the
   override); leave build/install commands default (npm; lockfile is
   `package-lock.json`).

Environment variables (Production + Preview):

| Name | Value |
| --- | --- |
| `DATABASE_URL` | Neon URI from Phase 2 |
| `R2_ENDPOINT` **or** `R2_ACCOUNT_ID` | `https://<account_id>.r2.cloudflarestorage.com`, or just the account id — `src/lib/r2.ts` builds the endpoint from `R2_ACCOUNT_ID` unless `R2_ENDPOINT` is set |
| `R2_BUCKET` | `infinite-worship-media` |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 API token from Phase 1 |
| `R2_PUBLIC_BASE` | `https://media.yourdomain.com` (the `media_domain` custom domain) |
| `SQS_QUEUE_URL` | `terraform output analysis_queue_url` |
| `AWS_REGION` | `us-east-1` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | finalize IAM user credentials (Phase 1) — the finalize route's `SQSClient` uses the default provider chain and Vercel has no instance role |

**Naming trap:** the BFF reads `R2_ENDPOINT`; the worker Lambda gets
`R2_S3_ENDPOINT` (wired by Terraform from the Cloudflare account id). Set
`R2_ENDPOINT` only in Vercel — do not rename anything.

## Phase 7 — End-to-end smoke test

Against the deployed stack:

1. **Upload a real MP3** through the deployed UI. Never "verify" with
   generated sine waves — they hit a KMeans degenerate-input bug in the
   clustering (degenerate covariance on synthetic tones).
2. **Status lifecycle** — the library re-polls every 3 s until the Song
   reaches a terminal status: `pending → processing → ready`. Play it and
   confirm beat jumps happen.
3. **Analysis JSON is public:**

   ```sh
   curl -I https://media.yourdomain.com/analysis/<song_id>.json   # expect 200
   ```

4. **Failure path** — upload audio longer than 10 minutes: the Song goes
   `failed` and the UI shows the stored `failure_reason` (also visible in
   the `songs` row).
5. **DLQ is empty:**

   ```sh
   aws sqs get-queue-attributes \
     --queue-url "$(cd infra && terraform output -raw analysis_dlq_url)" \
     --attribute-names ApproximateNumberOfMessagesVisible   # expect "0"
   ```

## Operations

### Environment variables (defaults read from code)

**Worker Lambda** (`worker/handler.py`, set by Terraform unless noted):

| Var | Value / default |
| --- | --- |
| `DATABASE_URL` | Neon URI (Terraform-wired) |
| `R2_S3_ENDPOINT` | `https://<account_id>.r2.cloudflarestorage.com` (Terraform-wired) |
| `R2_BUCKET` | `infinite-worship-media` |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 API token (Terraform-wired) |
| `MEDIA_BASE_URL` | `https://<media_domain>` (Terraform-wired) |
| `MAX_SONG_SECONDS` | `600` (10-minute ceiling) |
| `ALLOWED_CONTENT_TYPES` | optional override; default `audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/ogg,audio/flac` |
| `SQS_ENDPOINT` | optional override (LocalStack dev only) |

**Reaper Lambda** (`worker/reaper.py`): same `DATABASE_URL`/`R2_*` set by
Terraform, plus `REAP_GRACE_HOURS=24`.

**BFF (Vercel)**: see the Phase 6 table.

### Observability & recovery

- **Logs**: CloudWatch log groups `/aws/lambda/infinite-worship-worker` and
  `/aws/lambda/infinite-worship-reaper` (14-day retention, JSON format).
- **DLQ alarm** `infinite-worship-analysis-dlq-not-empty`: a message landed
  in the DLQ — the Song failed inside the Worker beyond 3 SQS redrives
  **without** the Worker recording a `failed` status, i.e. the pipeline
  broke mid-flight (crash, timeout, OOM). Inspect worker logs and the DLQ
  message, fix, then redrive:

  ```sh
  aws sqs start-message-move-task \
    --source-arn "$(cd infra && terraform output -raw analysis_dlq_arn)" \
    --destination-arn "$(cd infra && terraform output -raw analysis_queue_arn)"
  ```

  (The message's Song row stays `processing`; a successful redrive marks it
  `ready`.)

### Status debugging

- **Stuck `pending` > 24 h** (crashed tab, dead message): the next weekly
  reaper run deletes the orphaned audio object and marks the Song `failed`.
  To reap immediately instead of waiting:
  `aws lambda invoke --function-name infinite-worship-reaper out.json`.
- **`failed` Song**: query the row —
  `psql "$NEON_CONNECTION_URI" -c "SELECT song_id, failure_reason FROM songs WHERE status='failed'"`.
  Deterministic validation failures (bad content-type, oversize,
  over-duration) are permanent for those bytes; the key is content-addressed,
  so re-uploading identical bytes yields the same Song ID.
- **Shipping worker changes**: merge to `main`. CI rebuilds and repoints the
  Lambda; no manual steps.

## Cutover checklist (remaining irreversible cloud teardown)

In-repo cutover is done (issue #25); these legacy-cloud items remain:

- [ ] Delete the legacy public ECR images (`public.ecr.aws/u4p9h6o7/mhuang74/infinite-worship` — 16 images, irreversible):
      `aws ecr-public batch-delete-image --repository-name mhuang74/infinite-worship --image-ids …`
- [ ] Verify the Graviton host (`t4g.medium` docker-compose deployment) is
      decommissioned — no such instance exists in the current AWS account
      inventory; if it still exists it is in another account/region. Do NOT
      touch `sow-render-worker` (different app).

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Finalize route 502s, logs say "Could not load credentials" | Vercel has no `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` for the finalize IAM user | Set both in Vercel (Phase 6); the SQS default provider chain has nothing else to fall back to |
| Browser upload/blob fetch fails with CORS errors | Origin not in `cors_allowed_origins` | Add the origin (every Vercel domain, incl. previews, + localhost) to `terraform.ci.tfvars` / `terraform.tfvars`, re-apply |
| `terraform plan` stops at "API tokens must only contain…" | No `TF_VAR_cloudflare_api_token` yet — expected before Phase 1 | Provide the token; `terraform validate` works without it |
| Song `failed` with "audio exceeds 10 minute limit" | Expected validation (`MAX_SONG_SECONDS=600`) | Not a bug — trim the audio or raise the ceiling deliberately |
| DLQ alarm fires | Worker crash loop: messages exhausted 3 receives without a recorded failure | Read worker logs + DLQ message, fix, redrive with `start-message-move-task` |
| Player loads but stays silent; console shows blob fetch/CORS error | Custom domain not applied, or the page's origin is missing from CORS | Verify `media_base_url` output + `curl -I` the analysis JSON; fix `cors_allowed_origins` |
