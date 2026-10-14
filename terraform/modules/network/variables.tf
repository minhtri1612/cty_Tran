variable "name" {
  description = "Tiền tố tên tài nguyên, ví dụ hoang-nhat-scm-prod."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR của VPC."
  type        = string

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0))
    error_message = "vpc_cidr phải là CIDR hợp lệ, ví dụ 10.20.0.0/16."
  }
}

variable "public_subnet_cidr" {
  description = "CIDR của public subnet (nằm trong vpc_cidr)."
  type        = string

  validation {
    condition     = can(cidrhost(var.public_subnet_cidr, 0))
    error_message = "public_subnet_cidr phải là CIDR hợp lệ."
  }
}

variable "availability_zone" {
  description = "AZ cho subnet; null = AZ đầu tiên đang hoạt động. Ổ EBS dữ liệu bị gắn với AZ này."
  type        = string
  default     = null
}

variable "tags" {
  description = "Tag chung."
  type        = map(string)
  default     = {}
}
