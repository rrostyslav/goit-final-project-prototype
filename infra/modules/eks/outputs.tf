output "cluster_name" {
  description = "Name of the EKS cluster."
  value       = aws_eks_cluster.this.name
}

output "cluster_arn" {
  description = "ARN of the EKS cluster. Used to scope modules/ci-cd's eks:DescribeCluster permission to this cluster only."
  value       = aws_eks_cluster.this.arn
}

output "cluster_endpoint" {
  description = "API server endpoint of the EKS cluster."
  value       = aws_eks_cluster.this.endpoint
}

output "cluster_certificate_authority_data" {
  description = "Base64-encoded certificate authority data for the cluster. Used to configure the kubernetes/helm providers in root providers.tf."
  value       = aws_eks_cluster.this.certificate_authority[0].data
}

output "oidc_provider_arn" {
  description = "ARN of the IAM OIDC identity provider backing IRSA for this cluster."
  value       = aws_iam_openid_connect_provider.cluster.arn
}

output "oidc_provider_url" {
  description = "Issuer URL of the cluster's OIDC provider, for building further IRSA trust policies (e.g. the backend API's ServiceAccount in Task 26)."
  value       = aws_iam_openid_connect_provider.cluster.url
}

output "node_security_group_id" {
  description = <<-EOT
    ID of the EKS-managed cluster security group. EKS creates this
    automatically and, for a managed node group with no custom launch
    template overriding security groups (this module's case), attaches it
    to every worker node's ENI alongside the control plane's — so it is the
    correct "traffic from the cluster's nodes" source for security group
    rules elsewhere. modules/rds and modules/redis use this to scope their
    ingress rules; see root main.tf.
  EOT
  value       = aws_eks_cluster.this.vpc_config[0].cluster_security_group_id
}
