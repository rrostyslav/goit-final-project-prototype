output "cluster_name" {
  description = "Name of the EKS cluster."
  value       = module.eks.cluster_name
}

output "github_actions_role_arn" {
  description = "ARN of the IAM role GitHub Actions assumes via OIDC to push images to ECR and describe the EKS cluster."
  value       = module.ci_cd.role_arn
}

output "argocd_namespace" {
  description = "Kubernetes namespace Argo CD is installed into."
  value       = module.argo_cd.namespace
}

output "vpc_id" {
  description = "ID of the VPC."
  value       = module.vpc.vpc_id
}

output "public_subnet_ids" {
  description = "IDs of the public subnets."
  value       = module.vpc.public_subnet_ids
}

output "private_subnet_ids" {
  description = "IDs of the private subnets."
  value       = module.vpc.private_subnet_ids
}

output "ecr_repository_urls" {
  description = "Map of service name to ECR repository URL."
  value       = module.ecr.repository_urls
}

output "rds_endpoint" {
  description = "PostgreSQL connection endpoint."
  value       = module.rds.endpoint
}

output "rds_master_user_secret_arn" {
  description = "Secrets Manager ARN holding the generated RDS master password."
  value       = module.rds.master_user_secret_arn
}

output "redis_primary_endpoint" {
  description = "Redis primary endpoint address."
  value       = module.redis.primary_endpoint
}
