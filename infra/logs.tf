resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${local.name}-app"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "electric" {
  name              = "/ecs/${local.name}-electric"
  retention_in_days = 14
}
