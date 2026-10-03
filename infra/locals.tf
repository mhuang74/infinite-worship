# Shared resource tags (infinite-worship — never stream-of-worship).
locals {
  # The analysis Lambda's timeout (s). Kept as a local so sqs.tf can size the
  # queue's visibility timeout without referencing aws_lambda_function.worker
  # (that reference plus the queue-ARN reference inside the worker role policy
  # forms a dependency cycle).
  worker_timeout_seconds = 840

  tags = {
    project = "infinite-worship"
    managed = "terraform"
  }
}
