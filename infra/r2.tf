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
# R2 lifecycle rules cannot join against the `songs` table, so a whole-bucket
# age rule would also delete READY (playable) Songs' objects — a user-facing
# retention policy, not orphan cleanup, and rejected as such. Instead the
# Worker exposes a scheduled "reap" entry point (worker/reaper.py, invoked
# weekly by the reaper Lambda in worker.tf): it queries `songs` for rows stuck
# pending beyond the grace window and deletes only THEIR objects. Ready Songs
# are never touched — a Song is immutable and playable indefinitely once
# ready (ADR-0002), so there is intentionally NO time-based expiry on ready
# objects.
# -----------------------------------------------------------------------------
resource "cloudflare_r2_bucket_lifecycle" "media_lifecycle" {
  count = 0 # object-level reaping is done by the scheduled Worker (worker/reaper.py)
  # (kept as a disabled stub so the R2 lifecycle story lives in one file; the
  #  resource below is what a prefix-based rule would look like if reaping by
  #  DB join is ever replaced with a retention policy — a user-facing decision
  #  that must be confirmed first)
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.media.name

  rules = [{
    id      = "expire-stale-objects-NOT-ACTIVE"
    enabled = false
    conditions = {
      prefix = ""
    }
    delete_objects_transition = {
      type    = "age"
      max_age = var.pending_upload_expiry_days
    }
  }]
}
