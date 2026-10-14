terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.0, < 7.0"
    }
  }

  # State riêng cho prod. Bucket lấy từ output của terraform/bootstrap:
  #   terraform init -backend-config="bucket=<state_bucket_name>"
  backend "s3" {
    key          = "hoang-nhat-scm/prod/terraform.tfstate"
    region       = "ap-southeast-1"
    encrypt      = true
    use_lockfile = true
  }
}
