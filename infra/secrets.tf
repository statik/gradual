resource "random_password" "better_auth_secret" {
  length  = 48
  special = false
}

locals {
  database_url = "postgresql://${aws_db_instance.this.username}:${random_password.db.result}@${aws_db_instance.this.address}:${aws_db_instance.this.port}/${aws_db_instance.this.db_name}?sslmode=disable"

  app_secret_map = {
    DATABASE_URL         = local.database_url
    BETTER_AUTH_SECRET   = random_password.better_auth_secret.result
    GOOGLE_CLIENT_ID     = var.google_client_id
    GOOGLE_CLIENT_SECRET = var.google_client_secret
    GITHUB_CLIENT_ID     = var.github_client_id
    GITHUB_CLIENT_SECRET = var.github_client_secret
    OPENAI_API_KEY       = var.openai_api_key
    ANTHROPIC_API_KEY    = var.anthropic_api_key
  }
}

resource "aws_secretsmanager_secret" "app" {
  name                    = "${local.name}/app"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id     = aws_secretsmanager_secret.app.id
  secret_string = jsonencode(local.app_secret_map)
}
