# AWS: analysis worker (Lambda + SQS + CloudWatch) lands in later tickets;
# the provider is wired here per ADR-0003 so infra/ is the single Terraform root.
provider "aws" {
  region = var.aws_region
}

# Cloudflare: R2 storage + custom-domain public access (ADR-0001/0002).
# The API token is a NEW token minted for THIS app (infinite-worship) —
# never reuse the stream-of-worship token. Supplied by a human via
# TF_VAR_cloudflare_api_token or an entry in a git-ignored *.tfvars file.
provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
