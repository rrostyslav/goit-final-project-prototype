# Root module: wires the network, registries, data stores, cluster, CI/CD
# identity, GitOps and monitoring together.
#
# modules/s3-backend is deliberately NOT instantiated here — see
# infra/backend.tf for why.

locals {
  name_prefix = "${var.project}-${var.environment}"
}

module "vpc" {
  source = "./modules/vpc"

  name     = local.name_prefix
  vpc_cidr = var.vpc_cidr
}

module "ecr" {
  source = "./modules/ecr"
}

module "eks" {
  source = "./modules/eks"

  name = local.name_prefix

  private_subnet_ids = module.vpc.private_subnet_ids
  public_subnet_ids  = module.vpc.public_subnet_ids

  cluster_version     = var.cluster_version
  node_instance_types = var.eks_node_instance_types

  cluster_endpoint_public_access_cidrs = var.eks_cluster_endpoint_public_access_cidrs
}

module "rds" {
  source = "./modules/rds"

  name        = local.name_prefix
  environment = var.environment

  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  instance_class     = var.db_instance_class

  # Task 24 carry-over resolved: modules/rds creates its ingress rule (and
  # only that rule) once this is non-null. It now always is, since
  # module.eks always exists here — see modules/eks's node_security_group_id
  # output description for exactly which security group this is.
  eks_node_security_group_id = module.eks.node_security_group_id
}

module "redis" {
  source = "./modules/redis"

  name = local.name_prefix

  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  node_type          = var.redis_node_type

  # Same Task 24 carry-over resolution as module.rds above.
  eks_node_security_group_id = module.eks.node_security_group_id
}

module "ci_cd" {
  source = "./modules/ci-cd"

  name = local.name_prefix

  github_repository   = var.github_repository
  github_branch       = var.github_branch
  ecr_repository_arns = values(module.ecr.repository_arns)
  eks_cluster_arn     = module.eks.cluster_arn
}

module "argo_cd" {
  source = "./modules/argo_cd"

  gitops_repo_url = var.gitops_repo_url
  gitops_branch   = var.gitops_branch

  # Explicit dependency, on top of the implicit one already created by the
  # helm/kubernetes provider configurations (providers.tf) referencing
  # module.eks's outputs. Spelled out here for a human reader tracing apply
  # order, not because Terraform needs the hint.
  depends_on = [module.eks]
}

module "monitoring" {
  source = "./modules/monitoring"

  depends_on = [module.eks]
}
