variable "name" {
  type = string
}

variable "ecr_repository_arn" {
  description = "ARN của ECR repository mà EC2 được phép pull."
  type        = string
}

variable "backup_bucket_arn" {
  description = "ARN của bucket backup SQLite."
  type        = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
