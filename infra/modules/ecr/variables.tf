variable "services" {
  description = "List of service names to create one ECR repository each for. Repository name equals the service name."
  type        = list(string)
  default     = ["backend-api", "frontend"]
}

variable "image_tag_mutability" {
  description = "Tag mutability for the repositories. Deploy workflows tag images with the commit SHA, so IMMUTABLE is safe and prevents a tag from silently being overwritten."
  type        = string
  default     = "IMMUTABLE"
}

variable "image_retention_count" {
  description = "Number of most-recent images to keep per repository before the lifecycle policy expires older ones."
  type        = number
  default     = 20
}
