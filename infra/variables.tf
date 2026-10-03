variable "aws_region" {
  description = "AWS region for the analysis worker resources (ADR-0001)."
  type        = string
  default     = "us-east-1"
}

variable "cloudflare_api_token" {
  description = <<-EOT
    NEW Cloudflare API token for the infinite-worship app. Must have R2
    (Edit) and Zone (Read) + DNS (Edit) permissions for the target zone.
    This is NOT the stream-of-worship token. Human-supplied: export
    TF_VAR_cloudflare_api_token=... or put it in a git-ignored terraform.tfvars.
  EOT
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID that owns the new R2 bucket."
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID of the domain serving the R2 bucket (custom-domain public access; NOT r2.dev — see ADR-0002)."
  type        = string
}

variable "r2_bucket_name" {
  description = "Name of the NEW public-read R2 bucket for audio + Analysis JSON. Must not be the stream-of-worship bucket."
  type        = string
  default     = "infinite-worship-media"
}

variable "media_domain" {
  description = "Custom domain (hostname) serving the R2 bucket, e.g. media.infiniteworship.app. Must be within the zone above."
  type        = string
}

variable "cors_allowed_origins" {
  description = "Origins allowed to fetch audio/analysis blobs cross-origin (the Player uses the Web Audio API). Include every Vercel origin (prod + previews) plus local dev."
  type        = list(string)
  default = [
    "http://localhost:3000",
    # Add the production Vercel origin(s), e.g. "https://infinite-worship.vercel.app",
    # via a tfvars override or -var once known.
  ]
}

variable "pending_upload_expiry_days" {
  description = <<-EOT
    Whole-bucket object age expiry in days. Currently UNUSED: the lifecycle
    rule in r2.tf is a disabled stub (count = 0) — orphaned-upload cleanup is
    done by the weekly scheduled reaper Lambda (worker/reaper.py), which
    deletes objects only for Songs stuck 'pending' past its grace window. If
    ever enabled, this becomes a user-facing retention policy for ready
    Songs, not orphan cleanup. See infra/README.md.
  EOT
  type        = number
  default     = 90
}
