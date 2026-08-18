variable "name" {
  description = "Name prefix for ci-cd IAM resources (e.g. \"gameplatform-development\")."
  type        = string
}

variable "github_repository" {
  description = "GitHub repository in \"owner/repo\" form. Scopes the OIDC trust policy so only workflows running in this repository can even attempt to assume the role."
  type        = string
}

variable "github_branch" {
  description = <<-EOT
    Branch GitHub Actions deploy workflows push from. The trust policy's
    `sub` condition is scoped to exactly
    `repo:<github_repository>:ref:refs/heads/<this>` — deliberately NOT the
    broader `repo:<github_repository>:*`, which would also match every
    other branch, every same-repo pull request, and every other event type
    (workflow_dispatch, schedule, ...) in the repository. Task 27's
    backend-deploy.yml/frontend-deploy.yml are the only workflows that ever
    assume this role, and both trigger solely on push to this branch, so
    the tighter scope costs nothing while meaningfully shrinking the blast
    radius of a compromised workflow file or a malicious same-repo branch
    push. (Forked-repo pull requests never get this token at all — GitHub
    withholds OIDC tokens scoped to the base repository from fork PR runs
    regardless of this policy — but branches pushed directly to this
    repository would match a `:*` wildcard, which is the hole this closes.)
  EOT
  type        = string
  default     = "main"
}

variable "ecr_repository_arns" {
  description = "ECR repository ARNs the role is allowed to push images to (from modules/ecr's repository_arns output)."
  type        = list(string)
}

variable "eks_cluster_arn" {
  description = "ARN of the EKS cluster the role is allowed to describe (from modules/eks's cluster_arn output). Scoping eks:DescribeCluster to this ARN instead of \"*\" keeps the policy to exactly what CI needs (aws eks update-kubeconfig) and nothing else."
  type        = string
}
