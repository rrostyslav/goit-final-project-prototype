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
  description = "Kubernetes version for the EKS cluster."
  type        = string
  default     = "1.30"
}

variable "eks_node_instance_types" {
  description = "EC2 instance types for the EKS managed node group. Prototype-scale default; size up for real load."
  type        = list(string)
  default     = ["t3.medium"]
}

# Final-review finding G: this root module never passed a value through to
# modules/eks's own cluster_endpoint_public_access_cidrs variable, so the
# README's claim that it is a tunable knob was not actually true at the
# root -- the only way to change it was editing modules/eks directly. This
# variable closes that gap: it exists purely to be forwarded to module.eks
# below (see main.tf), with the exact same insecure-by-default value the
# module itself already defaulted to, so behaviour is unchanged until an
# operator actually sets it.
variable "eks_cluster_endpoint_public_access_cidrs" {
  description = "CIDR blocks allowed to reach the public EKS API server endpoint. Defaults to unrestricted (0.0.0.0/0) for prototype convenience -- narrow this to an office/VPN/CI-runner range before running this beyond a prototype."
  type        = list(string)
  default     = ["0.0.0.0/0"]
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
  description = "GitHub repository in \"owner/repo\" form, used to scope the GitHub Actions OIDC trust policy."
  type        = string
  default     = ""
}

variable "github_branch" {
  description = "Branch GitHub Actions deploy workflows push from. Scopes modules/ci-cd's OIDC trust policy to exactly this ref — see that module's github_branch variable description for why it isn't the broader \"any branch/PR\" wildcard."
  type        = string
  default     = "main"
}

variable "gitops_repo_url" {
  description = "Git URL of the GitOps repository (this repository) Argo CD's root Application tracks."
  type        = string
  default     = ""
}

variable "gitops_branch" {
  description = "Branch Argo CD's root Application syncs from."
  type        = string
  default     = "main"
}
