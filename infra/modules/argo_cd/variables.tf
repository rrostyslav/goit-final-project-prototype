variable "namespace" {
  description = "Kubernetes namespace Argo CD is installed into."
  type        = string
  default     = "argocd"
}

variable "chart_version" {
  description = "Helm chart version for the argo-cd chart (argoproj/argo-helm)."
  type        = string
  default     = "7.7.11"
}

variable "gitops_repo_url" {
  description = "Git URL of the GitOps repository (this repository) the root Application tracks."
  type        = string
}

variable "gitops_branch" {
  description = "Branch (targetRevision) of the GitOps repository the root Application syncs from."
  type        = string
  default     = "main"
}

variable "charts_path" {
  description = "Path within the GitOps repository the root Application watches. Task 26 writes charts/backend-api, charts/frontend and charts/livekit under this path."
  type        = string
  default     = "charts"
}

variable "argocd_project" {
  description = "Argo CD AppProject the root Application belongs to."
  type        = string
  default     = "default"
}
