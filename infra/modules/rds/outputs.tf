output "endpoint" {
  description = "Connection endpoint (host:port) for the database."
  value       = aws_db_instance.this.endpoint
}

output "master_user_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the generated master password."
  value       = try(aws_db_instance.this.master_user_secret[0].secret_arn, null)
}

output "security_group_id" {
  description = "ID of the security group attached to the database."
  value       = aws_security_group.this.id
}
