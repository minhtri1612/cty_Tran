variable "aws_region" {
  description = "Region của bucket state."
  type        = string
  default     = "ap-southeast-1"
}

variable "state_bucket_name" {
  description = "Tên bucket Terraform state (duy nhất toàn cầu), ví dụ hoang-nhat-scm-tfstate-<account-id>."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.state_bucket_name))
    error_message = "Tên bucket S3 không hợp lệ."
  }
}

variable "noncurrent_version_retention_days" {
  type    = number
  default = 90
}
