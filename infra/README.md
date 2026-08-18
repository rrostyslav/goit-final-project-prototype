# infra — Terraform (configuration only)

**Nothing in this directory has been applied.** These are configuration
files for a self-hosted deployment on AWS EKS. No `terraform apply` or
`terraform plan` against a real AWS account has been run as part of writing
this configuration, and none should be run without a deliberate, separate
decision to do so.

## What's here

```
infra/
  main.tf                    # wires every module together
  providers.tf                # terraform + provider version pins, default_tags,
                               #   helm/kubernetes provider config (see below)
  variables.tf                 # root input variables
  outputs.tf                   # root outputs
  backend.tf                   # remote state backend (see "Bootstrapping" below)
  terraform.tfvars.example     # example variable shapes, not real values
  modules/
    s3-backend/   # state bucket + lock table (bootstrap only, see below)
    vpc/          # VPC, 3 public + 3 private subnets, IGW, single NAT gateway
    ecr/          # one repository per service (backend-api, frontend)
    rds/          # PostgreSQL 17, private subnets, Secrets Manager password
    redis/        # ElastiCache Redis replication group, private subnets
    eks/          # EKS cluster, managed node group, addons, metrics-server, IRSA
    ci-cd/        # GitHub OIDC identity provider + ECR/EKS-scoped IAM role
    argo_cd/      # Argo CD (helm_release) + root "app of apps" Application
    monitoring/   # kube-prometheus-stack (helm_release), sized persistence
```

## Bootstrapping remote state (once, before anything else)

`infra/` stores its own Terraform state in an S3 bucket + DynamoDB lock
table. That bucket can't be created by the same configuration that depends
on it existing, so `modules/s3-backend` is a standalone module with its own
provider block, applied once by hand with local state:

```bash
cd infra/modules/s3-backend
terraform init
terraform apply \
  -var="bucket_name=<project>-terraform-state" \
  -var="lock_table_name=<project>-terraform-locks" \
  -var="aws_region=<region>"
```

Only after that exists does the root config get initialized against it:

```bash
cd infra
terraform init \
  -backend-config="bucket=<project>-terraform-state" \
  -backend-config="key=gameplatform/terraform.tfstate" \
  -backend-config="region=<region>" \
  -backend-config="dynamodb_table=<project>-terraform-locks" \
  -backend-config="encrypt=true"
```

Full detail is in the comment at the top of `backend.tf`.

## Offline validation

The commands actually run while building this configuration:

```bash
cd infra
terraform fmt -check -recursive
terraform init -backend=false
terraform validate
```

`-backend=false` skips the S3 backend entirely, so validation never needs
AWS credentials or network access to the backend bucket (provider plugin
downloads from the Terraform registry are still required for `init`).

## Task 24 carry-over — resolved

`modules/rds` and `modules/redis` each take an `eks_node_security_group_id`
variable, default `null`; while it's `null`, no ingress rule is created on
either security group at all (a safe fail-closed placeholder — see each
module's own `variables.tf`). Root `main.tf` now wires
`module.eks.node_security_group_id` directly into both:

```hcl
module "rds" {
  # ...
  eks_node_security_group_id = module.eks.node_security_group_id
}

module "redis" {
  # ...
  eks_node_security_group_id = module.eks.node_security_group_id
}
```

`module.eks` always exists in this configuration, so that argument is never
`null` in practice — the `count = var.eks_node_security_group_id == null ? 0
: 1` guard in `modules/rds`/`modules/redis` now evaluates to `1`, and the
ingress rule (port 5432 / 6379 from `node_security_group_id` only) is
actually created. `node_security_group_id` is
`aws_eks_cluster.this.vpc_config[0].cluster_security_group_id` — the
security group EKS creates automatically for the cluster and attaches to
every node in a managed node group with no custom launch template (this
module's case), alongside the control plane. See
`infra/modules/eks/outputs.tf` for the full reasoning.

This cannot be proven by re-running `terraform plan` here (that's
explicitly out of scope for this task and wasn't run). What was actually
verified: `terraform validate` accepts the reference chain
(`module.eks.node_security_group_id` → root `main.tf` → `modules/rds`'s
`var.eks_node_security_group_id` → its `count` expression), and the
`count` expression itself is `var.eks_node_security_group_id == null ? 0 :
1`, a pure function of whether the argument is null — since `main.tf` now
always passes a module output (never a literal `null`, never the old
nullable root variable), that expression evaluates to `1` for any
successful `apply`, by construction, not by inspection of plan output.

## Provider chicken-and-egg: helm / kubernetes

The `helm` and `kubernetes` providers (configured in `providers.tf`) need
real cluster credentials — a reachable API endpoint, a CA certificate, an
auth token — and the only place those come from is `module.eks`, a
resource this same configuration creates. There is no way around
referencing a not-yet-real cluster's outputs in the provider block; the
alternative (splitting eks into a wholly separate Terraform root/state)
was not used here to keep the single-root structure the brief describes.

This was not silently ignored. What's actually true, verified while
building this configuration:

- `terraform validate` needs none of it to be real — validate never opens
  a network connection to configure a provider, so the whole configuration
  validates offline regardless of whether a cluster exists. Confirmed
  directly: a scratch `kubernetes_manifest` resource with an unreachable
  provider host validated cleanly, then failed at `terraform plan` with
  `cannot create REST client: no client config` — the failure shows up
  exactly at plan/apply, never at validate.
- `terraform plan`/`apply` from a clean state genuinely cannot succeed in
  one pass the first time: the provider tries to configure itself from
  `module.eks`'s outputs before the cluster that produces them necessarily
  exists yet. The real, necessary apply order is:

  ```bash
  terraform apply -target=module.eks
  terraform apply
  ```

  After that first cluster-only apply, ordinary `terraform apply` runs
  (including ones that change `module.eks` itself) work as a single step,
  because the provider config values are already known. This is the same
  `-target` workaround HashiCorp's own documentation describes for this
  exact situation — it is a structural property of putting a cluster and
  what runs on it in one root, not a defect in this configuration.
- `modules/argo_cd` adds a second staging requirement on top of that: its
  `kubernetes_manifest` root Application needs the `Application` CRD,
  which only exists once the `argo-cd` `helm_release` in that same module
  has actually installed it. The module's own `depends_on` encodes that
  ordering; it cannot encode the cluster-must-exist-first step above, so
  both matter for a real apply, in this order: cluster → Argo CD's Helm
  release → the Application manifest → everything else.

## helm_release charts are not fetched offline

`modules/eks` (metrics-server), `modules/argo_cd` (argo-cd) and
`modules/monitoring` (kube-prometheus-stack) each declare a `helm_release`
pointing at a public chart repository. `terraform validate` does not fetch
or render any of those charts — it only checks that the `helm_release`
resource block itself is well-formed. Whether `chart`/`version`/`repository`
actually resolve to a real, installable chart is unverified here and can
only be confirmed by an `apply` against a real cluster (or `helm pull`/
`helm template` against the repository directly, which was not run as part
of this task). Don't read the green `terraform validate` as proof the
chart references are correct — it isn't that.

## Argo CD root Application — a real gap, not glossed over

The root `Application` (`modules/argo_cd`) uses Argo CD's plain Directory
source type pointed at `charts/`, since `charts/backend-api`,
`charts/frontend` and `charts/livekit` (Task 26) are sibling Helm chart
directories, not a flat set of manifests. A plain Directory source applies
whatever it finds under that path as raw Kubernetes YAML — it does not
itself run `helm template` on a subdirectory just because that
subdirectory has a `Chart.yaml`. For this root Application to actually
deploy those three charts as Helm releases, Task 26 (or a follow-up) needs
either one small per-chart `Application` manifest checked in alongside
each chart (the classic app-of-apps child-manifest layout — `directory.recurse
= true` is already set so they'd be discovered automatically), or this
resource needs to become an `ApplicationSet` with a git-directory
generator instead. This task only owns the root `Application`'s own
configuration (helm_release + syncPolicy.automated), which is what the
brief asks for; wiring the child side is out of scope here and called out
so it isn't silently assumed to already work.

## GitHub OIDC trust policy — scope decision

The brief's literal trust condition is `repo:${var.github_repository}:*`.
That wildcard also matches every branch pushed to the repository, every
same-repo pull request, and every other workflow trigger (schedule,
workflow_dispatch, ...) — not just the deploy pipeline. `modules/ci-cd`
instead scopes the `sub` condition to exactly
`repo:<github_repository>:ref:refs/heads/<github_branch>` (default branch
`main`). Task 27's `backend-deploy.yml`/`frontend-deploy.yml` — the only
workflows that ever assume this role — trigger solely on push to `main`,
so the tighter scope loses nothing while meaningfully shrinking what a
compromised workflow file or a stray branch push could do. (Forked-repo
pull requests never receive this token at all regardless of this policy —
GitHub withholds base-repo-scoped OIDC tokens from fork PR runs — but a
branch pushed directly to this repository would match a `:*` wildcard,
which is the actual hole this closes.) See `modules/ci-cd/variables.tf`'s
`github_branch` description for the full reasoning.

## Cost warning (development)

**EKS control plane, the managed node group's EC2 instances, one Elastic
Load Balancer per `LoadBalancer`-type Kubernetes Service (LiveKit's
Service, Task 26), and every PersistentVolumeClaim `modules/monitoring`
creates all bill continuously, whether or not anything is actually using
them.** Nothing here scales to zero on its own. During development, run

```bash
terraform destroy
```

(everything **except** `modules/s3-backend`, which is never touched by the
root config's own destroy since it isn't instantiated there — see
"Bootstrapping" above) outside working hours, and re-`apply` when you pick
work back up. Forgetting this is the single easiest way to burn real money
on a prototype that nobody is using overnight.

## Prototype-scale defaults

Chosen for cost, not load — see each module's `variables.tf` for the exact
defaults:

- **VPC**: a single NAT gateway instead of one per AZ (~3x cheaper; trades
  away NAT redundancy across AZs).
- **RDS**: `db.t4g.micro`, single-AZ (`multi_az = false`), 1-day backup
  retention.
- **Redis**: `cache.t4g.micro`, `num_cache_clusters = 1` (no replica, so
  `automatic_failover_enabled = false`).
- **EKS**: `t3.medium` nodes, `ON_DEMAND` capacity, desired/min/max
  `2`/`1`/`4` — enough headroom for the backend API, frontend, LiveKit and
  the monitoring stack to coexist without over-provisioning idle capacity.

Every one of these is a variable with a documented default — bump them for
real load without touching module internals.

## Networking notes for later tasks

- The application's WebSocket gateway (Socket.IO, same port as the REST
  API) is long-lived. Neither this module nor `modules/eks` creates any
  ingress/ALB for the backend API — that's Task 26's `charts/backend-api`
  Service — but whichever one it adds needs an explicit idle-timeout
  override (the AWS ALB default is 60s), or it will silently kill
  idle-but-alive game sessions.
- LiveKit needs TCP 7880/7881, a UDP media port range, and UDP 3478 for
  TURN, exposed via a `LoadBalancer` Kubernetes Service (Task 26, **not**
  `hostNetwork: true` and **not** a manual NodePort mapping — spec 8.2).
  This VPC's public subnets are tagged `kubernetes.io/role/elb` precisely
  so that Service can provision an NLB there; no Terraform-level security
  group or NACL in this module or `modules/eks` restricts those ports —
  the EKS-managed cluster security group governs node-to-node and
  control-plane traffic, not what a `LoadBalancer` Service exposes
  externally, which AWS's own NLB/Service-created security groups handle.
- `modules/eks` installs `metrics-server` specifically because
  `charts/backend-api`'s `HorizontalPodAutoscaler` (Task 26, spec 2.5)
  needs it to read CPU/memory metrics — without it the HPA object exists
  but never scales anything.
