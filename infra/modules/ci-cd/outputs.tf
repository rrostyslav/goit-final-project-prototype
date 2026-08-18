output "role_arn" {
  description = "ARN of the IAM role GitHub Actions assumes via OIDC to push images to ECR and describe the EKS cluster. No IAM user or long-lived access key exists anywhere in this module."
  value       = aws_iam_role.github_actions.arn
}
