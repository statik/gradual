resource "aws_ecs_cluster" "this" {
  name = local.name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

locals {
  secret_refs = [
    for k in keys(local.app_secret_map) :
    { name = k, valueFrom = "${aws_secretsmanager_secret.app.arn}:${k}::" }
  ]

  app_environment = [
    { name = "NODE_ENV", value = "production" },
    { name = "PORT", value = tostring(local.app_port) },
    { name = "APP_URL", value = local.public_base_url },
    { name = "BETTER_AUTH_URL", value = local.public_base_url },
    { name = "ELECTRIC_URL", value = local.electric_internal_url },
    { name = "ADMIN_EMAILS", value = var.admin_emails },
    { name = "QUOTA_ANON_TOKENS_PER_DAY", value = tostring(var.quota_anon_tokens_per_day) },
    { name = "QUOTA_FREE_TOKENS_PER_DAY", value = tostring(var.quota_free_tokens_per_day) },
  ]
}

# --- app ---

resource "aws_ecs_task_definition" "app" {
  family                   = "${local.name}-app"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.app_cpu
  memory                   = var.app_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([{
    name      = "app"
    image     = var.app_image
    essential = true
    portMappings = [{
      containerPort = local.app_port
      protocol      = "tcp"
    }]
    environment = local.app_environment
    secrets     = local.secret_refs
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.app.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "app"
      }
    }
  }])
}

resource "aws_ecs_service" "app" {
  name            = "${local.name}-app"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "app"
    container_port   = local.app_port
  }

  # desired_count = 1 with 100/200 means ECS starts the replacement before
  # draining the old task, so deploys are near-zero-downtime.
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  health_check_grace_period_seconds = 60

  depends_on = [aws_lb_listener.http]
}

# One-off migration runner. Apply with:
#   aws ecs run-task --cluster <cluster> --launch-type FARGATE \
#     --task-definition <this family> \
#     --network-configuration "awsvpcConfiguration={subnets=[...],securityGroups=[...],assignPublicIp=ENABLED}"
resource "aws_ecs_task_definition" "migrate" {
  family                   = "${local.name}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([{
    name       = "migrate"
    image      = var.app_image
    essential  = true
    command    = ["bun", "run", "db:migrate"]
    environment = local.app_environment
    secrets    = local.secret_refs
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.app.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "migrate"
      }
    }
  }])
}

# --- electric ---

resource "aws_ecs_task_definition" "electric" {
  family                   = "${local.name}-electric"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.electric_cpu
  memory                   = var.electric_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([{
    name      = "electric"
    image     = var.electric_image
    essential = true
    portMappings = [{
      containerPort = local.electric_port
      protocol      = "tcp"
    }]
    environment = [
      { name = "ELECTRIC_PORT", value = tostring(local.electric_port) },
      # v1: API auth disabled; the service is only reachable from the app SG.
      { name = "ELECTRIC_INSECURE", value = "true" },
    ]
    secrets = [
      { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.app.arn}:DATABASE_URL::" },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.electric.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "electric"
      }
    }
  }])
}

resource "aws_ecs_service" "electric" {
  name            = "${local.name}-electric"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.electric.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.electric.id]
    assign_public_ip = true
  }

  service_registries {
    registry_arn = aws_service_discovery_service.electric.arn
  }

  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

  depends_on = [aws_db_instance.this]
}
