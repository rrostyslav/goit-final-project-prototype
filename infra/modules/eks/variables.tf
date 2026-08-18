variable "name" {
  description = "Name prefix for EKS resources (e.g. \"gameplatform-development\")."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs the managed node group's EC2 instances run in. Worker nodes are never placed in a public subnet."
  type        = list(string)
}

variable "public_subnet_ids" {
  description = "Public subnet IDs added to the cluster's VPC config alongside the private ones, so the control plane has ENIs available for the public API endpoint. No worker node is ever placed here."
  type        = list(string)
}

variable "cluster_version" {
  description = "Kubernetes version for the EKS control plane."
  type        = string
  default     = "1.30"
}

variable "cluster_endpoint_public_access" {
  description = "Whether the EKS API server endpoint is reachable from outside the VPC. The private endpoint (in-VPC access) is always enabled regardless of this setting; public access is a prototype convenience for kubectl/local access without a bastion or VPN."
  type        = bool
  default     = true
}

variable "cluster_endpoint_public_access_cidrs" {
  description = "CIDR blocks allowed to reach the public API server endpoint when cluster_endpoint_public_access is true. Defaults to unrestricted (0.0.0.0/0) for prototype convenience — this is NOT a production-appropriate setting; narrow it to an office/VPN/CI-runner range before running this beyond a prototype."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "node_instance_types" {
  description = "EC2 instance types for the managed node group. Prototype-scale default; size up for real load."
  type        = list(string)
  default     = ["t3.medium"]
}

variable "node_capacity_type" {
  description = "Node group capacity type: ON_DEMAND or SPOT. SPOT is cheaper but nodes can be reclaimed with roughly 2 minutes' notice — acceptable for stateless API/frontend pods behind the HPA, riskier for the LiveKit SFU's active media sessions (Task 26)."
  type        = string
  default     = "ON_DEMAND"
}

variable "node_disk_size" {
  description = "Root EBS volume size (GiB) for each worker node."
  type        = number
  default     = 20
}

variable "node_desired_size" {
  description = "Desired number of worker nodes."
  type        = number
  default     = 2
}

variable "node_min_size" {
  description = "Minimum number of worker nodes."
  type        = number
  default     = 1
}

variable "node_max_size" {
  description = "Maximum number of worker nodes the node group can scale to."
  type        = number
  default     = 4
}

variable "metrics_server_chart_version" {
  description = "Helm chart version for metrics-server (kubernetes-sigs/metrics-server), installed so the backend API's HorizontalPodAutoscaler (spec 2.5, charts/backend-api in Task 26) has CPU/memory metrics to scale on."
  type        = string
  default     = "3.12.2"
}
