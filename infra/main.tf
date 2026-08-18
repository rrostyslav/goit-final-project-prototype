# Root module: wires the network, registries and data stores together.
#
# modules/s3-backend is deliberately NOT instantiated here — see
# infra/backend.tf for why. modules/eks, modules/ci-cd, modules/argo_cd and
# modules/monitoring land in Task 25 and will extend this file.

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

module "rds" {
  source = "./modules/rds"

  name        = local.name_prefix
  environment = var.environment

  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  instance_class     = var.db_instance_class

  # Not wired to a real security group until modules/eks (Task 25) exists —
  # see the variable description in variables.tf.
  eks_node_security_group_id = var.eks_node_security_group_id
}

module "redis" {
  source = "./modules/redis"

  name = local.name_prefix

  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  node_type          = var.redis_node_type

  # Not wired to a real security group until modules/eks (Task 25) exists —
  # see the variable description in variables.tf.
  eks_node_security_group_id = var.eks_node_security_group_id
}
