# Remote state (S3 backend with S3-native lockfile locking) is REQUIRED for
# the CI pipeline (ADR-0004): every GH Actions run is a fresh runner, so
# local state would re-create resources and lose the Lambda's image on every
# push. The bootstrap step in infra/README.md ("Phase 3") creates the state
# bucket once from a laptop with the AWS profile.
terraform {
  backend "s3" {
    bucket       = "infinite-worship-tfstate"
    key          = "infra/terraform.tfstate"
    region       = "us-west-2"
    use_lockfile = true
    encrypt      = true
  }
}
