# modules/argo_cd
# -----------------
# Installs Argo CD itself via helm_release, then creates a single root
# "app of apps" Application CR that points at charts/ in this repository so
# Argo CD takes over deploying charts/backend-api, charts/frontend and
# charts/livekit (Task 26) once they exist, with automated prune+selfHeal.
#
# The Application CR is created with kubernetes_manifest rather than a
# third-party "kubectl_manifest" provider, keeping the provider set to only
# hashicorp/* sources. kubernetes_manifest needs no cluster connection for
# `terraform validate` (verified empirically while building this module —
# see infra/README.md), but DOES need a live, reachable cluster for
# `terraform plan`/`apply`, and specifically needs the Application CRD
# (installed by the argo-cd chart itself) to already exist in that cluster
# — hence depends_on below and the apply-order note in the README.

terraform {
  required_providers {
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.15"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.31"
    }
  }
}

resource "helm_release" "argo_cd" {
  name             = "argo-cd"
  repository       = "https://argoproj.github.io/argo-helm"
  chart            = "argo-cd"
  version          = var.chart_version
  namespace        = var.namespace
  create_namespace = true
}

# NOTE on "pointing at charts/": Argo CD's plain Directory source type
# (used below, since charts/ holds sibling Helm charts rather than a flat
# set of manifests or nested Application YAML files) applies whatever it
# finds under the given path as raw Kubernetes manifests — it does not
# itself invoke `helm template` on subdirectories that happen to contain a
# Chart.yaml. For this root Application to actually deploy
# charts/backend-api, charts/frontend and charts/livekit as Helm releases,
# Task 26 (or a follow-up) needs to either check in one small per-chart
# Application manifest alongside each chart directory (the classic
# app-of-apps child-manifest layout, discovered here via recurse = true),
# or this resource needs to become an ApplicationSet with a git-directory
# generator instead. Flagged explicitly rather than silently assumed to
# work — this task only owns the root Application's own configuration.
resource "kubernetes_manifest" "root_app" {
  manifest = {
    apiVersion = "argoproj.io/v1alpha1"
    kind       = "Application"
    metadata = {
      name      = "root"
      namespace = var.namespace
    }
    spec = {
      project = var.argocd_project

      source = {
        repoURL        = var.gitops_repo_url
        targetRevision = var.gitops_branch
        path           = var.charts_path
        directory = {
          recurse = true
        }
      }

      destination = {
        server    = "https://kubernetes.default.svc"
        namespace = var.namespace
      }

      syncPolicy = {
        automated = {
          prune    = true
          selfHeal = true
        }
      }
    }
  }

  depends_on = [helm_release.argo_cd]
}
