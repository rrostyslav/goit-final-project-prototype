variable "name" {
  description = "Name prefix for VPC resources (e.g. \"gameplatform-development\")."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC. 3 public and 3 private subnets are carved out of this range with cidrsubnet(), so it must be at least a /21 to leave room for 6 /25-or-larger subnets."
  type        = string
}

variable "subnet_count" {
  description = "Number of public and private subnets to create (one of each per availability zone)."
  type        = number
  default     = 3
}
