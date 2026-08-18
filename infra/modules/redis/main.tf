# modules/redis
# --------------
# ElastiCache Redis replication group in the private subnets, reachable
# only from inside the cluster, with in-transit encryption on.

resource "aws_elasticache_subnet_group" "this" {
  name       = "${var.name}-redis"
  subnet_ids = var.private_subnet_ids
}

resource "aws_security_group" "this" {
  name        = "${var.name}-redis"
  description = "Allow Redis access from the EKS node security group only"
  vpc_id      = var.vpc_id

  # No egress rule, deliberately. A managed database and cache never
  # originate connections; AWS treats a security group with no egress rule
  # as deny-all outbound, which is what we want. Terraform would otherwise
  # leave the default allow-all rule in place.

  tags = {
    Name = "${var.name}-redis"
  }
}

# Created only once the EKS node security group is known (see the
# eks_node_security_group_id description). Until then Redis has no ingress
# rule at all.
resource "aws_security_group_rule" "redis_from_eks_nodes" {
  count = var.eks_node_security_group_id == null ? 0 : 1

  type                     = "ingress"
  from_port                = 6379
  to_port                  = 6379
  protocol                 = "tcp"
  security_group_id        = aws_security_group.this.id
  source_security_group_id = var.eks_node_security_group_id
  description              = "Redis from EKS worker nodes"
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id = "${var.name}-redis"
  description          = "Redis for ${var.name}"

  engine         = "redis"
  engine_version = var.engine_version
  node_type      = var.node_type
  port           = 6379

  num_cache_clusters = var.num_cache_clusters
  # Automatic failover needs at least one replica; only enable it when the
  # caller actually asked for more than a single node.
  automatic_failover_enabled = var.num_cache_clusters > 1

  subnet_group_name  = aws_elasticache_subnet_group.this.name
  security_group_ids = [aws_security_group.this.id]

  transit_encryption_enabled = true
  at_rest_encryption_enabled = true
}
