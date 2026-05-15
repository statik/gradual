output "app_url" {
  description = "Public URL for the app."
  value       = local.public_base_url
}

output "alb_dns_name" {
  value = aws_lb.this.dns_name
}

output "ecr_repository_url" {
  description = "Push the app image here, then set var.app_image to <this>:<tag>."
  value       = aws_ecr_repository.app.repository_url
}

output "ecs_cluster" {
  value = aws_ecs_cluster.this.name
}

output "migrate_task_definition" {
  value = aws_ecs_task_definition.migrate.family
}

output "task_subnets" {
  value = aws_subnet.public[*].id
}

output "app_security_group" {
  value = aws_security_group.app.id
}

output "rds_address" {
  value = aws_db_instance.this.address
}

output "db_password" {
  description = "Generated Postgres password."
  value       = random_password.db.result
  sensitive   = true
}
