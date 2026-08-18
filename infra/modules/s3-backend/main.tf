# modules/s3-backend
# -------------------
# Builds the S3 bucket + DynamoDB lock table that the root configuration
# (infra/) uses as its remote state backend (see infra/backend.tf).
#
# This module is applied ONCE, SEPARATELY, before the root config, using
# purely local state. Because there is no parent root to inherit a provider
# configuration from at that point in time, this module deliberately
# declares its own `terraform` and `provider "aws"` blocks instead of
# relying on provider inheritance the way the other modules do. It is
# designed to be run standalone:
#
#   cd infra/modules/s3-backend
#   terraform init
#   terraform apply -var="bucket_name=..." -var="lock_table_name=..." -var="aws_region=..."
#
# It is intentionally NOT referenced by infra/main.tf — see infra/backend.tf
# for the full chicken-and-egg explanation.

terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

resource "aws_s3_bucket" "state" {
  bucket = var.bucket_name

  # State buckets hold the only copy of Terraform state; guard against an
  # accidental `terraform destroy` of this module taking it out too.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket = aws_s3_bucket.state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_dynamodb_table" "lock" {
  name         = var.lock_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}
