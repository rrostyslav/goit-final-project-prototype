variable "name" {
  description = "Name prefix for RDS resources (e.g. \"gameplatform-development\")."
  type        = string
}

variable "environment" {
  description = "Deployment environment name. When it is \"production\", skip_final_snapshot is forced to false (a final snapshot is taken on destroy); every other environment skips it for faster teardown."
  type        = string
}

variable "vpc_id" {
  description = "VPC ID to place the RDS security group in."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for the DB subnet group. The instance is never placed in a public subnet."
  type        = list(string)
}

variable "eks_node_security_group_id" {
  description = <<-EOT
    Security group ID of the EKS worker nodes, the only allowed source for
    port 5432. When null (the default, until modules/eks exists — see
    Task 25), no ingress rule is created at all: the database is reachable
    from nowhere, which is the safe default until the real node security
    group can be wired in.
  EOT
  type        = string
  default     = null
}

variable "postgres_version" {
  description = "PostgreSQL engine version."
  type        = string
  default     = "17"
}

variable "instance_class" {
  description = "RDS instance class. Prototype-scale default; size up for real load."
  type        = string
  default     = "db.t4g.micro"
}

variable "allocated_storage" {
  description = "Allocated storage for the database, in GiB."
  type        = number
  default     = 20
}

variable "database_name" {
  description = "Name of the default database created on the instance."
  type        = string
  default     = "gameplatform"
}

variable "master_username" {
  description = "Master username for the database. The password is NOT set here — manage_master_user_password = true delegates it to AWS Secrets Manager."
  type        = string
  default     = "gameplatform"
}

variable "multi_az" {
  description = "Whether to deploy a standby replica in a second AZ. Off by default for prototype cost; turn on for production."
  type        = bool
  default     = false
}

variable "backup_retention_period" {
  description = "Number of days to retain automated backups."
  type        = number
  default     = 1
}
