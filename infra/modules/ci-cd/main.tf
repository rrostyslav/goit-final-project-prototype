# modules/ci-cd
# --------------
# GitHub Actions OIDC identity provider + a single IAM role that CI assumes
# to push images to ECR and describe the EKS cluster. No IAM user and no
# access key/secret pair is created anywhere in this module — GitHub Actions
# authenticates with a short-lived token exchanged via
# sts:AssumeRoleWithWebIdentity, scoped by the conditions below.

terraform {
  required_providers {
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }
}

# ---------------------------------------------------------------------------
# OIDC identity provider
# ---------------------------------------------------------------------------
# token.actions.githubusercontent.com is GitHub's own fixed, public OIDC
# issuer hostname — the same for every GitHub Actions user on the planet,
# not a project-specific value. The thumbprint is fetched from the issuer's
# own TLS certificate rather than hardcoded, matching AWS's current
# guidance and modules/eks's pattern for the cluster's own OIDC provider.

data "tls_certificate" "github" {
  url = "https://token.actions.githubusercontent.com/.well-known/openid-configuration"
}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github.certificates[0].sha1_fingerprint]
}

# ---------------------------------------------------------------------------
# IAM role GitHub Actions assumes
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # See the github_branch variable description for why this is scoped to
    # a single ref rather than "repo:<repo>:*".
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:ref:refs/heads/${var.github_branch}"]
    }
  }
}

resource "aws_iam_role" "github_actions" {
  name               = "${var.name}-github-actions"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

# ---------------------------------------------------------------------------
# Permissions: ECR push + eks:DescribeCluster, nothing else
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "deploy" {
  # ecr:GetAuthorizationToken has no resource-level permissions in AWS's
  # IAM model — it must be "*". Every other statement below is scoped to
  # specific ARNs passed in from modules/ecr and modules/eks.
  statement {
    sid       = "EcrAuth"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid    = "EcrPush"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
    ]
    resources = var.ecr_repository_arns
  }

  statement {
    sid       = "EksDescribe"
    effect    = "Allow"
    actions   = ["eks:DescribeCluster"]
    resources = [var.eks_cluster_arn]
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "${var.name}-github-actions-deploy"
  role   = aws_iam_role.github_actions.id
  policy = data.aws_iam_policy_document.deploy.json
}
