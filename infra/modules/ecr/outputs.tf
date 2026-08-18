output "repository_urls" {
  description = "Map of service name to its ECR repository URL, e.g. { \"backend-api\" = \"<account>.dkr.ecr.<region>.amazonaws.com/backend-api\" }."
  value       = { for name, repo in aws_ecr_repository.this : name => repo.repository_url }
}

output "repository_arns" {
  description = "Map of service name to its ECR repository ARN."
  value       = { for name, repo in aws_ecr_repository.this : name => repo.arn }
}
