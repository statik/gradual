variable "region" {
  type        = string
  description = "AWS region."
  default     = "us-east-1"
}

variable "project" {
  type        = string
  description = "Name prefix for all resources."
  default     = "gradual"
}

variable "vpc_cidr" {
  type    = string
  default = "10.42.0.0/16"
}

# --- container images ---

variable "app_image" {
  type        = string
  description = "Full image ref for the Hono/Bun app (e.g. <acct>.dkr.ecr.<region>.amazonaws.com/gradual-app:GITSHA). Push to the ECR repo this stack creates, then set this."
  default     = ""
}

variable "electric_image" {
  type        = string
  description = "Electric sync image. Pin a digest/tag in production."
  default     = "electricsql/electric:1.0.0"
}

# --- sizing ---

variable "app_cpu" {
  type    = number
  default = 1024
}

variable "app_memory" {
  type        = number
  default     = 2048
  description = "AdminJS bundles its UI on first request; give the app headroom."
}

variable "electric_cpu" {
  type    = number
  default = 512
}

variable "electric_memory" {
  type    = number
  default = 1024
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_allocated_storage" {
  type    = number
  default = 20
}

# --- app config / secrets ---

variable "public_base_url" {
  type        = string
  description = "External URL the app is served from. Leave empty to use the ALB DNS over http (fine for the anonymous flow; OAuth needs a real domain registered with the provider)."
  default     = ""
}

variable "acm_certificate_arn" {
  type        = string
  description = "If set, adds an HTTPS:443 listener and redirects HTTP->HTTPS."
  default     = ""
}

variable "google_client_id" {
  type      = string
  default   = ""
  sensitive = true
}

variable "google_client_secret" {
  type      = string
  default   = ""
  sensitive = true
}

variable "github_client_id" {
  type      = string
  default   = ""
  sensitive = true
}

variable "github_client_secret" {
  type      = string
  default   = ""
  sensitive = true
}

variable "openai_api_key" {
  type      = string
  default   = ""
  sensitive = true
}

variable "anthropic_api_key" {
  type      = string
  default   = ""
  sensitive = true
}

variable "admin_emails" {
  type        = string
  description = "Comma-separated admin emails for /admin."
  default     = ""
}

variable "quota_anon_tokens_per_day" {
  type    = number
  default = 20000
}

variable "quota_free_tokens_per_day" {
  type    = number
  default = 200000
}

variable "tags" {
  type    = map(string)
  default = {}
}
