variable "repository_name" {
  description = "Tên ECR repository, ví dụ hoang-nhat-scm-prod."
  type        = string
}

variable "keep_tagged_images" {
  description = "Số image có tag được giữ lại (để rollback)."
  type        = number
  default     = 20
}

variable "untagged_expire_days" {
  type    = number
  default = 7
}

variable "tags" {
  type    = map(string)
  default = {}
}
