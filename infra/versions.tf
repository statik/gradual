terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # v1 uses local state. For anything shared, switch to an S3 backend:
  # backend "s3" {
  #   bucket = "your-tf-state-bucket"
  #   key    = "gradual/terraform.tfstate"
  #   region = "us-east-1"
  # }
}
