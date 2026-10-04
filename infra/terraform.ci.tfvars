# Non-secret Terraform inputs used by CI (.github/workflows/deploy.yml
# applies with -var-file=terraform.ci.tfvars). Secret variables
# (cloudflare_api_token, worker_database_url, worker_r2_*) are NOT here —
# they arrive as TF_VAR_* env sourced from GitHub secrets.
# NEVER put stream-of-worship values in this file.

media_domain   = "media.michaelhuang.xyz" # hostname within the TF_VAR_cloudflare_zone_id zone
r2_bucket_name = "infinite-worship-media"

# Local dev, the production custom domain, and the QA preview custom domain:
cors_allowed_origins = [
  "http://localhost:3000",
  "https://infinite-worship.vercel.app",
  "https://infinite-worship.michaelhuang.xyz",
  "https://qa-infinite-worship.michaelhuang.xyz",
]
