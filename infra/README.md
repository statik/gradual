# Infra — ECS Fargate (Terraform)

Single-region, single-AZ-posture deployment of the Pi Agent demo:
ALB → Hono/Bun app (Fargate) → RDS Postgres 16, with Electric sync as an
internal-only Fargate service reachable via Cloud Map.

## Topology

```
internet ──▶ ALB :80(/:443)         idle_timeout = 600 (SSE-safe)
                │
                ▼
        app service (Fargate, 1 task)  ──┐  reads/writes
                │  ELECTRIC_URL=             │
                │  http://electric.gradual.internal:3000
                ▼                            ▼
        electric service (Fargate)  ───▶  RDS Postgres 16
        internal only, Cloud Map           wal_level=logical
        SG-locked to the app SG            single-AZ, SG-locked
```

### Deliberate v1 tradeoffs

- **Single-AZ.** ALB needs ≥2 AZs for its subnets, so the VPC spans two,
  but RDS is `multi_az = false` and both services run `desired_count = 1`.
  An AZ failure means downtime — acceptable for a demo, per the design memo.
- **Public subnets, no NAT.** Cheapest deployable shape. RDS is
  `publicly_accessible = false` and only reachable from the app/electric
  security groups. Production should move tasks into private subnets behind
  a NAT gateway or VPC endpoints.
- **`rds.force_ssl = 0`.** Avoids TLS-cert wrangling for intra-VPC
  connections in v1. Revisit before production.
- **Electric is internal-only.** Not behind the public ALB — the app
  proxies it at `/api/sync/*`, so the browser never needs the raw Electric
  URL. The ALB has a single target group (the app).
- **Electric uses the master DB role.** Fine for v1; production should use
  a scoped replication role.

## Deploy

The app image must exist before the ECS task definitions can register, so
the first apply is scoped to just the ECR repo.

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars   # edit; keep out of git
REGION=us-east-1                               # match var.region

terraform init

# 1. Create just the ECR repo.
terraform apply -target=aws_ecr_repository.app

# 2. Build + push the app image (Bun Dockerfile at repo root).
REPO=$(terraform output -raw ecr_repository_url)
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "${REPO%/*}"
docker build -t "$REPO:v1" ..
docker push "$REPO:v1"

# 3. Stand up the full stack pointed at the pushed image.
terraform apply -var "app_image=$REPO:v1"      # (or set app_image in tfvars)

# 4. Run drizzle migrations once against RDS.
aws ecs run-task \
  --cluster "$(terraform output -raw ecs_cluster)" \
  --launch-type FARGATE \
  --task-definition "$(terraform output -raw migrate_task_definition)" \
  --network-configuration "awsvpcConfiguration={subnets=[$(terraform output -json task_subnets | jq -r 'join(",")')],securityGroups=[$(terraform output -raw app_security_group)],assignPublicIp=ENABLED}"

terraform output app_url
```

Re-deploying code = push a new image tag and
`terraform apply -var app_image=...`; ECS does a 100/200 rolling replace
with circuit-breaker rollback, near-zero downtime at one task.

## Notes

- `terraform output -raw db_password` reveals the generated Postgres
  password if you need to connect directly.
- The app/electric `DATABASE_URL` and `BETTER_AUTH_SECRET` live in one
  Secrets Manager secret (`gradual/app`), injected at task start; they are
  never in the task definition in plaintext.
- If the Electric image's health/port conventions differ from the pinned
  tag, adjust `electric_image` and the `ELECTRIC_*` env in `ecs.tf`.
- Electric needs replication privileges on Postgres. RDS does not grant
  these to the master role automatically — if Electric can't create its
  slot, connect once and run `GRANT rds_replication TO gradual;` (the
  master user can grant it). `wal_level=logical` is already handled by the
  `rds.logical_replication` parameter.
