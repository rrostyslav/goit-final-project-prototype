# modules/rds
# ------------
# Single PostgreSQL 17 instance in the private subnets. The master password
# is never set here: manage_master_user_password = true tells AWS to
# generate it and store it in Secrets Manager, so it never appears in
# Terraform state or configuration.

resource "aws_db_subnet_group" "this" {
  name       = "${var.name}-postgres"
  subnet_ids = var.private_subnet_ids

  tags = {
    Name = "${var.name}-postgres"
  }
}

resource "aws_security_group" "this" {
  name        = "${var.name}-postgres"
  description = "Allow PostgreSQL access from the EKS node security group only"
  vpc_id      = var.vpc_id

  # No egress rule, deliberately. A managed database and cache never
  # originate connections; AWS treats a security group with no egress rule
  # as deny-all outbound, which is what we want. Terraform would otherwise
  # leave the default allow-all rule in place.

  tags = {
    Name = "${var.name}-postgres"
  }
}

# Created only once the EKS node security group is known (see the
# eks_node_security_group_id description). Until then the database has no
# ingress rule at all.
resource "aws_security_group_rule" "postgres_from_eks_nodes" {
  count = var.eks_node_security_group_id == null ? 0 : 1

  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = aws_security_group.this.id
  source_security_group_id = var.eks_node_security_group_id
  description              = "PostgreSQL from EKS worker nodes"
}

resource "aws_db_instance" "this" {
  identifier     = "${var.name}-postgres"
  engine         = "postgres"
  engine_version = var.postgres_version

  instance_class    = var.instance_class
  allocated_storage = var.allocated_storage
  storage_encrypted = true

  db_name  = var.database_name
  username = var.master_username

  # Delegates password generation + rotation to AWS Secrets Manager. No
  # `password` argument is set anywhere in this module.
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.this.id]
  publicly_accessible    = false

  multi_az                = var.multi_az
  backup_retention_period = var.backup_retention_period

  # Production keeps a final snapshot on destroy; every other environment
  # skips it so teardown during development isn't blocked.
  skip_final_snapshot = var.environment != "production"
  deletion_protection = var.environment == "production"
}
