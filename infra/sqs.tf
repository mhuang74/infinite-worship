# -----------------------------------------------------------------------------
# Analysis queue (ADR-0002): the BFF finalize step enqueues; the worker Lambda
# (worker.tf) consumes. Failed messages redrive to a DLQ after maxReceiveCount
# attempts; a CloudWatch alarm fires when the DLQ holds anything (ADR-0004 —
# failed Songs are visible in the UI via status, but a message that dies
# without the Worker recording a failure means the pipeline is broken).
# -----------------------------------------------------------------------------
data "aws_caller_identity" "current" {}

resource "aws_sqs_queue" "analysis_dlq" {
  name = "${var.resource_prefix}-analysis-dlq"

  # Failed messages are kept long enough to be inspected and redriven by hand.
  message_retention_seconds = 14 * 24 * 60 * 60 # 14 days (SQS maximum)

  tags = local.tags
}

resource "aws_sqs_queue" "analysis" {
  name = "${var.resource_prefix}-analysis"

  # Analysis takes minutes (ADR-0001); the visibility timeout must exceed the
  # worker Lambda timeout (local.worker_timeout_seconds in locals.tf) so a slow
  # invocation is never handed to another consumer while still running.
  visibility_timeout_seconds = local.worker_timeout_seconds + 60

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.analysis_dlq.arn
    maxReceiveCount     = 3
  })

  tags = local.tags
}

# Alarm (ADR-0004): anything in the DLQ means a Song repeatedly failed inside
# the Worker beyond redrive — someone should look.
resource "aws_cloudwatch_metric_alarm" "analysis_dlq_not_empty" {
  alarm_name          = "${var.resource_prefix}-analysis-dlq-not-empty"
  alarm_description   = "Messages landed in the analysis DLQ: a Song failed analysis beyond SQS redrive. Inspect the DLQ and the worker Lambda logs."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.analysis_dlq.name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  tags = local.tags
}

output "analysis_queue_url" {
  description = "URL of the analysis queue (BFF finalize step enqueues here — set as SQS_QUEUE_URL in Vercel)."
  value       = aws_sqs_queue.analysis.url
}

output "analysis_queue_arn" {
  description = "ARN of the analysis queue."
  value       = aws_sqs_queue.analysis.arn
}

output "analysis_dlq_url" {
  description = "URL of the analysis dead-letter queue."
  value       = aws_sqs_queue.analysis_dlq.url
}

output "analysis_dlq_arn" {
  description = "ARN of the analysis dead-letter queue."
  value       = aws_sqs_queue.analysis_dlq.arn
}
