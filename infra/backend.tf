# Remote state backend — chicken-and-egg bootstrap notice
# ---------------------------------------------------------
#
# This root configuration stores its state in the S3 bucket + DynamoDB lock
# table built by `modules/s3-backend`. That bucket and table cannot be
# created BY this same configuration if this configuration is already trying
# to read/write its state there — the backend has to exist before `terraform
# init` can point at it.
#
# `modules/s3-backend` is therefore deliberately NOT instantiated by this
# root's main.tf. It is a standalone module with its own provider block
# (see infra/modules/s3-backend/main.tf) that is applied ONCE, separately,
# using local state, before this root ever runs against a remote backend:
#
#   cd infra/modules/s3-backend
#   terraform init
#   terraform apply \
#     -var="bucket_name=<project>-terraform-state" \
#     -var="lock_table_name=<project>-terraform-locks" \
#     -var="aws_region=<region>"
#
# Once that bucket and table exist, initialize THIS root against them using
# partial backend configuration (values are intentionally not hardcoded
# below — see the constraint against hardcoded region/account values):
#
#   terraform init \
#     -backend-config="bucket=<project>-terraform-state" \
#     -backend-config="key=gameplatform/terraform.tfstate" \
#     -backend-config="region=<region>" \
#     -backend-config="dynamodb_table=<project>-terraform-locks" \
#     -backend-config="encrypt=true"
#
# For offline validation (`terraform init -backend=false`), this block is
# skipped entirely and no AWS access is needed.

terraform {
  backend "s3" {}
}
