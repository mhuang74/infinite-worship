output "r2_bucket_name" {
  description = "New public-read R2 bucket for audio + Analysis JSON."
  value       = cloudflare_r2_bucket.media.name
}

output "media_base_url" {
  description = "Custom-domain base URL for fetching audio/Analysis objects (use instead of r2.dev)."
  value       = "https://${var.media_domain}"
}

output "media_custom_domain" {
  description = "R2 custom-domain attachment resource."
  value       = cloudflare_r2_custom_domain.media_custom_domain.domain
}
