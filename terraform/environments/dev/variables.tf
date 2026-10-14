variable "aws_region" {
  type    = string
  default = "ap-southeast-1"
}

variable "instance_type" {
  description = "t4g.* = arm64, t3.* = amd64. Build image Docker đúng kiến trúc (output architecture)."
  type        = string
}

variable "domain_name" {
  description = "Domain của ứng dụng (dùng cho Caddy SCM_DOMAIN và bản ghi DNS)."
  type        = string
}

variable "route53_zone_id" {
  description = "Hosted zone Route 53 của domain; null nếu DNS quản lý ở nơi khác."
  type        = string
  default     = null
}

variable "vpc_cidr" {
  type = string
}

variable "public_subnet_cidr" {
  type = string
}

variable "availability_zone" {
  description = "null = AZ đầu tiên. Không đổi sau khi tạo (ổ dữ liệu gắn với AZ)."
  type        = string
  default     = null
}

variable "allowed_http_cidrs" {
  type    = list(string)
  default = ["0.0.0.0/0"]
}

variable "ecr_repository_name" {
  type = string
}

variable "ecr_keep_tagged_images" {
  type    = number
  default = 10
}

variable "backup_bucket_name" {
  description = "Bucket backup SQLite (khác bucket Terraform state)."
  type        = string
}

variable "backup_hourly_retention_days" {
  type    = number
  default = 3
}

variable "backup_daily_retention_days" {
  type    = number
  default = 30
}

variable "root_volume_size_gb" {
  type    = number
  default = 20
}

variable "data_volume_size_gb" {
  type    = number
  default = 10
}

variable "termination_protection" {
  type    = bool
  default = false
}

variable "enable_ebs_snapshots" {
  type    = bool
  default = false
}
