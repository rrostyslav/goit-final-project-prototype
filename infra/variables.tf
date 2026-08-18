# Root input variables. Every value that could otherwise be hardcoded
# (account ids, ARNs, CIDRs, region strings) must flow through here or
# through a module's own variables.tf — never sit as a literal in a
# resource block.

variable "project" {
  description = "Short project name used as a prefix for resource names and the default_tags Project value."
  type        = string
  default     = "gameplatform"
}

variable "environment" {
  description = "Deployment environment name (e.g. development, staging, production). Drives cost/safety switches like RDS skip_final_snapshot."
  type        = string
}

variable "aws_region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "eu-central-1"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC. Public and private subnets are carved out of this range."
  type        = string
  default     = "10.0.0.0/16"
}

variable "cluster_version" {
  description = "Kubernetes version for the EKS cluster (consumed by modules/eks in Task 25; declared here so the root variable surface is stable across tasks)."
  type        = string
  default     = "1.30"
}

variable "db_instance_class" {
  description = "RDS instance class for the PostgreSQL database. Prototype-scale default; size up for real load."
  type        = string
  default     = "db.t4g.micro"
}

variable "redis_node_type" {
  description = "ElastiCache node type for the Redis replication group. Prototype-scale default; size up for real load."
  type        = string
  default     = "cache.t4g.micro"
}

variable "github_repository" {
  description = "GitHub repository in \"owner/repo\" form, used to scope the GitHub Actions OIDC trust policy (consumed by modules/ci-cd in Task 25)."
  type        = string
  default     = ""
}

variable "eks_node_security_group_id" {
  description = <<-EOT
    Security group ID of the EKS worker nodes. modules/rds and modules/redis
    use this to scope their ingress rules to traffic from the cluster only.

    modules/eks does not exist yet (it lands in Task 25 and will output
    node_security_group_id). Until then this stays null, and the RDS/Redis
    security groups are created with NO ingress rule at all — a safe,
    fail-closed placeholder. Task 25 must wire this root variable (or the
    eks module's output directly) into modules/rds and modules/redis so the
    ingress rule is actually created.
  EOT
  type        = string
  default     = null
}
