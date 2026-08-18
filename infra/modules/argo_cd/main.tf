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
#
# Task 26 carry-over — resolved: this root Application's Directory source
# now excludes the three chart directories themselves (see `exclude`
# below) and Task 26 checked in one small per-chart Application manifest
# under charts/applications/ instead (charts/applications/backend-api.yaml,
# frontend.yaml, livekit.yaml — the classic app-of-apps child-manifest
# layout `recurse = true` was already set up to discover). Each child
# Application's own `source.path` points directly at its chart directory
# with no `directory` block of its own, so Argo CD auto-detects the
# Chart.yaml there and renders it with Helm rather than applying it as raw
# manifests. See infra/README.md for the full loop-closing explanation.

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
# Chart.yaml. Naively recursing into the whole of charts/ would therefore
# try to apply charts/backend-api/templates/*.yaml (raw Helm template
# files full of `{{ }}` Go template syntax, not valid standalone
# Kubernetes YAML) as literal manifests and fail.
#
# `exclude` below scopes the raw-manifest scan to skip all three chart
# directories entirely, leaving only charts/applications/*.yaml (Task 26)
# for this Directory source to actually apply — three small, flat
# `Application` manifests, each pointing its OWN `source.path` directly at
# one chart directory with no `directory` block of its own, so Argo CD
# auto-detects the Chart.yaml there and renders that one via Helm instead.
# That's what makes charts/backend-api, charts/frontend and charts/livekit
# actually deploy as Helm releases: this root Application discovers and
# creates three child Applications (via the plain Directory scan below),
# and each child Application is a Helm-source Application in its own
# right. See infra/README.md for the end-to-end trace.
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
          # Skips charts/backend-api/**, charts/frontend/** and
          # charts/livekit/** — see the comment above. Only
          # charts/applications/*.yaml remains in scope for this
          # Directory source.
          exclude = "backend-api/**,frontend/**,livekit/**"
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
