# Local state only for now; ADR-0004: Terraform is applied by GitHub Actions,
# which will own remote state configuration. Keep this block out of the way
# until the pipeline ticket decides the backend.
terraform {
  backend "local" {}
}
