variable "name" {
  description = "Name prefix for ElastiCache resources (e.g. \"gameplatform-development\")."
  type        = string
}

variable "vpc_id" {
  description = "VPC ID to place the Redis security group in."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for the cache subnet group. The replication group is never placed in a public subnet."
  type        = list(string)
}

variable "eks_node_security_group_id" {
  description = <<-EOT
    Security group ID of the EKS worker nodes, the only allowed source for
    port 6379. When null (the default, until modules/eks exists — see
    Task 25), no ingress rule is created at all: Redis is reachable from
    nowhere, which is the safe default until the real node security group
    can be wired in.
  EOT
  type        = string
  default     = null
}

variable "node_type" {
  description = "ElastiCache node type. Prototype-scale default; size up for real load."
  type        = string
  default     = "cache.t4g.micro"
}

variable "engine_version" {
  description = "Redis engine version."
  type        = string
  default     = "7.1"
}

variable "num_cache_clusters" {
  description = "Number of cache nodes in the replication group (1 primary + N-1 replicas). Defaults to 1 (no replica) for prototype cost; automatic failover requires at least 2."
  type        = number
  default     = 1
}
