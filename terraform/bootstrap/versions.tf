terraform {
  # >= 1.10: S3 backend hỗ trợ khóa state bằng file (use_lockfile), không cần DynamoDB.
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.0, < 7.0"
    }
  }

  # Cố ý KHÔNG có backend "s3": bootstrap dùng local state (terraform.tfstate
  # trong thư mục này) vì nó tạo ra chính bucket chứa state.
}
