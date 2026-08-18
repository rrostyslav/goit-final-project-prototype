# infra — Terraform (configuration only)

**Nothing in this directory has been applied.** These are configuration
files for a self-hosted deployment on AWS EKS. No `terraform apply` or
`terraform plan` against a real AWS account has been run as part of writing
this configuration, and none should be run without a deliberate, separate
decision to do so.

## What's here (Task 24)

```
infra/
  main.tf                    # wires vpc, ecr, rds, redis together
  providers.tf                # terraform + aws provider version pins, default_tags
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
```

`modules/eks`, `modules/ci-cd`, `modules/argo_cd` and `modules/monitoring`
land in Task 25 and will extend `main.tf` and `outputs.tf`.

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

## What Task 25 must wire up

`modules/eks` does not exist yet. `modules/rds` and `modules/redis` each
take an `eks_node_security_group_id` variable (root variable of the same
name, default `null`). While it's `null`, no ingress rule is created on
either security group at all — the database and cache are reachable from
nowhere, a safe default rather than an open one. Task 25 must pass the new
EKS module's `node_security_group_id` output into that root variable (or
directly into both modules) so the ingress rules actually get created.

## Prototype-scale defaults

Chosen for cost, not load — see each module's `variables.tf` for the exact
defaults:

- **VPC**: a single NAT gateway instead of one per AZ (~3x cheaper; trades
  away NAT redundancy across AZs).
- **RDS**: `db.t4g.micro`, single-AZ (`multi_az = false`), 1-day backup
  retention.
- **Redis**: `cache.t4g.micro`, `num_cache_clusters = 1` (no replica, so
  `automatic_failover_enabled = false`).

Every one of these is a variable with a documented default — bump them for
real load without touching module internals.

## Networking notes for later tasks

- The application's WebSocket gateway (Socket.IO, same port as the REST
  API) is long-lived. This module doesn't create any load balancer or
  ingress yet, but whichever one Task 25/26 adds (ALB or ingress-nginx)
  needs an explicit idle-timeout override — the default (60s on an ALB)
  will silently kill idle-but-alive game sessions.
- LiveKit needs TCP 7880/7881, a UDP media port range, and UDP 3478 for
  TURN, exposed via a `LoadBalancer` Kubernetes Service (Task 26). This
  VPC's public subnets are tagged `kubernetes.io/role/elb` precisely so
  that Service can provision an NLB there; no Terraform-level security
  group or NACL in this module restricts those ports.
