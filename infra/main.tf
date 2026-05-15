provider "aws" {
  region = var.region

  default_tags {
    tags = merge({
      Project   = var.project
      ManagedBy = "terraform"
    }, var.tags)
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name = var.project

  # ALB requires >= 2 AZs; RDS stays single-instance and ECS desired_count = 1
  # so there is no cross-AZ redundancy (single-AZ posture, per the design memo).
  azs = slice(data.aws_availability_zones.available.names, 0, 2)

  public_base_url = var.public_base_url != "" ? var.public_base_url : "http://${aws_lb.this.dns_name}"

  app_port      = 3000
  electric_port = 3000
}
