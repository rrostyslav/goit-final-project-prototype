output "primary_endpoint" {
  description = "Primary endpoint address (host) for the Redis replication group."
  value       = aws_elasticache_replication_group.this.primary_endpoint_address
}

output "port" {
  description = "Port Redis listens on."
  value       = aws_elasticache_replication_group.this.port
}

output "security_group_id" {
  description = "ID of the security group attached to the replication group."
  value       = aws_security_group.this.id
}
