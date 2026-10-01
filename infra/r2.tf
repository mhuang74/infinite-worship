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
# orphaned audio at its final key with a `pending` Song row (ADR-0002); this
# rule collects it. Presigned uploads PUT to `pending/<song_id>`; the finalize
# BFF step (POST /api/songs/{id}/finalize) copies the object to its public
# `media/` key — anything still under pending/ after pending_upload_expiry_days
# was never finalized and expires.
# Expiry is 7 days: generous headroom for an interrupted upload while bounding
# orphan storage at ~7 days of failed uploads.
# -----------------------------------------------------------------------------
resource "cloudflare_r2_bucket_lifecycle" "media_lifecycle" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.media.name

  rules = [{
    id      = "expire-never-finalized-uploads"
    enabled = true
    conditions = {
      prefix = "pending/"
    }
    delete_objects_transition = {
      # Days an orphaned (never-finalized) upload survives. See infra/README.md.
      type    = "age"
      max_age = var.pending_upload_expiry_days
    }
  }]
}
