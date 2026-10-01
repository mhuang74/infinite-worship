# Remote state (S3 + DynamoDB lock) is REQUIRED for the CI pipeline
# (ADR-0004): every GH Actions run is a fresh runner, so local state would
# re-create resources and lose the Lambda's image on every push. The
# bootstrap step in infra/README.md ("First run") creates the bucket and
# lock table once from a laptop with the AWS profile.
terraform {
  backend "s3" {
    bucket         = "infinite-worship-tfstate"
    key            = "infra/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "infinite-worship-tflock"
    encrypt        = true
  }
}
