variable "name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "allowed_http_cidrs" {
  description = "Nguồn được truy cập 80/443. Mặc định Internet; dev có thể giới hạn về IP văn phòng."
  type        = list(string)
  default     = ["0.0.0.0/0"]

  validation {
    condition     = alltrue([for c in var.allowed_http_cidrs : can(cidrhost(c, 0))])
    error_message = "Mỗi phần tử allowed_http_cidrs phải là CIDR IPv4 hợp lệ."
  }
}

variable "tags" {
  type    = map(string)
  default = {}
}
