variable "bucket_name" {
  description = "Globally-unique name for the S3 bucket that holds Terraform remote state."
  type        = string
}

variable "lock_table_name" {
  description = "Name for the DynamoDB table used to lock Terraform state during apply."
  type        = string
}

variable "aws_region" {
  description = "AWS region to create the state bucket and lock table in."
  type        = string
}

variable "project" {
  description = "Project name, applied as the Project tag on the state bucket and lock table."
  type        = string
  default     = "gameplatform"
}
