provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "hoang-nhat-scm"
      ManagedBy = "terraform"
      Stack     = "bootstrap"
    }
  }
}
