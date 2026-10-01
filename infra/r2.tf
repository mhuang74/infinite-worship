# -----------------------------------------------------------------------------
# Cloudflare R2 bucket for Infinite Worship (NEW bucket; never stream-of-worship)
# Per ADR-0001: single public-read bucket holds both audio and Analysis JSON.
# Per ADR-0002: uploads land directly at their final key (presigned PUT).
# -----------------------------------------------------------------------------
resource "cloudflare_r2_bucket" "media" {
  account_id = var.cloudflare_account_id
  name       = var.r2_bucket_name
  # Omit `location`: defaults to APAC/jurisdiction-hinted. Set "ENAM" etc. to pin.
}

# -----------------------------------------------------------------------------
# Public access via custom domain on a Cloudflare-managed zone (ADR-0002):
# r2.dev is rate-limited and non-production; the custom domain enables
# Cloudflare caching in front of R2.
# -----------------------------------------------------------------------------
resource "cloudflare_r2_custom_domain" "media_custom_domain" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.media.name
  domain      = var.media_domain
  zone_id     = var.cloudflare_zone_id
  enabled     = true
  min_tls     = "1.2"
  # Cache everything at the edge — playback is CDN-read-heavy (ADR-0001).
  # Signed URLs are unnecessary: the bucket is public-read by design; the
  # unguessable content-addressed keys gate discoverability (ADR-0002).
}

# -----------------------------------------------------------------------------
# CORS: the Player fetches audio/Analysis as blobs into the Web Audio API;
# cross-origin reads are blocked without this (ADR-0002).
# -----------------------------------------------------------------------------
resource "cloudflare_r2_bucket_cors" "media_cors" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.media.name

  rules = [{
    id = "allow-player-and-upload-origins"
    allowed = {
      origins         = var.cors_allowed_origins
      methods         = ["GET", "HEAD", "PUT"] # GET/HEAD for Player blob fetches, PUT for presigned uploads
      headers         = ["*"]
      expose_headers  = ["ETag", "Content-Length", "Content-Type"]
      max_age_seconds = 3600
    }
  }]
}

# -----------------------------------------------------------------------------
# Lifecycle: expire objects that never finalize. A crashed browser tab leaves
# orphaned audio at `media/<song_id>` with a `pending` Song row (ADR-0002:
# uploads PUT directly to their FINAL key — there is no pending/-to-media/
# copy step, so a prefix filter on "pending/" would match nothing).
#
# R2 lifecycle rules can't join against the `songs` table, so expiry is by
# object AGE alone: every object in the bucket expires after
# pending_upload_expiry_days. This is sound with content-addressed Song IDs:
# a Song stays playable only while its objects exist, so the retention window
# doubles as the effective library retention. The value must exceed how long
# users reasonably expect to keep playing a Song (default: 90 days) — it is
# NOT a 7-day "orphan sweep", because finalized and orphaned objects are
# indistinguishable to R2.
# -----------------------------------------------------------------------------
resource "cloudflare_r2_bucket_lifecycle" "media_lifecycle" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.media.name

  rules = [{
    id      = "expire-stale-objects"
    enabled = true
    conditions = {
      prefix = "" # whole bucket; R2 cannot distinguish finalized from orphaned
    }
    delete_objects_transition = {
      # Days ANY object (audio or Analysis JSON) survives. See infra/README.md
      # and the ADR-0002 consequence: crashed-tab orphans are collected by the
      # same rule as everything else.
      type    = "age"
      max_age = var.pending_upload_expiry_days
    }
  }]
}
