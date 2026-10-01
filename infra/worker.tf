# -----------------------------------------------------------------------------
# Analysis Worker Lambda (ADR-0001): container image built from worker/
# (madmom + librosa + static ffmpeg — minutes-long analysis is far beyond any
# HTTP timeout, hence queue-triggered). GitHub Actions builds and pushes the
# image to ECR on merge to main (ADR-0004); the image_uri variable feeds the
# Lambda. Reserved concurrency 2: bounding concurrent analyses protects Neon
# connection limits and R2 throughput while still using one warm worker.
# -----------------------------------------------------------------------------
resource "aws_ecr_repository" "worker" {
  name                 = "${var.resource_prefix}-worker"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = local.tags
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "worker" {
  name               = "${var.resource_prefix}-worker"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json

  tags = local.tags
}

data "aws_iam_policy_document" "worker" {
  statement {
    # R2 speaks the S3 API; the R2 API token credentials are passed as env
    # vars (R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY), so no aws_iam policy can
    # scope them — the token itself must be scoped in Cloudflare. Lambda Logs
    # + queue access are the only AWS-side permissions needed.
    sid = "LambdaBasics"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
    ]
    resources = [
      aws_sqs_queue.analysis.arn,
      # CreateLogGroup is unnecessary: aws_cloudwatch_log_group.worker is
      # managed by Terraform; the role only needs to write streams into it.
      aws_cloudwatch_log_group.worker.arn,
    ]
  }
  statement {
    sid     = "CreateLogGroup"
    actions = ["logs:CreateLogGroup"]
    # CreateLogGroup does not support resource-level permissions.
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "worker" {
  role   = aws_iam_role.worker.id
  name   = "worker-permissions"
  policy = data.aws_iam_policy_document.worker.json
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/aws/lambda/${var.resource_prefix}-worker"
  retention_in_days = 14

  tags = local.tags
}

resource "aws_lambda_function" "worker" {
  function_name = "${var.resource_prefix}-worker"
  role          = aws_iam_role.worker.arn

  # GitHub Actions (ADR-0004) builds worker/Dockerfile, pushes to this repo,
  # and updates the image digest via terraform apply.
  package_type = "Image"
  image_uri    = var.worker_image_uri
  # x86_64: the static ffmpeg build pinned in worker/Dockerfile is amd64-only.
  architectures = ["x86_64"]

  memory_size = 3008 # librosa CQT + madmom RNN are memory-hungry; 3 GB leaves headroom
  timeout     = 840  # 14 min: under the 15-min Lambda cap, above worst-case analysis

  reserved_concurrent_executions = 2

  environment {
    # No SOW_* values here; DATABASE_URL is the NEW Neon project (issue #17).
    variables = {
      DATABASE_URL         = var.worker_database_url
      R2_S3_ENDPOINT       = "https://${var.cloudflare_account_id}.r2.cloudflarestorage.com"
      R2_BUCKET            = var.r2_bucket_name
      R2_ACCESS_KEY_ID     = var.worker_r2_access_key_id
      R2_SECRET_ACCESS_KEY = var.worker_r2_secret_access_key
      MEDIA_BASE_URL       = "https://${var.media_domain}"
      MAX_SONG_SECONDS     = "600"
      AWS_REGION           = var.aws_region
    }
  }

  logging_config {
    log_format = "JSON"
  }

  depends_on = [aws_cloudwatch_log_group.worker]

  tags = local.tags
}

# SQS → Lambda event source mapping (the trigger from infra/sqs.tf).
resource "aws_lambda_event_source_mapping" "worker_from_sqs" {
  event_source_arn        = aws_sqs_queue.analysis.arn
  function_name           = aws_lambda_function.worker.arn
  function_response_types = []
  batch_size              = 1 # one song per invocation: minutes-long analyses shouldn't batch
  scaling_config {
    maximum_concurrency = 2
  }
}

variable "resource_prefix" {
  description = "Prefix for all worker/SQS resource names (new app; never stream-of-worship)."
  type        = string
  default     = "infinite-worship"
}

variable "worker_image_uri" {
  description = "ECR image URI (registry/repository:tag or @digest) for the worker container, built from worker/Dockerfile by CI."
  type        = string
}

variable "worker_database_url" {
  description = "Neon connection string for the NEW infinite-worship project (never SOW_*). Human-supplied via TF_VAR_worker_database_url or git-ignored tfvars."
  type        = string
  sensitive   = true
}

variable "worker_r2_access_key_id" {
  description = "R2 API token access key for the worker (NEW token for this app). Human-supplied."
  type        = string
  sensitive   = true
}

variable "worker_r2_secret_access_key" {
  description = "R2 API token secret for the worker (NEW token for this app). Human-supplied."
  type        = string
  sensitive   = true
}

data "aws_partition" "current" {}

output "worker_function_name" {
  description = "Worker Lambda function name."
  value       = aws_lambda_function.worker.function_name
}

output "worker_ecr_repository_url" {
  description = "ECR repo GitHub Actions pushes the worker image to (ADR-0004)."
  value       = aws_ecr_repository.worker.repository_url
}

# -----------------------------------------------------------------------------
# Scheduled reaper (ADR-0002 "expire never-finalized uploads"): R2 lifecycle
# rules cannot join against the songs table, so orphaned pending uploads are
# reaped by this weekly Lambda instead (worker/reaper.py). It deletes objects
# ONLY for Songs stuck 'pending' past the grace window; ready Songs are never
# touched (no time-based retention — playable indefinitely per ADR-0002).
# Reuses the worker image (reaper.py ships in the same container) with a
# smaller memory/timeout budget; reserved concurrency 1 is plenty for weekly.
# -----------------------------------------------------------------------------
resource "aws_cloudwatch_event_rule" "reaper" {
  name                = "${var.resource_prefix}-reaper"
  schedule_expression = "rate(7 days)"
  tags                = local.tags
}

resource "aws_lambda_function" "reaper" {
  function_name = "${var.resource_prefix}-reaper"
  role          = aws_iam_role.worker.arn
  package_type  = "Image"
  image_uri     = var.worker_image_uri
  architectures = ["x86_64"]

  # Same container as the analysis worker, but enter through reaper.py's
  # handler — without this override the image CMD (handler.lambda_handler)
  # would run on the EventBridge payload and silently do nothing.
  image_config {
    command = ["reaper.lambda_handler"]
  }

  memory_size = 512
  timeout     = 120

  reserved_concurrent_executions = 1

  environment {
    variables = {
      DATABASE_URL         = var.worker_database_url
      R2_S3_ENDPOINT       = "https://${var.cloudflare_account_id}.r2.cloudflarestorage.com"
      R2_BUCKET            = var.r2_bucket_name
      R2_ACCESS_KEY_ID     = var.worker_r2_access_key_id
      R2_SECRET_ACCESS_KEY = var.worker_r2_secret_access_key
      REAP_GRACE_HOURS     = "24"
      AWS_REGION           = var.aws_region
    }
  }

  depends_on = [aws_cloudwatch_log_group.worker]

  tags = local.tags
}

resource "aws_cloudwatch_event_target" "reaper" {
  rule = aws_cloudwatch_event_rule.reaper.name
  arn  = aws_lambda_function.reaper.arn
}

resource "aws_lambda_permission" "reaper" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.reaper.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.reaper.arn
}
