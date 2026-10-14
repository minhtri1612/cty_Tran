variable "name" {
  type = string
}

variable "instance_type" {
  description = "t4g.* = arm64 (Graviton), t3.* = amd64. Image Docker trong ECR phải cùng kiến trúc."
  type        = string
}

variable "subnet_id" {
  type = string
}

variable "availability_zone" {
  description = "Phải trùng AZ của subnet (ổ EBS dữ liệu bị gắn với AZ)."
  type        = string
}

variable "security_group_id" {
  type = string
}

variable "instance_profile_name" {
  type = string
}

variable "root_volume_size_gb" {
  type    = number
  default = 20
}

variable "data_volume_size_gb" {
  description = "Ổ chứa SQLite và bản backup local."
  type        = number
  default     = 10
}

variable "termination_protection" {
  description = "Chặn terminate EC2 qua API (nên bật cho prod)."
  type        = bool
  default     = true
}

variable "enable_ebs_snapshots" {
  type    = bool
  default = true
}

variable "snapshot_tag_value" {
  description = "Giá trị tag Snapshot để DLM chọn đúng ổ dữ liệu."
  type        = string
}

variable "snapshot_retain_count" {
  type    = number
  default = 7
}

variable "tags" {
  type    = map(string)
  default = {}
}
