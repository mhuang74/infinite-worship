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

## What gets provisioned, per provider

Everything below is NEW for this app — never reuse any `stream-of-worship`
(`SOW_*`) account, project, bucket, or zone. Terraform-provisioned resources are
marked; the rest are created once by hand in the named phase.

### AWS (region `us-west-2`, new resources in an existing account)

| Resource | Name | Provisioned by / when |
| --- | --- | --- |
| S3 bucket | `infinite-worship-tfstate` | by hand, Phase 3 (Terraform remote state + lock — plumbing only, not app data) |
| IAM user | deployer — one customer-managed policy `infinite-worship-deployer` (ECR push/repo lifecycle, Lambda lifecycle incl. `lambda:UpdateFunctionCode`, SQS/IAM/Logs/EventBridge/alarms, S3 state access — Terraform remote state only, not app data) | by hand, Phase 1 |
| IAM user | BFF finalize (`sqs:SendMessage` on the analysis queue ARN only) | by hand, Phase 1 |
| ECR repository | `infinite-worship-worker` | Terraform |
| SQS queue | `infinite-worship-analysis` | Terraform |
| SQS DLQ | `infinite-worship-analysis-dlq` | Terraform |
| CloudWatch alarm | `infinite-worship-analysis-dlq-not-empty` | Terraform |
| IAM role + policy | `infinite-worship-worker` (Lambda logs + SQS receive + ECR image pull) | Terraform |
| Lambda event source mapping | SQS `infinite-worship-analysis` → `infinite-worship-worker`, batch size 1 | Terraform |
| Lambda function | `infinite-worship-worker` (container image, 3008 MB, 840 s) | Terraform (image pushed by CI, Phase 5) |
| Lambda function | `infinite-worship-reaper` (same image, `reaper.lambda_handler`, 512 MB, 120 s) | Terraform |
| EventBridge rule | `infinite-worship-reaper` (`rate(7 days)`) + target + permission | Terraform |
| CloudWatch log groups | `/aws/lambda/infinite-worship-worker`, `/aws/lambda/infinite-worship-reaper` | Terraform |

### Cloudflare (existing account + zone; new R2 resources only)

| Resource | Name | Provisioned by / when |
| --- | --- | --- |
| R2 bucket | `infinite-worship-media` | Terraform — or created by hand beforehand and imported (see Phase 3, "If the R2 bucket already exists") |
| R2 custom domain | `var.media_domain` on the existing zone | Terraform |
| R2 CORS rule | GET/HEAD/PUT for the allowed origins | Terraform |
| API tokens | Cloudflare API token (R2 Edit, Zone Read, DNS Edit) + R2 object token | by hand, Phase 1 |

Note: the Cloudflare DNS zone itself already exists — this stack only attaches
an R2 custom domain inside it; no zone is created.

### Neon (new project)

| Resource | Name | Provisioned by / when |
| --- | --- | --- |
| Project + `main` branch + connection string | `infinite-worship` | by hand, Phase 2 |
| `songs` table (+ `failure_reason` migration) | — | by hand, Phase 2 (`psql` — not Terraform) |

### GitHub

Nothing new to provision in the account: the repo `mhuang74/infinite-worship`
already exists. Per-run setup only: 8 Actions secrets (Phase 4).

### Vercel (new project)

| Resource | Name | Provisioned by / when |
| --- | --- | --- |
| Project | import of `mhuang74/infinite-worship`, Root Directory `application/frontend` | by hand, Phase 6 |
| Environment variables | `DATABASE_URL`, `R2_*`, `SQS_QUEUE_URL`, `AWS_*` (see Phase 6 table) | by hand, Phase 6 |

No other AWS services (no EC2/Graviton, no RDS/DynamoDB app tables), no new
Cloudflare zones, no other Neon projects.

## Resources Terraform manages

| Resource | Name | Key config |
| --- | --- | --- |
| `cloudflare_r2_bucket.media` | `infinite-worship-media` | public-read, NEW (never stream-of-worship). If the bucket already exists by hand (e.g. to scope the R2 API token to it), `terraform import 'cloudflare_r2_bucket.media' '<account_id>/<bucket_name>/<jurisdiction>'` before the first apply — never let Terraform create it or the name collides |
| `cloudflare_r2_custom_domain.media_custom_domain` | `var.media_domain` | custom domain on a Cloudflare zone — not rate-limited `r2.dev`; enables edge caching (ADR-0002) |
| `cloudflare_r2_bucket_cors.media_cors` | — | `GET`/`HEAD` (Player blob fetches) + `PUT` (presigned uploads) for `cors_allowed_origins` |
| `cloudflare_r2_bucket_lifecycle.media_lifecycle` | — | **disabled stub** (`count = 0`) — orphan cleanup is the reaper Lambda, not an R2 rule (R2 can't join against `songs`) |
| `aws_sqs_queue.analysis` | `infinite-worship-analysis` | visibility timeout = `local.worker_timeout_seconds` + 60 s (the Lambda timeout lives in `locals.tf`, not on the resource — see the cycle note below); redrive → DLQ after 3 receives |
| `aws_sqs_queue.analysis_dlq` | `infinite-worship-analysis-dlq` | 14-day retention |
| `aws_cloudwatch_metric_alarm.analysis_dlq_not_empty` | `infinite-worship-analysis-dlq-not-empty` | fires when the DLQ holds anything |
| `aws_ecr_repository.worker` | `infinite-worship-worker` | image scan on push |
| `aws_lambda_function.worker` | `infinite-worship-worker` | container image, x86_64, 3008 MB, 840 s timeout, no reserved concurrency (account limit — see Phase 1), SQS batch size 1, max concurrency 2 |
| `aws_lambda_function.reaper` | `infinite-worship-reaper` | same image, `reaper.lambda_handler` entrypoint, 512 MB / 120 s, no reserved concurrency, `rate(7 days)`, `REAP_GRACE_HOURS=24` |
| `aws_cloudwatch_log_group.*` | `/aws/lambda/infinite-worship-worker` + `…-reaper` | 14-day retention, JSON format |

Database: Neon `songs` table — `infra/sql/song_schema.sql` (base) +
`infra/sql/migrations/0001_add_failure_reason.sql` (applied after, in
filename order).

### Non-obvious Terraform constraints (learned the hard way — do not undo)

These constraints are load-bearing; changing them back reintroduces the
failures listed in Troubleshooting:

1. **`AWS_REGION` must not appear in `environment.variables`** of either
   Lambda (`worker.tf`). It is a Lambda-reserved key — `CreateFunction`
   rejects the whole request with `InvalidParameterValueException: Reserved
   keys used in this request: AWS_REGION`. Lambda injects `AWS_REGION`
   itself at runtime; `handler.py`/`reaper.py` already default to
   `us-west-2` for local runs via `os.environ.get("AWS_REGION", …)`.
2. **The worker execution role needs ECR pull grants** (`EcrPull` statement
   in `data.aws_iam_policy_document.worker`: `ecr:GetAuthorizationToken`,
   `ecr:BatchCheckLayerAvailability`, `ecr:GetDownloadUrlForLayer`,
   `ecr:BatchGetImage`). Lambda resolves and pulls the container image with
   the execution role; without these, `CreateFunction` fails with
   `Lambda does not have permission to access the ECR image`.
3. **Both Lambdas carry `depends_on = [aws_iam_role_policy.worker]`** (in
   addition to the log-group dependency). `CreateFunction` validates the
   execution role's ECR pull permission at create time, so the role policy
   must exist first — otherwise the parallel create races it and the same
   ECR error surfaces intermittently.
4. **The Lambda timeout lives in `locals.worker_timeout_seconds`** and
   `sqs.tf` reads the local, NOT `aws_lambda_function.worker.timeout`. The
   worker role policy references `aws_sqs_queue.analysis.arn`, so the queue
   must exist before the role policy; if the queue also referenced the
   function's `timeout` attribute, SQS → function → role policy → SQS forms
   a plan cycle (`Error: Cycle: aws_sqs_queue.analysis …`). Keep every
   timeout change in `locals.tf` (it updates both the Lambda and the queue's
   60-second-grace visibility timeout in one place).
5. **No `reserved_concurrent_executions` on either function** while the
   account's Lambda `ConcurrentExecutions` quota is 10: AWS requires ≥ 10
   unreserved concurrent executions account-wide, so *any* reservation ≥ 1
   fails `CreateFunction`/`PutFunctionConcurrency` with
   `decreases account's UnreservedConcurrentExecution below its minimum
   value of [10]`. The SQS event source mapping's
   `scaling_config.maximum_concurrency = 2` enforces the intended cap.

Terraform state is remote (S3 backend `infinite-worship-tfstate` with
S3-native lockfile locking, `backend.tf`; requires Terraform ≥ 1.10) —
required, because each CI run is a fresh runner. This is state plumbing
only: no application data lives here (the app's only database is Neon
Postgres).

## Phase 0 — Prerequisites

Accounts: AWS (new resources only), a Cloudflare-managed DNS zone, Neon,
GitHub admin on `mhuang74/infinite-worship`, Vercel.

Local tooling:

- `terraform` ≥ 1.10 (CI pins 1.16.4) — the S3 backend's `use_lockfile`
  locking needs ≥ 1.10 (`infra/backend.tf`)
- `aws` CLI (configured with the deployer credentials from Phase 1)
- `docker`
- `psql`
- `gh` (GitHub CLI)

**Every credential in this guide must be NEW for this app.** Never reuse the
stream-of-worship (`SOW_*`) bucket, Neon project, or Cloudflare zone.

## Phase 1 — Credentials

Create each credential, then record it where its consumer reads it
(`TF_VAR_*` for local Terraform, GitHub secrets for CI, Vercel env vars for
the BFF). Each credential below shows a **Console** and, where one exists, a
**CLI** path. Where a path genuinely doesn't exist, the doc says so instead
of inventing one.

### Cloudflare API token (Terraform/CI)

**Console (the only path — Cloudflare API tokens cannot be minted via CLI or
API):** Cloudflare dashboard → My Profile → API Tokens → **Create Token** →
Custom token with: Account → R2 → **Edit**; Zone → Zone → **Read**; Zone →
DNS → **Edit** on the target zone.

Consumed by: `TF_VAR_cloudflare_api_token` / GH secret `CLOUDFLARE_API_TOKEN`.

### `cloudflare_account_id` / `cloudflare_zone_id`

**Console:** dashboard → account overview (right sidebar, "Account ID") for
the account id; the target zone's Overview page (right sidebar, "Zone ID")
for the zone id.

**CLI:**

```sh
npx wrangler login    # one-time
npx wrangler whoami   # prints the account id
```

There is no wrangler printout for the zone id — copy it from the dashboard.

Consumed by: `TF_VAR_cloudflare_account_id` / `TF_VAR_cloudflare_zone_id` /
GH secrets `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_ZONE_ID`.

### R2 API token (worker + BFF)

**Console (the only path — `wrangler` has no R2 token-minting command):**
Cloudflare dashboard → R2 → **Manage API tokens** → create with Object Read
& Write on the bucket.

A token can only be scoped to a bucket that already exists — create the
`infinite-worship-media` bucket by hand first (Terraform imports it in
Phase 3, see "If the R2 bucket already exists" there), or create the token
without a bucket scope.

Consumed by: BFF env vars in Vercel + `TF_VAR_worker_r2_access_key_id` /
`TF_VAR_worker_r2_secret_access_key` / GH secrets
`WORKER_R2_ACCESS_KEY_ID` / `WORKER_R2_SECRET_ACCESS_KEY`.

### Neon connection string

Created in Phase 2 (project first, then the URI); see Phase 2 for both
console and `neonctl` paths.

Consumed by: `TF_VAR_worker_database_url` / GH secret `WORKER_DATABASE_URL` /
Vercel `DATABASE_URL`.

### IAM deployer user

Powers CI: ECR push and repository create/delete (Terraform manages the repo
resource), `lambda:UpdateFunctionCode`, and Terraform apply (including S3
access for Terraform remote state + lockfile only — not app data). Terraform's
Cloudflare-resource permissions ride the **Cloudflare API token** above, not
this AWS user.

**Console:** AWS IAM console → Users → **Create user** (e.g.
`infinite-worship-deployer`) → skip the policy step for now → **Create access
key** → CLI use case → record both values. (Do not rely on
`AmazonEC2ContainerRegistryPowerUser` — it grants push/pull only, not
`ecr:CreateRepository`, which the Terraform-managed ECR repo needs.)

**CLI:**

```sh
aws iam create-user --user-name infinite-worship-deployer

# ONE customer-managed policy carries the whole deployer grant. Do NOT try to
# split it across inline user policies: IAM's 2048-byte limit is the AGGREGATE
# of all inline policies on a user (the LimitExceeded error names the user,
# not the policy), and IAM measures URL-encoded JSON (spaces become %20, so
# pretty-printed JSON inflates ~45%). Two ~1.5 KB inline policies can never
# coexist — this was tried and failed live (see Troubleshooting).
# Managed-policy JSON caps at 6144 bytes; the document below measures ~4.6 KB
# URL-encoded, so it fits with headroom.
# Every action stays enumerated (no service wildcards — iam:* on * would let
# the deployer key grant itself anything).
cat > /tmp/deployer-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:BatchGetImage",
        "ecr:CompleteLayerUpload",
        "ecr:CreateRepository",
        "ecr:DeleteRepository",
        "ecr:DescribeImages",
        "ecr:DescribeRepositories",
        "ecr:GetAuthorizationToken",
        "ecr:GetDownloadUrlForLayer",
        "ecr:GetRepositoryPolicy",
        "ecr:InitiateLayerUpload",
        "ecr:ListImages",
        "ecr:ListTagsForResource",
        "ecr:PutImage",
        "ecr:SetRepositoryPolicy",
        "ecr:TagResource",
        "ecr:UntagResource",
        "ecr:UploadLayerPart"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "lambda:CreateFunction",
        "lambda:DeleteFunction",
        "lambda:GetCodeSigningConfig",
        "lambda:GetFunction",
        "lambda:GetFunctionCodeSigningConfig",
        "lambda:GetFunctionConfiguration",
        "lambda:GetFunctionUrlConfig",
        "lambda:GetLayerVersion",
        "lambda:GetRuntimeManagementConfig",
        "lambda:ListTags",
        "lambda:ListVersionsByFunction",
        "lambda:TagResource",
        "lambda:UntagResource",
        "lambda:UpdateFunctionCode"
      ],
      "Resource": [
        "arn:aws:lambda:us-west-2:<account-id>:function:infinite-worship-worker",
        "arn:aws:lambda:us-west-2:<account-id>:function:infinite-worship-reaper"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket",
        "s3:GetBucketLocation",
        "s3:ListBucketVersions",
        "s3:GetBucketVersioning"
      ],
      "Resource": [
        "arn:aws:s3:::infinite-worship-tfstate",
        "arn:aws:s3:::infinite-worship-tfstate/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "sqs:CreateQueue",
        "sqs:DeleteQueue",
        "sqs:GetQueueAttributes",
        "sqs:GetQueueUrl",
        "sqs:ListQueues",
        "sqs:ListQueueTags",
        "sqs:TagQueue",
        "sqs:UntagQueue",
        "sqs:SetQueueAttributes"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": [
        "arn:aws:iam::<account-id>:role/infinite-worship-worker"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:DeleteRolePolicy",
        "iam:GetPolicy",
        "iam:GetRole",
        "iam:GetRolePolicy",
        "iam:ListAttachedRolePolicies",
        "iam:ListRolePolicies",
        "iam:ListRoleTags",
        "iam:PutRolePolicy",
        "iam:TagRole",
        "iam:UntagRole"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:DeleteLogGroup",
        "logs:DescribeLogGroups",
        "logs:ListTagsForResource",
        "logs:PutLogEvents",
        "logs:PutRetentionPolicy",
        "logs:TagResource",
        "logs:UntagResource"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "events:DeleteRule",
        "events:DescribeRule",
        "events:ListTagsForResource",
        "events:ListTargetsByRule",
        "events:PutPermission",
        "events:PutRule",
        "events:PutTargets",
        "events:RemovePermission",
        "events:RemoveTargets",
        "events:TagResource",
        "events:UntagResource"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "cloudwatch:DeleteAlarms",
        "cloudwatch:DescribeAlarms",
        "cloudwatch:ListTagsForResource",
        "cloudwatch:PutMetricAlarm",
        "cloudwatch:TagResource",
        "cloudwatch:UntagResource"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "lambda:AddPermission",
        "lambda:CreateEventSourceMapping",
        "lambda:DeleteEventSourceMapping",
        "lambda:DeleteFunctionConcurrency",
        "lambda:GetAccountSettings",
        "lambda:GetCodeSigningConfig",
        "lambda:GetEventSourceMapping",
        "lambda:GetFunctionUrlConfig",
        "lambda:GetLayerVersion",
        "lambda:GetPolicy",
        "lambda:GetRuntimeManagementConfig",
        "lambda:ListEventSourceMappings",
        "lambda:ListFunctions",
        "lambda:ListTags",
        "lambda:ListVersionsByFunction",
        "lambda:PutFunctionConcurrency",
        "lambda:RemovePermission",
        "lambda:UpdateFunctionConfiguration"
      ],
      "Resource": "*"
    }
  ]
}
EOF
aws iam create-policy \
  --policy-name infinite-worship-deployer \
  --policy-document file:///tmp/deployer-policy.json
aws iam attach-user-policy --user-name infinite-worship-deployer \
  --policy-arn "arn:aws:iam::<account-id>:policy/infinite-worship-deployer"
aws iam create-access-key --user-name infinite-worship-deployer
```

Why the two scope groups in the Lambda statements: function-scoped actions
(`CreateFunction`, `UpdateFunctionCode`, …) target the two function ARNs;
mapping/permission/account actions (`CreateEventSourceMapping`,
`AddPermission`, `GetAccountSettings`, `ListTags` on event-source mappings)
have no function-level ARN form, so they ride `*`. `lambda:ListTags` appears
in both groups deliberately — Terraform reads tags on both functions and on
the event source mapping.

The ECR statement's `GetRepositoryPolicy`/`SetRepositoryPolicy` (plus
`DescribeImages`) are **caller-side** requirements, not just debugging
conveniences: on every `CreateFunction` for a container image, Lambda
auto-attaches a `LambdaECRImageRetrievalPolicy` resource policy to the repo
so it can pull — and that auto-attach requires the *calling* identity to hold
`ecr:GetRepositoryPolicy` + `ecr:SetRepositoryPolicy` (AWS docs, "Amazon ECR
permissions" under Lambda container images). Without them the first
`CreateFunction` on a fresh repo fails with
`Lambda does not have permission to access the ECR image` even though the
execution role already has full pull grants. After the first function
exists, the repo policy persists and same-account creates succeed without
those actions — which makes the failure easy to misdiagnose as IAM lag.
Verify with:

```sh
aws ecr get-repository-policy --repository-name infinite-worship-worker
```

Its presence (with a `lambda.amazonaws.com` principal) is the fingerprint of
a previous Lambda create.

IAM policy changes propagate for **1–2 minutes** before the new actions are
honored by service calls. If a fresh apply still reports
`not authorized to perform: <service>:<Action>` right after a
`create-policy-version`, wait two minutes and retry instead of editing the
policy again. Verify intent with:

```sh
aws iam simulate-principal-policy \
  --policy-source-arn <deployer-arn> \
  --action-names <Action>
```

Simulation honors pending versions immediately; service calls lag.

The Terraform apply also needs **Lambda account headroom**: this account's
`ConcurrentExecutions` limit is 10 (new-account default), and AWS rejects any
`reserved_concurrent_executions` ≥ 1 because reservations would push the
account-wide unreserved pool below 10. The functions therefore carry **no
reserved concurrency** — throttling is enforced by the SQS event source
mapping's `maximum_concurrency = 2` (`infra/worker.tf`). If you raise the
account quota (Service Quotas → Lambda → Concurrent executions), you may
re-add reservations; the Terraform comments in `worker.tf` explain the
constraint either way.

Consumed by: GH secrets `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`.

### IAM BFF finalize user

Policy: `sqs:SendMessage` on the analysis queue ARN **only**.

**Console:** AWS IAM console → Users → **Create user** (e.g.
`infinite-worship-finalize`) → attach the inline policy below → **Create
access key** → CLI use case → record both values.

**CLI:**

```sh
aws iam create-user --user-name infinite-worship-finalize

cat > /tmp/finalize-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:us-west-2:<account-id>:infinite-worship-analysis"
    }
  ]
}
EOF
aws iam put-user-policy --user-name infinite-worship-finalize \
  --policy-name finalize-send --policy-document file:///tmp/finalize-policy.json

aws iam create-access-key --user-name infinite-worship-finalize
```

The finalize queue ARN is deterministic before any apply:
`arn:aws:sqs:us-west-2:<account-id>:infinite-worship-analysis`
(`resource_prefix` default `infinite-worship`, region default `us-west-2`).

Consumed by: Vercel `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`.

## Phase 2 — Neon bootstrap

Create the NEW Neon project `infinite-worship`.

**Console:** [neon.tech](https://neon.tech) console → **New project** → name
it `infinite-worship` → the Dashboard → **Connection Details** pane shows the
`main` branch's connection string (copy it).

**CLI:**

```sh
# One-time: install neonctl and authenticate
npm i -g neonctl
neonctl auth

neonctl projects create --name infinite-worship
neonctl connection-string main    # add --project-id <id> if you have several projects
```

Apply the schema, then the migration:

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

1. Create the remote state bucket (once) — Terraform backend plumbing, not
   app storage; the app's database is Neon (Phase 2). Locking is S3-native
   (lockfile objects in this bucket, `backend.tf` `use_lockfile = true`) —
   no DynamoDB table needed:

   ```sh
   aws s3 mb s3://infinite-worship-tfstate --region us-west-2
   ```

   Console equivalent: S3 console → **Create bucket** (name
   `infinite-worship-tfstate`, region `us-west-2`).

2. Fill tfvars:

   ```sh
   cd infra
   cp terraform.tfvars.example terraform.tfvars   # git-ignored
   # Fill in: cloudflare_api_token, cloudflare_account_id, cloudflare_zone_id,
   # media_domain, cors_allowed_origins, worker_database_url, worker_r2_*
   # (or export them as TF_VAR_* instead of putting them in the file).
   ```

   Alternatively, keep every credential in the git-ignored
   `secrets.env` (template: `secrets.env.example`, the same file Phase 4
   syncs to GitHub Actions) and export the Terraform mapping from it:

   ```sh
   set -a; source secrets.env; set +a
   export TF_VAR_cloudflare_api_token="$CLOUDFLARE_API_TOKEN" \
          TF_VAR_cloudflare_account_id="$CLOUDFLARE_ACCOUNT_ID" \
          TF_VAR_cloudflare_zone_id="$CLOUDFLARE_ZONE_ID" \
          TF_VAR_worker_database_url="$WORKER_DATABASE_URL" \
          TF_VAR_worker_r2_access_key_id="$WORKER_R2_ACCESS_KEY_ID" \
          TF_VAR_worker_r2_secret_access_key="$WORKER_R2_SECRET_ACCESS_KEY"
   ```

   Run this from `infra/`. The AWS deployer keys (`AWS_ACCESS_KEY_ID` /
   `AWS_SECRET_ACCESS_KEY`) are not Terraform inputs — the provider reads
   them from the sourced environment directly (or via a dedicated
   `AWS_PROFILE`; every `aws` CLI call in this runbook should use the same
   identity as Terraform to avoid confusing mixed-identity state).

   **If the R2 bucket already exists** (e.g. you created it by hand first so
   the R2 API token could be scoped to it — the Phase 1 token flow makes this
   the common case), import it before the first apply or Terraform's
   `cloudflare_r2_bucket.media` create collides with the existing name:

   ```sh
   # Verify the token first: an invalid token fails the import read with
   # a bare "failed to make http request", not a helpful 403.
   curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
     https://api.cloudflare.com/client/v4/user/tokens/verify
   # → expect {"success":true,...}. If it says "Invalid API Token", re-mint
   # (Phase 1) — a permission gap returns a structured 403, not this.

   terraform import 'cloudflare_r2_bucket.media' \
     '<account_id>/infinite-worship-media/default'
   # Import ID format is <account_id>/<bucket_name>/<jurisdiction> (provider
   # v5); a bare bucket name errors with "invalid ID".
   ```

3. Init, validate, build + push a bootstrap image, apply:

   ```sh
   terraform init
   # `worker_image_uri` is a required root var (infra/worker.tf) with no
   # default and is absent from terraform.ci.tfvars; Terraform validates all
   # root variables before graph/target pruning, so pass a placeholder — the
   # Lambda is outside the -target scope, so the value is unused.
   terraform apply -target=aws_ecr_repository.worker \
     -var-file=terraform.ci.tfvars \
     -var "worker_image_uri=pending"
   terraform validate
   # Build for linux/amd64 explicitly: worker.tf pins architectures =
   # ["x86_64"] (the static ffmpeg build is amd64-only), and a native arm64
   # host would otherwise push an arm64 image Lambda can't use.
   docker build --platform linux/amd64 \
     -t "$(aws sts get-caller-identity --query Account --output text).dkr.ecr.us-west-2.amazonaws.com/infinite-worship-worker:bootstrap" ../worker/
   aws ecr get-login-password --region us-west-2 | docker login --username AWS --password-stdin "$(aws sts get-caller-identity --query Account --output text).dkr.ecr.us-west-2.amazonaws.com"
   docker push "$(aws sts get-caller-identity --query Account --output text).dkr.ecr.us-west-2.amazonaws.com/infinite-worship-worker:bootstrap"
   terraform apply -var-file=terraform.ci.tfvars \
     -var "worker_image_uri=$(aws sts get-caller-identity --query Account --output text).dkr.ecr.us-west-2.amazonaws.com/infinite-worship-worker:bootstrap"
   ```

   The ECR repository is Terraform-managed
   (`aws_ecr_repository.worker`), so a targeted apply must create it
   before the bootstrap `docker push`; the full apply then adopts the
   already-pushed image.

   Note: `terraform plan` and the targeted apply both stop at provider
   configuration without a valid `cloudflare_api_token`; Terraform
   initializes every provider in the config even under `-target`.
   Two distinct causes, checked in this order:
   1. No token reaching the provider at all — the charset error
      ("API tokens must only contain characters a-z, A-Z, 0-9,
      hyphens and underscores") also fires when `var.cloudflare_api_token`
      is unset/empty. Export `TF_VAR_cloudflare_api_token`.
   2. A placeholder winning precedence: auto-loaded `terraform.tfvars`
      (or any `-var-file`) ranks ABOVE `TF_VAR_*` env vars, so a
      placeholder credential in a tfvars file silently overrides the
      exported real one. Credential placeholders must not remain in
      any tfvars file (see Troubleshooting).
   `terraform validate` does NOT need the token and always passes —
   which is why validate moved after the targeted apply.

   ECR login/build/push is CLI-only — the AWS console cannot push container
   images. The targeted apply creates the repository before the push;
   creating it in the console instead would diverge state and cause an
   "already exists" conflict on the full apply — do not.

4. Record the outputs for later phases:

   ```sh
   terraform output -raw analysis_queue_url     # → Vercel SQS_QUEUE_URL
   terraform output -raw analysis_queue_arn     # → finalize IAM user policy
   terraform output -raw media_base_url         # → Vercel R2_PUBLIC_BASE
   ```

## Phase 4 — GitHub secrets

**Console:** repo → Settings → Secrets and variables → Actions →
**New repository secret** — one per name below.

**CLI:** set all 8 secrets (names match the header
comment in `.github/workflows/deploy.yml`; a human with admin must create
them — the workflow fails loudly if one is missing).

From `infra/`, the one-shot path — sync all 8 at once from the
`secrets.env` file (template: `secrets.env.example`, the same file Phase 3
sources for Terraform):

```sh
gh secret set -f secrets.env -R mhuang74/infinite-worship   # all 8 at once
gh secret list -R mhuang74/infinite-worship                 # verify names
```

One caveat:

- GitHub secrets are write-only — `secrets.env` is the only recoverable
  copy; keep it backed up outside the repo.

Or set each secret interactively (paste the value at each prompt):

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
   `<account>.dkr.ecr.us-west-2.amazonaws.com/infinite-worship-worker:<git-sha>`.
3. **Update Lambda code** — `aws lambda update-function-code --image-uri`,
   `aws lambda wait function-updated`, then a final `terraform apply` with
   `-var worker_image_uri=<pushed URI>` so state pins the new tag.

The frontend is **not** deployed here — Vercel's git integration owns it.

## Phase 6 — Vercel (frontend + BFF)

**Console (dashboard import):**

1. [vercel.com/dashboard](https://vercel.com/dashboard) → **Add New… → Project**.
2. Import `mhuang74/infinite-worship` (grant the Vercel GitHub App access if asked).
3. **Configure Project**: Framework Preset `Next.js` (auto-detected);
   **Root Directory** `application/frontend` (expand and enable the
   override); leave build/install commands default (npm; lockfile is
   `package-lock.json`).
4. Add the environment variables from the table below (Production + Preview).

**CLI:**

```sh
# One-time: install the Vercel CLI and log in
npm i -g vercel
vercel login

npx vercel                      # links the repo; follow the prompts to import
                                # mhuang74/infinite-worship and set Root
                                # Directory to application/frontend when asked

# One command per variable; --value for non-interactive use, otherwise the
# prompt reads it from stdin. Repeat with "preview" and "production".
vercel env add DATABASE_URL production --value 'postgresql://…'
vercel env add R2_ACCOUNT_ID production --value '<account_id>'
vercel env add R2_BUCKET production --value 'infinite-worship-media'
vercel env add R2_ACCESS_KEY_ID production --value '<r2 token access key>'
vercel env add R2_SECRET_ACCESS_KEY production --value '<r2 token secret>'
vercel env add R2_PUBLIC_BASE production --value 'https://media.yourdomain.com'
vercel env add SQS_QUEUE_URL production --value "$(terraform -chdir=infra output -raw analysis_queue_url)"
vercel env add AWS_REGION production --value 'us-west-2'
vercel env add AWS_ACCESS_KEY_ID production --value '<finalize user access key>'
vercel env add AWS_SECRET_ACCESS_KEY production --value '<finalize user secret key>'
```

`R2_ENDPOINT` is the alternative to `R2_ACCOUNT_ID` — set **one**, not both
(see the table below).

Environment variables (Production + Preview):

| Name | Value |
| --- | --- |
| `DATABASE_URL` | Neon URI from Phase 2 |
| `R2_ENDPOINT` **or** `R2_ACCOUNT_ID` | `https://<account_id>.r2.cloudflarestorage.com`, or just the account id — `src/lib/r2.ts` builds the endpoint from `R2_ACCOUNT_ID` unless `R2_ENDPOINT` is set |
| `R2_BUCKET` | `infinite-worship-media` |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 API token from Phase 1 |
| `R2_PUBLIC_BASE` | `https://media.yourdomain.com` (the `media_domain` custom domain) |
| `SQS_QUEUE_URL` | `terraform output -raw analysis_queue_url` |
| `AWS_REGION` | `us-west-2` |
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
     --queue-url "$(terraform -chdir=infra output -raw analysis_dlq_url)" \
     --attribute-names ApproximateNumberOfMessagesVisible   # expect "0"
   ```

   Console equivalent: SQS console → queue `infinite-worship-analysis-dlq`
   → **Monitor** tab → "Messages available" should read 0.

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
    --source-arn "$(terraform -chdir=infra output -raw analysis_dlq_arn)" \
    --destination-arn "$(terraform -chdir=infra output -raw analysis_queue_arn)"
  ```

  CLI-only: the SQS console has no one-click DLQ redrive to another queue.

  (The message's Song row stays `processing`; a successful redrive marks it
  `ready`.)

### Status debugging

- **Stuck `pending` > 24 h** (crashed tab, dead message): the next weekly
  reaper run deletes the orphaned audio object and marks the Song `failed`.
  To reap immediately instead of waiting:

  ```sh
  aws lambda invoke --function-name infinite-worship-reaper out.json
  ```

  Console equivalent: Lambda console → function `infinite-worship-reaper`
  → **Test** tab → invoke with an empty `{}` payload.
- **`failed` Song**: query the row:

  ```sh
  psql "$NEON_CONNECTION_URI" -c "SELECT song_id, failure_reason FROM songs WHERE status='failed'"
  ```

  Deterministic validation failures (bad content-type, oversize,
  over-duration) are permanent for those bytes; the key is content-addressed,
  so re-uploading identical bytes yields the same Song ID.
- **Shipping worker changes**: merge to `main`. CI rebuilds and repoints the
  Lambda; no manual steps.

## Cutover checklist (remaining irreversible cloud teardown)

In-repo cutover is done (issue #25); these legacy-cloud items remain:

- [ ] Delete the legacy public ECR images (`public.ecr.aws/u4p9h6o7/mhuang74/infinite-worship` — 16 images, irreversible):

  ```sh
  aws ecr-public batch-delete-image --repository-name mhuang74/infinite-worship --image-ids …
  ```
- [ ] Verify the Graviton host (`t4g.medium` docker-compose deployment) is
      decommissioned — no such instance exists in the current AWS account
      inventory; if it still exists it is in another account/region. Do NOT
      touch `sow-render-worker` (different app).

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `terraform apply` fails with `AccessDeniedException: User …infinite-worship-deployer is not authorized to perform: <service>:<Action>` | The attach policy predates the current Phase 1 document (missing actions: `ecr:ListImages`/`ecr:BatchGetImage`/`ecr:GetDownloadUrlForLayer`, `iam:ListAttachedRolePolicies`, `lambda:ListVersionsByFunction`/`lambda:ListTags`, `cloudwatch:DescribeAlarms`, `logs:DescribeLogGroups`, `events:DescribeRule` were all hit live) — OR the policy version was updated seconds ago and IAM hasn't propagated it (1–2 min) | Re-apply the current Phase 1 managed policy with an admin identity (`aws iam create-policy-version … --set-as-default` + attach if not attached), wait 2 min, then rerun; confirm intent with `aws iam simulate-principal-policy` |
| `aws iam put-user-policy` fails `LimitExceeded: Maximum policy size of 2048 bytes exceeded for user <name>` even though the JSON is well under 2048 bytes | IAM's 2048-byte inline-policy limit is the AGGREGATE across all inline policies on the user, measured on URL-encoded JSON (spaces→`%20` inflates ~45%) — this is why the old "split into two inline policies" Phase 1 could never work | Use the Phase 1 customer-managed policy (`create-policy` + `attach-user-policy`, 6144-byte cap); delete leftover inline policies with `aws iam delete-user-policy` |
| `CreateFunction` fails `InvalidParameterValueException: Reserved keys used in this request: AWS_REGION` | `AWS_REGION` in `environment.variables` — a Lambda-reserved key | Remove it from `infra/worker.tf` (both functions); Lambda injects it itself (constraint #1) |
| `CreateFunction`/`PutFunctionConcurrency` fails `Specified ReservedConcurrentExecutions … decreases account's UnreservedConcurrentExecution below its minimum value of [10]` | Account Lambda concurrency quota is 10; any reservation ≥ 1 violates the ≥10-unreserved minimum | Keep `reserved_concurrent_executions` unset on both functions; throttling is enforced by the SQS mapping's `maximum_concurrency = 2` (constraint #5). Raising the quota via Service Quotas re-enables reservations |
| `CreateFunction` fails `Lambda does not have permission to access the ECR image` | Caller-side: the deploying identity lacks `ecr:GetRepositoryPolicy`+`ecr:SetRepositoryPolicy`, so Lambda can't auto-attach the repo policy (first-ever create on a fresh repo; see Phase 1 note) — or execution role lacks ECR pull grants (constraint #2) or the Lambda races the role policy (constraint #3) | Add the three ECR actions to the managed policy (already in Phase 1 doc); both in-repo causes are fixed in `infra/worker.tf` |
| `terraform plan` fails `Error: Cycle: aws_sqs_queue.analysis …` | The queue's visibility timeout references `aws_lambda_function.worker.timeout` while the worker role policy references the queue ARN | Keep the timeout in `locals.worker_timeout_seconds` and read the local from `sqs.tf` (constraint #4) |
| `Error: Error acquiring the state lock` — `S3 PutObject 412 PreconditionFailed` after a crashed/interrupted apply | A stale S3 lockfile object (`infra/terraform.tfstate.tflock`) from a killed run (e.g. an orphaned `terraform-provider-*` process) | `aws s3 rm s3://infinite-worship-tfstate/infra/terraform.tfstate.tflock` (or `terraform force-unlock <LOCK_ID>`); also `pkill -f terraform-provider` if a provider process survived |
| `failed to make http request` on any `cloudflare_r2_*` resource | The `CLOUDFLARE_API_TOKEN` value is rejected by Cloudflare itself — a scope problem returns a structured 403, a bad/revoked/rolled token returns `1000 Invalid API Token` (verify with `curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" https://api.cloudflare.com/client/v4/user/tokens/verify`) | Re-mint the token (Phase 1) and update `secrets.env` AND the GitHub secret `CLOUDFLARE_API_TOKEN`; run `TF_LOG=DEBUG terraform apply` to see the provider's HTTP exchange if in doubt |
| `terraform import cloudflare_r2_bucket.media …` fails `invalid ID` | Provider v5 import ID is `<account_id>/<bucket_name>/<jurisdiction>` — a bare bucket name or API path is rejected | `terraform import 'cloudflare_r2_bucket.media' '<account_id>/<bucket_name>/default'` (done live for the hand-created bucket) |
| Finalize route 502s, logs say "Could not load credentials" | Vercel has no `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` for the finalize IAM user | Set both in Vercel (Phase 6); the SQS default provider chain has nothing else to fall back to |
| Browser upload/blob fetch fails with CORS errors | Origin not in `cors_allowed_origins` | Add the origin (every Vercel domain, incl. previews, + localhost) to `terraform.ci.tfvars` / `terraform.tfvars`, re-apply |
| `terraform plan` stops at "API tokens must only contain…" | A placeholder token is winning precedence: auto-loaded `terraform.tfvars` (or the `-var-file`) overrides `TF_VAR_cloudflare_api_token` env vars — placeholders must not stay in any tfvars file | Remove credential placeholders from `terraform.tfvars` and export `TF_VAR_cloudflare_api_token` (source `secrets.env`); `terraform validate` works without the token |
| Song `failed` with "audio exceeds 10 minute limit" | Expected validation (`MAX_SONG_SECONDS=600`) | Not a bug — trim the audio or raise the ceiling deliberately |
| DLQ alarm fires | Worker crash loop: messages exhausted 3 receives without a recorded failure | Read worker logs + DLQ message, fix, redrive with `start-message-move-task` |
| Player loads but stays silent; console shows blob fetch/CORS error | Custom domain not applied, or the page's origin is missing from CORS | Verify `media_base_url` output + `curl -I` the analysis JSON; fix `cors_allowed_origins` |

### Fix commands

Copy-paste versions of the commands from the table above.

**`AccessDeniedException` after a policy update** — re-apply the current
Phase 1 managed policy with an admin identity, wait 2 min, then rerun:

```sh
aws iam create-policy-version \
  --policy-arn "arn:aws:iam::<account-id>:policy/infinite-worship-deployer" \
  --policy-document file:///tmp/deployer-policy.json \
  --set-as-default
# attach if not attached:
aws iam attach-user-policy --user-name infinite-worship-deployer \
  --policy-arn "arn:aws:iam::<account-id>:policy/infinite-worship-deployer"
# confirm intent (simulation honors pending versions immediately):
aws iam simulate-principal-policy \
  --policy-source-arn <deployer-arn> \
  --action-names <Action>
```

**Inline-policy `LimitExceeded`** — delete leftover inline policies (the
Phase 1 customer-managed policy replaces them):

```sh
aws iam delete-user-policy --user-name <user> --policy-name <policy>
```

**Stale S3 state lock** (`Error acquiring the state lock`, 412
PreconditionFailed):

```sh
aws s3 rm s3://infinite-worship-tfstate/infra/terraform.tfstate.tflock
terraform force-unlock <LOCK_ID>   # alternative to the s3 rm
pkill -f terraform-provider        # only if a provider process survived
```

**Cloudflare token rejected** (`failed to make http request`):

```sh
curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  https://api.cloudflare.com/client/v4/user/tokens/verify
TF_LOG=DEBUG terraform apply       # see the provider's HTTP exchange if in doubt
```

**R2 bucket import `invalid ID`**:

```sh
terraform import 'cloudflare_r2_bucket.media' '<account_id>/<bucket_name>/default'
```
