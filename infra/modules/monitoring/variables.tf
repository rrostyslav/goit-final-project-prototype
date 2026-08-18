variable "namespace" {
  description = "Kubernetes namespace kube-prometheus-stack is installed into."
  type        = string
  default     = "monitoring"
}

variable "chart_version" {
  description = "Helm chart version for kube-prometheus-stack (prometheus-community/helm-charts)."
  type        = string
  default     = "65.5.1"
}

variable "retention" {
  description = "How long Prometheus retains metrics before expiring them."
  type        = string
  default     = "15d"
}

variable "storage_class_name" {
  description = "StorageClass for the Prometheus/Alertmanager/Grafana PersistentVolumeClaims. Null uses the cluster's default StorageClass (the gp2 class EKS provisions automatically)."
  type        = string
  default     = null
}

variable "prometheus_storage_size" {
  description = "Size of the PersistentVolumeClaim for Prometheus's TSDB. This and every other PVC in this module bill continuously once provisioned, even when the cluster is idle — see infra/README.md's cost warning."
  type        = string
  default     = "20Gi"
}

variable "alertmanager_storage_size" {
  description = "Size of the PersistentVolumeClaim for Alertmanager's notification log."
  type        = string
  default     = "2Gi"
}

variable "grafana_storage_size" {
  description = "Size of the PersistentVolumeClaim for Grafana's dashboard/settings database."
  type        = string
  default     = "5Gi"
}
